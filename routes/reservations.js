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
			const { tableId, clientName, restaurantId } = req.body;
			const tableIdFinal = tableId || "1";

			// Cherche s’il existe une réservation pour cette table qui n'est pas fermée
			const existingReservation = await Reservation.findOne({
				tableId: tableIdFinal,
				status: { $ne: "fermee" }, // pas fermée
			});

			if (existingReservation) {
				// Si le client est déjà dans cette réservation
				if (existingReservation.clientName === clientName.trim()) {
					return res.status(200).json({
						reservation: existingReservation,
						message: "Vous êtes déjà inscrit à cette table.",
					});
				}

				// Sinon, indique au front que la table existe et propose de rejoindre
				return res.status(200).json({
					reservation: existingReservation,
					message: `Table déjà réservée par ${existingReservation.clientName}. Voulez-vous rejoindre ?`,
					joinable: true, // front peut afficher le pop-up
				});
			}

			// Si aucune réservation existante non fermée, création d’une nouvelle réservation
			const reservation = new Reservation({
				...req.body,
				tableId: tableIdFinal,
				status: "en attente",
				isPresent: true,
				nbPersonnes: req.body.nbPersonnes || 1,
			});

			await reservation.save();

			res.status(201).json({ reservation });
		} catch (err) {
			console.error("Erreur serveur /client/reservations:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

router.post("/client/reservations/join/:id", async (req, res) => {
	const reservation = await Reservation.findById(req.params.id);
	if (!reservation)
		return res.status(404).json({ message: "Réservation introuvable" });
	reservation.nbPersonnes = (reservation.nbPersonnes || 1) + 1;
	await reservation.save();
	res.json({ reservation, message: "Vous avez rejoint la table !" });
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
			"status",
		];

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
		try {
			const reservation = await Reservation.findById(req.params.id);
			if (!reservation)
				return res.status(404).json({ message: "Réservation non trouvée" });

			// Ne rien faire si terminé/fermé
			if (reservation.status === "fermee") {
				return res
					.status(400)
					.json({ message: "Impossible de modifier une réservation terminée" });
			}

			reservation.isPresent = !reservation.isPresent;
			// ⭐ NOUVEAU: Mettre à jour arrivalTime quand on passe à "présent"
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

// Mettre à jour le statut d’une réservation (en attente, annulé, fermee, ouverte, etc.)
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
			console.log("🔍 [DEBUG] Statut demandé:", status);

			const allowedStatuses = [
				"en attente",
				"present",
				"ouverte",
				"fermee",
				"annulee",
			];
			console.log("🔍 [DEBUG] Statuts autorisés:", allowedStatuses);

			// Vérification que le statut demandé est valide
			if (!allowedStatuses.includes(status)) {
				console.log("❌ [DEBUG] Statut invalide rejeté:", status);
				return res.status(400).json({ message: "Statut invalide" });
			}

			console.log("🔍 [DEBUG] Recherche réservation ID:", req.params.id);
			const reservation = await Reservation.findById(req.params.id);

			if (!reservation) {
				console.log("❌ [DEBUG] Réservation non trouvée:", req.params.id);
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			console.log("🔍 [DEBUG] Réservation trouvée:", {
				id: reservation._id,
				statusActuel: reservation.status,
				client: reservation.clientName,
				table: reservation.tableId,
			});

			// Si la résa est déjà fermée, on interdit de la modifier
			if (reservation.status === "fermee" && status !== "fermee") {
				console.log(
					"❌ [DEBUG] Tentative de modification réservation déjà fermée"
				);
				return res
					.status(400)
					.json({ message: "Impossible de modifier une réservation terminée" });
			}

			console.log(
				"🔍 [DEBUG] Ancien statut:",
				reservation.status,
				"→ Nouveau statut:",
				status
			);

			// Mise à jour
			reservation.status = status;
			reservation.isPresent = false; // reset quand on change de statut

			console.log("🔍 [DEBUG] Avant save() - Réservation:", {
				status: reservation.status,
				isPresent: reservation.isPresent,
			});

			await reservation.save();

			console.log("✅ [DEBUG] Réservation mise à jour avec succès");
			console.log("🔍 [DEBUG] Après save() - Réservation:", {
				id: reservation._id,
				status: reservation.status,
				isPresent: reservation.isPresent,
				updatedAt: reservation.updatedAt,
			});

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
			console.error("❌ [DEBUG] Erreur dans /:id/status:", err);
			console.error("❌ [DEBUG] Stack:", err.stack);
			console.error("❌ [DEBUG] Erreur complète:", {
				message: err.message,
				name: err.name,
				code: err.code,
			});
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
			const { paidAmount, remainingAmount, paymentMethod, status } = req.body;

			const reservation = await Reservation.findById(req.params.id);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			// Mettre à jour les champs de paiement
			if (paidAmount !== undefined) reservation.paidAmount = paidAmount;
			if (remainingAmount !== undefined)
				reservation.remainingAmount = remainingAmount;
			if (paymentMethod) reservation.paymentMethod = paymentMethod;
			if (status) reservation.status = status;

			reservation.updatedAt = new Date();
			await reservation.save();

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

			console.log("✅ Paiement mis à jour:", {
				id: reservation._id,
				paidAmount: reservation.paidAmount,
				remainingAmount: reservation.remainingAmount,
				status: reservation.status,
			});

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

			const filter = { tableId: { $in: tableIds } };

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

		// 2. Vérifier que la réservation peut être fermée
		if (reservation.status === "fermee") {
			console.log("⚠️ Réservation déjà fermée");
			return res.status(400).json({ message: "Réservation déjà fermée" });
		}

		// 3. Mise à jour
		reservation.status = "fermee";
		reservation.isPresent = false;
		await reservation.save();

		console.log("✅ Réservation mise à jour:", reservation.status);

		// 4. Libérer la table si nécessaire
		if (reservation.tableId) {
			console.log("🔓 Libération table:", reservation.tableId);
			await Table.findByIdAndUpdate(reservation.tableId, {
				isAvailable: true,
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
