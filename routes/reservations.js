const express = require("express");
const router = express.Router();
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const { body, validationResult } = require("express-validator");

const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");

// Validation simple pour réservation
const {
	reservationValidationRules,
	reservationUpdateRules,
} = require("../middlewares/reservationValidationRules");

// ⭐ Import socket emitter
const { emitReservationEvent } = require("../utils/socketEmitter");

// ⭐ Helper pour accéder à io via req.app
const getIO = (req) => req.app.locals.io;

// POST / - création réservation (admin / server)
router.post(
	"/",
	auth,
	checkRoles(["admin", "server"]),
	checkUserRestaurantBody("restaurantId"),
	reservationValidationRules, // <- tes règles de validation
	async (req, res) => {
		// <- ici tu mets la vérification des erreurs
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const formattedErrors = errors.array().map((err) => ({
				field: err.param,
				message: err.msg,
			}));
			return res.status(400).json({ errors: formattedErrors });
		}

		try {
			const reservation = new Reservation(req.body);
			await reservation.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io) {
				emitReservationEvent(
					io,
					req.body.restaurantId,
					"created",
					reservation.toObject()
				);
			}

			res.status(201).json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// POST /client/reservations

router.post(
	"/client/reservations",
	reservationValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const formattedErrors = errors.array().map((err) => ({
				field: err.param,
				message: err.msg,
			}));
			return res.status(400).json({ errors: formattedErrors });
		}

		try {
			const { tableId, clientName, allergies, restrictions } = req.body;
			const tableIdFinal = tableId || "1";

			// Génère la note à partir des allergies/restrictions
			let notes = "";
			if (allergies && allergies.trim()) {
				notes += `Allergie : ${allergies.trim()} (${clientName})\n`;
			}
			if (restrictions && restrictions.trim()) {
				notes += `Restriction : ${restrictions.trim()} (${clientName})\n`;
			}

			// Cherche la dernière réservation pour cette table (même fermée)
			const lastReservation = await Reservation.findOne({
				tableId: tableIdFinal,
			}).sort({ createdAt: -1 });

			// Vérifie l'état de la table
			let table = null;
			if (tableIdFinal) {
				table = await Table.findById(tableIdFinal);
			}

			if (lastReservation) {
				// Si la table est disponible (isAvailable:true), on autorise la création d'une nouvelle réservation et on vide les guests
				if (table && table.isAvailable === true) {
					table.guests = [];
					await table.save();
				} else if (lastReservation.status === "terminée") {
					// Si la dernière réservation est terminée ET la table n'est pas dispo, on interdit
					return res.status(400).json({
						message:
							"Impossible de rejoindre ou créer une réservation : la dernière réservation pour cette table est fermée.",
					});
				} else {
					// Sinon, comportement existant : on ne crée pas de nouvelle resa si une ouverte existe
					// Toujours populate la table pour la réponse
					const populatedReservation = await lastReservation.populate(
						"tableId"
					);
					// Ajout du client dans guests de la table si non déjà présent
					if (
						populatedReservation.tableId &&
						populatedReservation.tableId._id
					) {
						const table = await Table.findById(
							populatedReservation.tableId._id
						);
						if (
							table &&
							clientName &&
							!table.guests.includes(clientName.trim())
						) {
							table.guests.push(clientName.trim());
							await table.save();
						}
					}
					if (lastReservation.clientName === clientName.trim()) {
						return res.status(200).json({
							reservation: populatedReservation,
							creatorName: lastReservation.clientName,
							guests:
								populatedReservation.tableId &&
								populatedReservation.tableId.guests
									? populatedReservation.tableId.guests
									: [],
							message: "Vous êtes déjà inscrit à cette table.",
						});
					}
					return res.status(200).json({
						reservation: populatedReservation,
						creatorName: lastReservation.clientName,
						guests:
							populatedReservation.tableId &&
							populatedReservation.tableId.guests
								? populatedReservation.tableId.guests
								: [],
						message: `Table déjà réservée par ${lastReservation.clientName}. Voulez-vous rejoindre ?`,
						joinable: true,
					});
				}
			}

			// Création d’une nouvelle réservation
			const reservation = new Reservation({
				...req.body,
				tableId: tableIdFinal,
				status: "en attente",
				isPresent: true,
				nbPersonnes: req.body.nbPersonnes || 1,
				notes: notes.trim(),
			});

			try {
				await reservation.save();
				// Populate la table pour la réponse
				await reservation.populate("tableId");
				// Ajout du client dans guests de la table (si non déjà présent) + MAJ isAvailable
				if (reservation.tableId && reservation.tableId._id) {
					const table = await Table.findById(reservation.tableId._id);
					let shouldSave = false;
					if (
						table &&
						clientName &&
						!table.guests.includes(clientName.trim())
					) {
						table.guests.push(clientName.trim());
						shouldSave = true;
					}
					// Passe la table en indisponible si elle ne l'est pas déjà
					if (table && table.isAvailable !== false) {
						table.isAvailable = false;
						shouldSave = true;
					}
					if (shouldSave) {
						await table.save();
					}
				}
			} catch (saveErr) {
				return res.status(500).json({
					message: "Erreur lors de la sauvegarde de la réservation",
					error: saveErr.message,
				});
			}

			// Émission WebSocket si possible
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"created",
					reservation.toObject()
				);
			}

			let reservationToSend = reservation.toObject();
			if (reservationToSend.public_id) {
				delete reservationToSend._id;
				delete reservationToSend.__v;
			}

			// Ajoute guests à la réponse si possible
			let guestsArr = [];
			if (reservation.tableId && reservation.tableId.guests) {
				guestsArr = reservation.tableId.guests;
			}
			res
				.status(201)
				.json({ reservation: reservationToSend, guests: guestsArr });
		} catch (error) {
			return res
				.status(500)
				.json({ message: "Erreur serveur", error: error.message });
		}
	}
);

