const express = require("express");
const router = express.Router();
const Table = require("../models/Table");
const { TABLE_STATUS } = require("../models/Table");
const { body, validationResult } = require("express-validator");

const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const tableValidationRules = require("../middlewares/tableValidationRules");
const tableUpdateValidationRules = require("../middlewares/tableUpdateValidationRules");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");

// ⭐ Import socket emitter
const { emitTableEvent } = require("../utils/socketEmitter");

// ⭐ Import availability checker
const {
	getAvailableTableIds,
	enrichTablesWithAvailability,
} = require("../utils/tableAvailabilityChecker");

// ⭐ Helper pour accéder à io via req.app
const getIO = (req) => req.app.locals.io;

// GET /:tableId - récupérer une table par ID (public pour les clients)
router.get("/:tableId", validateObjectIds(["tableId"]), async (req, res) => {
	try {
		const table = await Table.findById(req.params.tableId);
		if (!table) {
			return res.status(404).json({ message: "Table non trouvée" });
		}
		res.json(table);
	} catch (err) {
		console.error("Erreur récupération table:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// POST / - création table (admin)

router.post(
	"/",
	auth,
	checkRoles(["admin", "developer"]),
	checkUserRestaurantBody("restaurantId"), // <-- ajouté ici
	tableValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const { restaurantId, number, qrCodeUrl, capacity, status } = req.body;

			const table = new Table({
				restaurantId,
				number,
				qrCodeUrl,
				capacity: capacity || 4,
				status: status || TABLE_STATUS.AVAILABLE,
			});
			await table.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && restaurantId) {
				emitTableEvent(io, restaurantId, "created", table.toObject());
			}

			res.status(201).json(table);
		} catch (err) {
			// Doublon (index unique restaurantId+number)
			if (err && err.code === 11000) {
				console.warn(
					"[POST /tables] Doublon table:",
					err.keyValue || err.message,
				);
				return res.status(409).json({
					message: `La table "${req.body.number}" existe déjà pour ce restaurant.`,
					code: "TABLE_DUPLICATE",
				});
			}
			// Erreur de validation Mongoose
			if (err && err.name === "ValidationError") {
				console.warn("[POST /tables] Validation Mongoose:", err.message);
				return res.status(400).json({
					message: err.message,
					code: "TABLE_VALIDATION",
				});
			}
			console.error("[POST /tables] Erreur serveur:", err);
			res.status(500).json({
				message: err && err.message ? err.message : "Erreur serveur",
				code: "TABLE_CREATE_FAILED",
			});
		}
	},
);

// ⭐ GET /restaurant/:restaurantId/available - Tables avec disponibilité calculée
// ⚠️ DOIT ÊTRE AVANT /restaurant/:restaurantId pour éviter conflit de routes
router.get(
	"/restaurant/:restaurantId/available",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;
			const { date, time, excludeReservationId } = req.query;


			// Récupérer toutes les tables du restaurant
			const tables = await Table.find({ restaurantId }).maxTimeMS(10000);

			// Si pas de date/heure, retourner toutes les tables comme disponibles
			if (!date || !time) {
				const enrichedTables = tables.map((t) => ({
					...t.toObject(),
					isAvailable: true,
				}));
				return res.json(enrichedTables);
			}

			// Calculer les tables occupées pour ce créneau
			const occupiedTableIds = await getAvailableTableIds({
				restaurantId,
				reservationDate: new Date(date),
				reservationTime: time,
				duration: 120, // 2h par défaut
				excludeReservationId: excludeReservationId || null,
			});

			// Enrichir les tables avec leur disponibilité
			const enrichedTables = enrichTablesWithAvailability(
				tables,
				occupiedTableIds,
			);

			res.json(enrichedTables);
		} catch (err) {
			console.error("🚨 [TABLES] Erreur fetch disponibilité:", err);
			res
				.status(500)
				.json({ message: "Erreur serveur lors du calcul de disponibilité" });
		}
	},
);

