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

// ⭐ Import socket emitter
const { emitTableEvent } = require("../utils/socketEmitter");

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
	checkRoles(["admin"]),
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
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
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

			console.log("🔄 Fetch tables pour restaurantId:", restaurantId);

			// Mongoose convertit automatiquement les strings en ObjectId
			const tables = await Table.find({ restaurantId }).maxTimeMS(10000);

			console.log(`📊 Tables trouvées: ${tables.length}`);
			res.json(tables);
		} catch (err) {
			console.error("🚨 Erreur fetch tables:", err);
			res
				.status(500)
				.json({ message: "Erreur serveur lors du fetch des tables" });
		}
	}
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
	}
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
		];
		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);

		// Validation du status si fourni
		if (
			updates.status &&
			!Object.values(TABLE_STATUS).includes(updates.status)
		) {
			return res.status(400).json({
				message: `Statut invalide. Valeurs autorisées: ${Object.values(
					TABLE_STATUS
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
			console.log("📝 Mise à jour table:", req.params.id, "avec:", updates);
			const updated = await Table.findByIdAndUpdate(req.params.id, updates, {
				new: true,
				runValidators: true,
			});
			if (!updated) {
				return res.status(404).json({ message: "Table non trouvée." });
			}

			console.log("✅ Table mise à jour:", updated._id);

			// ⭐ Émettre l'événement WebSocket
			try {
				const io = getIO(req);
				if (io && updated.restaurantId) {
					emitTableEvent(
						io,
						updated.restaurantId,
						"updated",
						updated.toObject()
					);
				}
			} catch (wsError) {
				console.error("⚠️ Erreur WebSocket (non bloquant):", wsError.message);
			}

			res.json(updated);
		} catch (err) {
			console.error("❌ Erreur PUT /tables/:id:", err);
			res.status(500).json({ message: "Erreur server", error: err.message });
		}
	}
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
				return res.status(404).json({ message: "Table non trouvée." });
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
	}
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
					targetTable.toObject()
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
	}
);

module.exports = router;