router.post("/client/reservations/join/:id", async (req, res) => {
	const reservation = await Reservation.findById(req.params.id);
	if (!reservation)
		return res.status(404).json({ message: "Réservation introuvable" });
	reservation.nbPersonnes = (reservation.nbPersonnes || 1) + 1;
	await reservation.save();

	// Ajout du client dans guests de la table (si non déjà présent)
	const { clientName } = req.body;
	if (reservation.tableId && clientName) {
		const table = await Table.findById(reservation.tableId);
		if (table && !table.guests.includes(clientName.trim())) {
			table.guests.push(clientName.trim());
			await table.save();
		}
	}

	// Récupère la table pour exposer guests
	let guestsArr = [];
	if (reservation.tableId) {
		const table = await Table.findById(reservation.tableId);
		if (table && table.guests) {
			guestsArr = table.guests;
		}
	}
	res.json({
		reservation,
		guests: guestsArr,
		message: "Vous avez rejoint la table !",
	});
});

// GET /:id - récupérer une réservation
router.get(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const reservation = await Reservation.findById(req.params.id)
				.populate("serverId", "firstName lastName")
				.populate("tableId", "number");
			if (!reservation)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// GET /:id - récupérer toutes les réservations
router.get("/", auth, checkRoles(["admin", "server"]), async (req, res) => {
	try {
		const reservations = await Reservation.find()
			.populate("serverId", "firstName lastName")
			.populate("tableId", "number");
		res.json(reservations);
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: "Erreur server" });
	}
});