// GET /restaurant/:restaurantId - lister tables
router.get(
	"/restaurant/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const restaurantId = req.params.restaurantId;


			// Mongoose convertit automatiquement les strings en ObjectId
			const tables = await Table.find({ restaurantId }).maxTimeMS(10000);

			res.json(tables);
		} catch (err) {
			console.error("🚨 Erreur fetch tables:", err);
			res
				.status(500)
				.json({ message: "Erreur serveur lors du fetch des tables" });
		}
	},
);

router.get(
	"/table/:tableId",
	auth,
	validateObjectIds(["tableId"]),
	async (req, res) => {
		try {
			let query = { tableId: req.params.tableId };

			// 🌟 Limitation pour les clients
			if (req.user.role === "client") {
				query.origin = "client"; // seulement les commandes clients
				query.tableId = req.user.tableId; // s’assure qu’ils voient uniquement leur table
			}

			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "name");

			res.json(orders);
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement des commandes." });
		}
	},
);

// POST /swap - échanger les numéros de deux tables (admin)
router.post(
	"/swap",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		const { idA, idB } = req.body;
		if (!idA || !idB) {
			return res.status(400).json({ message: "idA et idB sont requis." });
		}
		try {
			const [tableA, tableB] = await Promise.all([
				Table.findById(idA),
				Table.findById(idB),
			]);
			if (!tableA || !tableB) {
				return res.status(404).json({ message: "Table introuvable." });
			}
			const numA = tableA.number;
			const numB = tableB.number;
			// Utiliser un numéro temporaire garanti unique (UUID) pour éviter le conflit d'index
			const tempNum = `__swap_temp_${Date.now()}`;
			await Table.updateOne({ _id: idA }, { $set: { number: tempNum } });
			await Table.updateOne({ _id: idB }, { $set: { number: numA } });
			await Table.updateOne({ _id: idA }, { $set: { number: numB } });

			// Swapper le tableId des réservations FUTURES uniquement (pas les passées/annulées)
			// Les sessions/commandes suivent l'_id (comportement voulu), les réservations restent au "slot" physique
			const now = new Date();
			const futureFilter = {
				reservationDate: { $gte: now },
				status: { $nin: ["cancelled", "completed", "no_show"] },
			};

			// Collecter les _id des documents à mettre à jour AVANT de modifier (évite conflit A→B puis B→A)
			const [resIdsForA, resIdsForB] = await Promise.all([
				Reservation.distinct("_id", { ...futureFilter, tableId: idA }),
				Reservation.distinct("_id", { ...futureFilter, tableId: idB }),
			]);
			if (resIdsForA.length) await Reservation.updateMany({ _id: { $in: resIdsForA } }, { $set: { tableId: idB } });
			if (resIdsForB.length) await Reservation.updateMany({ _id: { $in: resIdsForB } }, { $set: { tableId: idA } });

			// tableIds array (réservations multi-tables) : même logique safe
			const [arrIdsForA, arrIdsForB] = await Promise.all([
				Reservation.distinct("_id", { ...futureFilter, tableIds: idA }),
				Reservation.distinct("_id", { ...futureFilter, tableIds: idB }),
			]);
			// Docs qui ont SEULEMENT A (pas B) → remplacer A par B
			const arrOnlyA = arrIdsForA.filter((id) => !arrIdsForB.some((b) => b.toString() === id.toString()));
			// Docs qui ont SEULEMENT B (pas A) → remplacer B par A
			const arrOnlyB = arrIdsForB.filter((id) => !arrIdsForA.some((a) => a.toString() === id.toString()));
			if (arrOnlyA.length) await Reservation.updateMany(
				{ _id: { $in: arrOnlyA } },
				[{ $set: { tableIds: { $map: { input: "$tableIds", as: "t", in: { $cond: [{ $eq: ["$$t", { $toObjectId: idA }] }, { $toObjectId: idB }, "$$t"] } } } } }]
			);
			if (arrOnlyB.length) await Reservation.updateMany(
				{ _id: { $in: arrOnlyB } },
				[{ $set: { tableIds: { $map: { input: "$tableIds", as: "t", in: { $cond: [{ $eq: ["$$t", { $toObjectId: idB }] }, { $toObjectId: idA }, "$$t"] } } } } }]
			);

			const [updatedA, updatedB] = await Promise.all([
				Table.findById(idA),
				Table.findById(idB),
			]);

			// Émettre WebSocket pour les deux tables
			const io = getIO(req);
			if (io && tableA.restaurantId) {
				emitTableEvent(io, tableA.restaurantId, "updated", updatedA.toObject());
				emitTableEvent(io, tableA.restaurantId, "updated", updatedB.toObject());
			}

			res.json({ tableA: updatedA, tableB: updatedB });
		} catch (err) {
			console.error("[POST /tables/swap] Erreur:", err);
			res.status(500).json({ message: "Erreur lors de l'échange des tables." });
		}
	},
);

// PUT /:id - modifier table (admin)
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	tableUpdateValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		// On filtre les champs autorisés (ajout de capacity, status, position et size)
		const allowedFields = [
			"number",
			"qrCodeUrl",
			"capacity",
			"status",
			"position",
			"size",
			"sizeW",
			"sizeH",
			"shape",
		];
		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key)),
		);


		// Validation du status si fourni
		if (
			updates.status &&
			!Object.values(TABLE_STATUS).includes(updates.status)
		) {
			return res.status(400).json({
				message: `Statut invalide. Valeurs autorisées: ${Object.values(
					TABLE_STATUS,
				).join(", ")}`,
			});
		}

		// Validation de la capacité si fournie
		if (updates.capacity !== undefined) {
			const cap = parseInt(updates.capacity);
			if (isNaN(cap) || cap < 1 || cap > 50) {
				return res.status(400).json({
					message: "Capacité invalide. Doit être entre 1 et 50.",
				});
			}
			updates.capacity = cap;
		}

		try {
			// Vérifier que la table existe d'abord
			const existingTable = await Table.findById(req.params.id);
			if (!existingTable) {
				return res.status(404).json({ message: "Table non trouvée." });
			}

			// Vérifier si le nouveau numéro existe déjà (si on change le number)
			if (updates.number && updates.number !== existingTable.number) {
				const duplicateTable = await Table.findOne({
					restaurantId: existingTable.restaurantId,
					number: updates.number,
					_id: { $ne: req.params.id },
				});
				if (duplicateTable) {
					return res.status(400).json({
						message: `Le numéro ${updates.number} est déjà utilisé par une autre table.`,
					});
				}
			}

			const updated = await Table.findByIdAndUpdate(req.params.id, updates, {
				new: true,
				runValidators: true,
			});

			if (!updated) {
				return res.status(404).json({ message: "Table non trouvée." });
			}


			// ⭐ Émettre l'événement WebSocket
			try {
				const io = getIO(req);
				if (io && updated.restaurantId) {
					emitTableEvent(
						io,
						updated.restaurantId,
						"updated",
						updated.toObject(),
					);
				}
			} catch (wsError) {
				console.error(
					"⚠️ [TABLE UPDATE] Erreur WebSocket (non bloquant):",
					wsError.message,
				);
			}

			res.json(updated);
		} catch (err) {
			console.error("❌ [TABLE UPDATE] Erreur lors de la mise à jour:", err);
			console.error("❌ [TABLE UPDATE] Stack:", err.stack);

			// Détailler le type d'erreur
			if (err.name === "ValidationError") {
				console.error(
					"❌ [TABLE UPDATE] Erreur de validation Mongoose:",
					err.message,
				);
				return res.status(400).json({
					message: "Erreur de validation",
					errors: Object.keys(err.errors).map((key) => ({
						field: key,
						message: err.errors[key].message,
					})),
				});
			}

			if (err.code === 11000) {
				console.error(
					"❌ [TABLE UPDATE] Erreur d'unicité (duplicate key):",
					err.message,
				);
				return res.status(400).json({
					message: "Ce numéro de table existe déjà pour ce restaurant.",
					error: err.message,
				});
			}

			res.status(500).json({ message: "Erreur serveur", error: err.message });
		}
	},
);