// PUT /:id - modifier réservation
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	reservationUpdateRules,
	async (req, res) => {
		// <- vérification des erreurs
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const formattedErrors = errors.array().map((err) => ({
				field: err.param,
				message: err.msg,
			}));
			return res.status(400).json({ errors: formattedErrors });
		}

		const allowedFields = [
			"tableId",
			"clientName",
			"reservationDate",
			"reservationTime",
			"nbPersonnes",
			"allergies",
			"restrictions",
			"notes",
			"serverId",
			"orderSummary",
			"dishStatus",
			"paymentMethod",
			"totalAmount",
			// ⭐ STATUS RETIRÉ - utiliser la route /:id/status pour les changements de statut
			// "status",
		];

		// ⭐ Si le frontend essaie de modifier le status via cette route, rediriger vers /:id/status
		if (req.body.status) {
			console.log(
				"⚠️ [PUT /:id] Tentative de modification du status via la route générale. Utiliser /:id/status"
			);
			return res.status(400).json({
				message: "Pour modifier le statut, utilisez la route PUT /:id/status",
				hint: "Cette route ne permet pas de modifier le statut directement",
			});
		}

		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);

		try {
			const updated = await Reservation.findByIdAndUpdate(
				req.params.id,
				updates,
				{ new: true }
			).populate("serverId", "firstName lastName");
			if (!updated)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// Toggle Présent / Absent
router.put(
	"/:id/togglePresent",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		console.log("[DEBUG] --- NOUVELLE REQUÊTE PUT /:id/togglePresent ---");
		console.log("[DEBUG] Date:", new Date().toISOString());
		console.log("[DEBUG] req.params:", req.params);
		try {
			const reservation = await Reservation.findById(req.params.id);
			if (!reservation)
				return res.status(404).json({ message: "Réservation non trouvée" });

			// ⭐ RÈGLE MÉTIER: isPresent=true impossible si status terminée ou annulée
			if (
				(reservation.status === "terminée" ||
					reservation.status === "annulée") &&
				!reservation.isPresent
			) {
				return res.status(400).json({
					message:
						"Impossible de marquer présent une réservation terminée ou annulée",
				});
			}

			// ⭐ RÈGLE MÉTIER: Ne pas modifier si terminée/annulée
			if (
				reservation.status === "terminée" ||
				reservation.status === "annulée"
			) {
				return res.status(400).json({
					message: "Impossible de modifier une réservation terminée ou annulée",
				});
			}

			reservation.isPresent = !reservation.isPresent;

			// ⭐ Mettre à jour arrivalTime quand on passe à "présent"
			if (reservation.isPresent && !reservation.arrivalTime) {
				reservation.arrivalTime = new Date();
			}
			await reservation.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"presentToggled",
					reservation.toObject()
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// Mettre à jour le statut d'une réservation (en attente, ouverte, terminée, annulée)
router.put(
	"/:id/status",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		console.log("🔍 [DEBUG] /:id/status - Début de la requête");
		console.log("🔍 [DEBUG] Méthode:", req.method);
		console.log("🔍 [DEBUG] URL:", req.originalUrl);
		console.log("🔍 [DEBUG] Paramètres:", req.params);
		console.log("🔍 [DEBUG] Body:", req.body);
		console.log(
			"🔍 [DEBUG] Headers - Authorization:",
			req.headers.authorization ? "PRÉSENT" : "ABSENT"
		);

		if (req.headers.authorization) {
			console.log(
				"🔍 [DEBUG] Token (début):",
				req.headers.authorization.substring(0, 30) + "..."
			);
		}

		try {
			const { status } = req.body; // le nouveau statut envoyé par le front
			console.log("[DEBUG] Statut demandé:", status);

			const allowedStatuses = ["en attente", "ouverte", "terminée", "annulée"];

			// Vérification que le statut demandé est valide
			if (!allowedStatuses.includes(status)) {
				console.log("❌ [DEBUG] Statut invalide rejeté:", status);
				return res.status(400).json({ message: "Statut invalide" });
			}

			console.log("[DEBUG] Recherche réservation ID:", req.params.id);
			const reservation = await Reservation.findById(req.params.id);

			if (!reservation) {
				console.log("❌ [DEBUG] Réservation non trouvée:", req.params.id);
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			console.log(
				"[DEBUG] Transition:",
				reservation.status,
				"→",
				status,
				"isPresent:",
				reservation.isPresent
			);

			// ⭐ RÈGLE MÉTIER: Réservation terminée/annulée ne peut plus être modifiée
			if (
				(reservation.status === "terminée" ||
					reservation.status === "annulée") &&
				status !== reservation.status
			) {
				return res.status(400).json({
					message: "Impossible de modifier une réservation terminée ou annulée",
				});
			}

			// ⭐ RÈGLE MÉTIER: Ouvrir une réservation SEULEMENT si isPresent=true
			if (status === "ouverte" && !reservation.isPresent) {
				return res.status(400).json({
					message:
						"Impossible d'ouvrir une réservation si le client n'est pas présent",
				});
			}

			// ⭐ RÈGLE MÉTIER: Seules les réservations "en attente" peuvent être ouvertes
			if (status === "ouverte" && reservation.status !== "en attente") {
				return res.status(400).json({
					message: "Seules les réservations en attente peuvent être ouvertes",
				});
			}

			// ⭐ RÈGLE MÉTIER: Une réservation "ouverte" peut revenir à "en attente" (garder isPresent=true)
			// (pas de validation supplémentaire nécessaire)

			// ⭐ RÈGLE MÉTIER: Si passage à terminée/annulée, isPresent passe à false
			if (status === "terminée" || status === "annulée") {
				reservation.isPresent = false;
			}

			reservation.status = status;
			await reservation.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"statusUpdated",
					reservation.toObject()
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error("❌ Erreur /:id/status:", err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// ⭐ Route spécifique pour mettre à jour le paiement
router.put(
	"/:id/payment",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { paidAmount, remainingAmount, paymentMethod } = req.body;

			const reservation = await Reservation.findById(req.params.id);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			// Mettre à jour les champs de paiement
			if (paidAmount !== undefined) reservation.paidAmount = paidAmount;
			if (remainingAmount !== undefined)
				reservation.remainingAmount = remainingAmount;
			if (paymentMethod) reservation.paymentMethod = paymentMethod;

			// Forcer le statut à "terminée" après paiement
			reservation.status = "terminée";
			reservation.isPresent = false; // ⭐ RÈGLE MÉTIER
			reservation.updatedAt = new Date();
			await reservation.save();

			// Vider les guests de la table associée (transactionnel et robuste)
			if (reservation.tableId) {
				const Table = require("../models/Table");
				try {
					const table = await Table.findById(reservation.tableId);
					if (!table) {
						const errMsg = `[PAIEMENT][ERREUR] Table introuvable pour reservation ${reservation._id} (tableId: ${reservation.tableId})`;
						require("../utils/logger").error(errMsg, {
							orderId: reservation._id,
							tableId: reservation.tableId,
						});
						return res.status(500).json({
							message: "Table associée introuvable",
							orderId: reservation._id,
							tableId: reservation.tableId,
						});
					}
					table.guests = [];
					await table.save();
					console.log(
						`[PAIEMENT] Guests vidés sur table ${
							table.number || table._id
						} (orderId: ${reservation._id})`
					);
				} catch (err) {
					require("../utils/logger").error(
						"[PAIEMENT][ERREUR] Impossible de vider les guests",
						{
							error: err,
							orderId: reservation._id,
							tableId: reservation.tableId,
						}
					);
					return res.status(500).json({
						message: "Erreur lors du vidage des guests",
						error: err.message,
						orderId: reservation._id,
						tableId: reservation.tableId,
					});
				}
			}

			// Émettre événement WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"statusUpdated",
					reservation.toObject()
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error("❌ Erreur mise à jour paiement:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// 🔓 Route simplifiée pour le client (sans auth JWT)

// backend/routes/reservations.js
router.patch("/assignTable/:id", auth, async (req, res) => {
	try {
		const { tableId, oldTableId } = req.body;
		const reservationId = req.params.id;

		console.log("🔄 Assignation table:");

		// 1. Libérer l'ancienne table SI elle existe
		if (oldTableId) {
			const oldTable = await Table.findById(oldTableId);
			if (oldTable) {
				oldTable.isAvailable = true;
				await oldTable.save(); // ⭐ UTILISER save()
				console.log(
					"🔓 Ancienne table libérée:",
					oldTable.number,
					"isAvailable:",
					oldTable.isAvailable
				);
			}
		}

		// 2. Occuper la nouvelle table
		const newTable = await Table.findById(tableId);
		if (newTable) {
			newTable.isAvailable = false;
			await newTable.save(); // ⭐ UTILISER save()
			console.log(
				"🔒 Nouvelle table occupée:",
				newTable.number,
				"isAvailable:",
				newTable.isAvailable
			);
		}

		// 3. Mettre à jour la réservation
		const updatedReservation = await Reservation.findByIdAndUpdate(
			reservationId,
			{ tableId: tableId },
			{ new: true }
		).populate("tableId");

		console.log("✅ Réservation mise à jour");

		// ⭐ Émettre l'événement WebSocket
		const io = getIO(req);
		if (io && updatedReservation.restaurantId) {
			emitReservationEvent(
				io,
				updatedReservation.restaurantId,
				"tableAssigned",
				updatedReservation.toObject()
			);
		}

		res.json(updatedReservation);
	} catch (err) {
		console.error("🚨 Erreur assignation table:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

router.patch(
	"/releaseTable/:tableId",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const table = await Table.findById(req.params.tableId);
			if (!table) return res.status(404).json({ message: "Table non trouvée" });

			table.isAvailable = true;
			await table.save();

			res.json({ message: "Table libérée", table });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// DELETE /:id - supprimer réservation
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const deleted = await Reservation.findByIdAndDelete(req.params.id);
			if (!deleted)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json({ message: "Réservation supprimée" });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// GET /restaurant/:restaurantId - toutes les réservations d'un restaurant avec filtres et pagination
router.get(
	"/restaurant/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const tables = await Table.find({
				restaurantId: req.params.restaurantId,
			});
			const tableIds = tables.map((t) => t._id);

			const {
				date,
				clientName,
				server,
				page = 1,
				limit = 20,
				sortBy = "reservationDate",
				order = "asc",
			} = req.query;

			// ⭐ Filtrer par tableId OU par restaurantId directement (pour réservations sans table)
			const filter = {
				$or: [
					{ tableId: { $in: tableIds } },
					{
						restaurantId: req.params.restaurantId,
						tableId: { $exists: false },
					},
					{ restaurantId: req.params.restaurantId, tableId: null },
				],
			};

			if (date) filter.reservationDate = date;
			if (clientName) filter.clientName = { $regex: clientName, $options: "i" };
			if (server) filter.server = server;

			const sortOrder = order === "asc" ? 1 : -1;

			const reservations = await Reservation.find(filter)
				.populate("serverId", "firstName lastName")
				.populate("tableId", "number")
				.sort({ [sortBy]: sortOrder })
				.skip((page - 1) * limit)
				.limit(Number(limit));
			const total = await Reservation.countDocuments(filter);

			res.json({
				total,
				page: Number(page),
				limit: Number(limit),
				reservations,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// ⭐⭐ PLACEZ VOTRE ROUTE ICI - À LA FIN DU FICHIER
router.put("/client/:id/close", async (req, res) => {
	console.log("🔥🔥🔥🔥🔥🔥 Route PUT /client/:id/close APPELÉE !!!");
	console.log("🔥 id:", req.params.id);
	console.log("🔥 method:", req.method);
	console.log("🔥 originalUrl:", req.originalUrl);
	console.log("🔥 path:", req.path);
	console.log("🔥 baseUrl:", req.baseUrl);

	try {
		const { id } = req.params;

		// 1. Trouver la réservation
		const reservation = await Reservation.findById(id);
		if (!reservation) {
			console.log("❌ Réservation non trouvée:", id);
			return res.status(404).json({ message: "Réservation non trouvée" });
		}

		console.log("✅ Réservation trouvée:", {
			id: reservation._id,
			status: reservation.status,
			client: reservation.clientName,
			table: reservation.tableId,
		});

		// 2. Vérifier que la réservation peut être terminée
		if (reservation.status === "terminée") {
			console.log("⚠️ Réservation déjà terminée");
			return res.status(400).json({ message: "Réservation déjà terminée" });
		}

		// 3. Mise à jour
		console.log("[DEBUG] Avant save() - status:", reservation.status);
		reservation.status = "terminée";
		reservation.isPresent = false;

		// Si la réservation a des orderIds, on force toutes les commandes à paid (tous champs cohérents)

		if (reservation.orderIds && reservation.orderIds.length > 0) {
			const Order = require("../models/Order");
			const orders = await Order.find({ _id: { $in: reservation.orderIds } });
			const now = new Date();
			// On sauvegarde chaque commande une par une AVANT la réservation
			for (const order of orders) {
				order.orderStatus = "completed";
				order.paymentStatus = "paid";
				order.paid = true;
				order.paidAmount = order.totalAmount;
				order.paidAt = now;
				await order.save();
			}
			// Log détaillé pour debug
			const debugOrders = await Order.find({
				_id: { $in: reservation.orderIds },
			});
			console.log("[DEBUG] État des commandes juste avant save reservation:");
			debugOrders.forEach((o) => {
				console.log({
					_id: o._id,
					orderStatus: o.orderStatus,
					paymentStatus: o.paymentStatus,
					paid: o.paid,
					paidAmount: o.paidAmount,
					totalAmount: o.totalAmount,
				});
			});
		}

		// Forcer la sauvegarde et la propagation du statut
		await reservation.save();
		// Recharger la réservation après save pour obtenir le statut à jour
		const updatedReservation = await Reservation.findById(id);
		console.log("[DEBUG] Après save() - status:", updatedReservation.status);

		// Émettre explicitement l'événement WebSocket pour garantir la synchro front
		try {
			const { emitReservationEvent } = require("../utils/socketEmitter");
			const io = require("../start").io;
			if (io && updatedReservation.restaurantId) {
				emitReservationEvent(
					io,
					updatedReservation.restaurantId.toString(),
					"updated",
					updatedReservation
				);
			}
		} catch (e) {
			console.error("[WebSocket] Erreur émission événement reservation: ", e);
		}

		// 4. Libérer la table et vider les guests
		if (reservation.tableId) {
			console.log("🔓 Libération table + vidage guests:", reservation.tableId);
			await Table.findByIdAndUpdate(reservation.tableId, {
				isAvailable: true,
				guests: [],
			});
		}

		console.log("✅ Fermeture réussie");
		res.json({
			success: true,
			message: "Réservation fermée avec succès",
			reservation,
		});
	} catch (err) {
		console.error("❌ Erreur fermeture réservation client:", err);
		console.error("❌ Stack:", err.stack);
		res.status(500).json({
			message: "Erreur serveur",
			error: err.message,
		});
	}
});

module.exports = router;