// DELETE /:id - supprimer table (admin)
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			// Vérifier si la table existe et son statut
			const table = await Table.findById(req.params.id);
			if (!table) {
				console.warn(
					`⚠️ [TABLE DELETE] Table ${req.params.id} introuvable — déjà supprimée ?`,
				);
				return res.status(404).json({
					message: "Table introuvable (déjà supprimée ou ID invalide).",
					tableId: req.params.id,
				});
			}

			// Interdire la suppression si la table est occupée
			if (table.status === TABLE_STATUS.OCCUPIED) {
				return res.status(400).json({
					message:
						"Impossible de supprimer une table occupée. Veuillez d'abord libérer la table.",
				});
			}

			// Vérifier s'il y a des commandes en cours sur cette table
			const activeOrders = await Order.countDocuments({
				tableId: req.params.id,
				status: { $in: ["pending", "preparing", "ready"] },
			});

			if (activeOrders > 0) {
				return res.status(400).json({
					message: `Impossible de supprimer cette table. ${activeOrders} commande(s) en cours.`,
				});
			}

			const deleted = await Table.findByIdAndDelete(req.params.id);

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && table.restaurantId) {
				emitTableEvent(io, table.restaurantId, "deleted", {
					_id: req.params.id,
				});
			}

			res.json({ message: "Table supprimée." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
);

// ⭐ PATCH /fusion - Fusionner deux tables
router.patch(
	"/fusion",
	auth,
	checkRoles(["admin"]),
	[
		body("sourceId").isMongoId().withMessage("sourceId invalide"),
		body("targetId").isMongoId().withMessage("targetId invalide"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { sourceId, targetId } = req.body;

		if (sourceId === targetId) {
			return res
				.status(400)
				.json({ message: "Impossible de fusionner une table avec elle-même" });
		}

		try {
			// Récupérer les deux tables
			const [sourceTable, targetTable] = await Promise.all([
				Table.findById(sourceId),
				Table.findById(targetId),
			]);

			if (!sourceTable || !targetTable) {
				return res
					.status(404)
					.json({ message: "Une ou plusieurs tables introuvables" });
			}

			// Vérifier qu'elles appartiennent au même restaurant
			if (
				sourceTable.restaurantId.toString() !==
				targetTable.restaurantId.toString()
			) {
				return res.status(400).json({
					message: "Les tables doivent appartenir au même restaurant",
				});
			}

			// Calculer la nouvelle capacité
			const newCapacity = sourceTable.capacity + targetTable.capacity;

			if (newCapacity > 50) {
				return res.status(400).json({
					message: "Capacité maximale dépassée (50 places maximum)",
				});
			}

			// Mettre à jour la table cible
			targetTable.capacity = newCapacity;
			await targetTable.save();

			// Supprimer la table source
			await Table.findByIdAndDelete(sourceId);

			// ⭐ Émettre les événements WebSocket
			const io = getIO(req);
			if (io && targetTable.restaurantId) {
				emitTableEvent(
					io,
					targetTable.restaurantId,
					"merged",
					targetTable.toObject(),
				);
				emitTableEvent(io, targetTable.restaurantId, "deleted", {
					_id: sourceId,
				});
			}

			res.json({
				message: "Tables fusionnées avec succès",
				merged: targetTable.toObject(),
			});
		} catch (err) {
			console.error("Erreur fusion tables:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// ⭐ Phase B/BLOC3 — POST /:tableId/reset - Fermer manuellement la session d'une table
// Reset : table → available, guests → [], réservation ouverte → terminée, TableSession → closed
router.post(
	"/:tableId/reset",
	auth,
	validateObjectIds(["tableId"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const table = await Table.findById(req.params.tableId);
			if (!table) {
				return res.status(404).json({ message: "Table introuvable" });
			}

			// Vérifier que la table appartient au restaurant de l'utilisateur
			if (
				req.user.restaurantId &&
				table.restaurantId.toString() !== req.user.restaurantId.toString()
			) {
				return res.status(403).json({ message: "Table hors de votre restaurant" });
			}

			const Reservation = require("../models/Reservation");
			const TableSession = require("../models/TableSession");

			// Fermer les réservations actives de cette table (status !== terminée / annulée)
			const closedAt = new Date();
			const closedReservations = await Reservation.updateMany(
				{
					tableId: table._id,
					status: { $nin: ["terminée", "annulée"] },
				},
				{
					$set: {
						status: "terminée",
						isPresent: false,
						updatedAt: closedAt,
					},
				},
			);

			// Fermer les TableSessions actives de cette table (Phase B)
			await TableSession.updateMany(
				{ tableId: table._id, status: "active" },
				{ $set: { status: "closed", closedAt } },
			);

			// Reset de la table
			table.status = "available";
			table.guests = [];
			table.markModified("guests");
			await table.save();

			// Émettre WebSocket
			const io = getIO(req);
			if (io && table.restaurantId) {
				emitTableEvent(io, table.restaurantId.toString(), "reset", {
					_id: table._id,
					status: "available",
					guests: [],
				});
			}

			console.log(
				`[TABLE RESET] Table ${table.number} (${table._id}) réinitialisée par ${req.user.role} ${req.user.userId || req.user.serverId} | ${closedReservations.modifiedCount} résa(s) fermée(s)`,
			);

			res.json({
				success: true,
				message: `Table ${table.number} réinitialisée`,
				closedReservations: closedReservations.modifiedCount,
				table: {
					_id: table._id,
					number: table.number,
					status: table.status,
					guests: table.guests,
				},
			});
		} catch (err) {
			console.error("❌ [TABLE RESET] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// ⭐ POST /batch - créer N tables d'un coup (onboarding wizard)
router.post(
	"/batch",
	auth,
	checkRoles(["admin", "developer"]),
	[
		body("restaurantId").isMongoId().withMessage("restaurantId invalide"),
		body("count")
			.isInt({ min: 1, max: 50 })
			.withMessage("count doit être entre 1 et 50"),
		body("capacity").optional().isInt({ min: 1, max: 20 }),
		body("clientAppUrl").optional().isURL().withMessage("clientAppUrl invalide"),
	],
	checkUserRestaurantBody("restaurantId"),
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		const { restaurantId, count, capacity = 4, clientAppUrl } = req.body;

		try {
			// Trouver le dernier numéro de table pour ce restaurant
			const lastTable = await Table.findOne({ restaurantId })
				.sort({ number: -1 })
				.select("number");
			const startNumber = lastTable ? lastTable.number + 1 : 1;

			const tables = [];
			for (let i = 0; i < count; i++) {
				const number = startNumber + i;
				const table = new Table({
					restaurantId,
					number,
					capacity,
					status: TABLE_STATUS.AVAILABLE,
					// qrCodeUrl sera remplie après création (besoin de l'_id)
				});
				await table.save();

				// Générer le qrCodeUrl avec l'_id de la table
				if (clientAppUrl) {
					table.qrCodeUrl = `${clientAppUrl}/r/${restaurantId}/${table._id}`;
					await table.save();
				}

				tables.push(table.toObject());
			}

			const io = getIO(req);
			if (io) {
				tables.forEach((t) =>
					emitTableEvent(io, restaurantId, "created", t),
				);
			}

			res.status(201).json({ tables, count: tables.length });
		} catch (err) {
			console.error("❌ [TABLES BATCH] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
