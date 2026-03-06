const express = require("express");
const router = express.Router();
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");
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
const { addAudit } = require("../utils/auditHelper");
const { checkOverbooking } = require("../utils/tableAvailabilityChecker");
const { getAvailableSlotsForDay } = require("../utils/slotGenerator");

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
			// ⭐ Vérification anti-overbooking avant toute création
			const { allowed, occupiedCount, totalTables } = await checkOverbooking({
				restaurantId: req.body.restaurantId,
				reservationDate: req.body.reservationDate,
				reservationTime: req.body.reservationTime,
			});

			if (!allowed) {
				return res.status(409).json({
					message: `Complet : toutes les tables sont occupées sur ce créneau (${occupiedCount}/${totalTables}).`,
					occupiedCount,
					totalTables,
				});
			}

			const reservation = new Reservation(req.body);
			await reservation.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io) {
				emitReservationEvent(
					io,
					req.body.restaurantId,
					"created",
					reservation.toObject(),
				);
			}

			res.status(201).json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
);

// POST /client/reservations

// POST /client/reservations - Création ou rejoindre une réservation (client public)
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
			const {
				tableId,
				clientName,
				allergies,
				restrictions,
				restaurantId: bodyRestaurantId,
			} = req.body;
			const tableIdFinal = tableId || "1";

			// Génère la note à partir des allergies/restrictions
			let notes = "";
			if (allergies?.trim()) {
				notes += `Allergie : ${allergies.trim()} (${clientName})\n`;
			}
			if (restrictions?.trim()) {
				notes += `Restriction : ${restrictions.trim()} (${clientName})\n`;
			}

			// Récupère la table et la dernière réservation en parallèle
			const [table, lastReservation] = await Promise.all([
				Table.findById(tableIdFinal),
				Reservation.findOne({ tableId: tableIdFinal }).sort({ createdAt: -1 }),
			]);

			// ⭐ Récupérer le restaurant pour connaître sa catégorie
			// Priorité : restaurantId du body (plus fiable), sinon table.restaurantId
			let restaurant = null;
			let isFoodtruck = false;
			const restaurantIdToUse =
				bodyRestaurantId || (table && table.restaurantId);
			if (restaurantIdToUse) {
				restaurant = await Restaurant.findById(restaurantIdToUse);
				isFoodtruck = restaurant?.category === "foodtruck";
			}

			console.log("📋 [RESERVATION] État initial:", {
				tableId: tableIdFinal,
				tableNumber: table?.number,
				tableStatus: table?.status,
				isAvailable: table?.isAvailable,
				guests: table?.guests,
				lastResaStatus: lastReservation?.status,
				isFoodtruck,
				restaurantSource: bodyRestaurantId ? "body" : "table",
				restaurantCategory: restaurant?.category,
			});

			// Helper: Ajouter guest et marquer table occupée
			const addGuestAndOccupyTable = async (tableDoc) => {
				if (!tableDoc) return;
				let shouldSave = false;

				// Ajouter le guest s'il n'existe pas
				if (clientName && !tableDoc.guests.includes(clientName.trim())) {
					tableDoc.guests.push(clientName.trim());
					tableDoc.markModified("guests");
					shouldSave = true;
					console.log("✅ [RESERVATION] Guest ajouté:", clientName.trim());
				}

				// Passer en occupée (le middleware pre-save mettra isAvailable=false)
				if (tableDoc.status !== "occupied") {
					tableDoc.status = "occupied";
					shouldSave = true;
					console.log("✅ [RESERVATION] Table passée en status=occupied");
				}

				if (shouldSave) {
					await tableDoc.save();
					console.log("💾 [RESERVATION] Table sauvegardée:", {
						guests: tableDoc.guests,
						status: tableDoc.status,
						isAvailable: tableDoc.isAvailable,
					});
				}
			};

			// CAS 1: Table disponible → Créer nouvelle réservation
			if (table?.isAvailable === true) {
				console.log("✅ [RESERVATION] Table disponible - Nouvelle réservation");
				table.guests = []; // Reset guests pour nouvelle session
				await table.save();
				// Continue vers création de réservation (après les cas)
			}
			// CAS 2: Dernière résa terminée + table non dispo → Refuser (sauf foodtruck)
			// ⭐ Pour les foodtrucks : la résa terminée = client précédent payé, le suivant peut créer la sienne
			else if (lastReservation?.status === "terminée" && !isFoodtruck) {
				console.log("❌ [RESERVATION] Résa terminée, table non dispo - Refus");
				return res.status(400).json({
					message: "Impossible de rejoindre : la réservation est terminée.",
				});
			}
			// CAS 2b: Foodtruck + dernière résa terminée → reset table + nouvelle résa individuelle
			else if (lastReservation?.status === "terminée" && isFoodtruck) {
				console.log(
					"🚚 [RESERVATION] Foodtruck - Résa précédente terminée, reset table + nouvelle résa",
				);
				table.guests = [];
				table.status = "available";
				table.markModified("guests");
				await table.save();
				// Continue vers création de réservation
			}
			// CAS 3: Réservation en cours → Rejoindre (sauf pour foodtrucks)
			// ⭐ Pour les foodtrucks : chaque client a sa propre reservation
			else if (
				lastReservation &&
				lastReservation.status !== "terminée" &&
				!isFoodtruck
			) {
				console.log(
					"👥 [RESERVATION] Rejoindre réservation existante (restaurant)",
				);

				await lastReservation.populate("tableId");
				const resaTable = lastReservation.tableId
					? await Table.findById(lastReservation.tableId._id)
					: null;

				await addGuestAndOccupyTable(resaTable);

				const guests = resaTable?.guests || [];
				const isCreator = lastReservation.clientName === clientName.trim();

				return res.status(200).json({
					reservation: lastReservation,
					creatorName: lastReservation.clientName,
					guests,
					message: isCreator
						? "Vous êtes déjà inscrit à cette table."
						: `Table réservée par ${lastReservation.clientName}. Vous avez rejoint !`,
					joinable: !isCreator,
				});
			}
			// ⭐ CAS 4 (Foodtruck avec reservation en cours): Créer nouvelle reservation individuelle
			else if (
				lastReservation &&
				lastReservation.status !== "terminée" &&
				isFoodtruck
			) {
				console.log(
					"🚚 [RESERVATION] Foodtruck - Nouvelle reservation individuelle",
				);
				// Continue vers création de réservation (après les cas)
			}

			// CRÉATION D'UNE NOUVELLE RÉSERVATION
			const reservation = new Reservation({
				...req.body,
				tableId: tableIdFinal,
				status: "en attente",
				isPresent: true,
				nbPersonnes: req.body.nbPersonnes || 1,
				notes: notes.trim(),
			});

			await reservation.save();
			await reservation.populate("tableId");

			// Mettre à jour la table
			const freshTable = await Table.findById(tableIdFinal);
			await addGuestAndOccupyTable(freshTable);

			// Émission WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"created",
					reservation.toObject(),
				);
			}

			// Préparer la réponse
			const reservationToSend = reservation.toObject();
			delete reservationToSend.__v;

			res.status(201).json({
				reservation: reservationToSend,
				guests: freshTable?.guests || [],
			});
		} catch (error) {
			console.error("❌ [RESERVATION] Erreur:", error);
			return res.status(500).json({
				message: "Erreur serveur",
				error: error.message,
			});
		}
	},
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
	},
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
				"⚠️ [PUT /:id] Tentative de modification du status via la route générale. Utiliser /:id/status",
			);
			return res.status(400).json({
				message: "Pour modifier le statut, utilisez la route PUT /:id/status",
				hint: "Cette route ne permet pas de modifier le statut directement",
			});
		}

		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key)),
		);

		try {
			// Récupérer l'ancienne réservation pour l'audit
			const oldReservation = await Reservation.findById(req.params.id);
			if (!oldReservation)
				return res.status(404).json({ message: "Réservation non trouvée" });

			const updated = await Reservation.findByIdAndUpdate(
				req.params.id,
				updates,
				{ new: true },
			).populate("serverId", "firstName lastName");

			// ⭐ Audit des modifications importantes
			const user = {
				id: req.user?.id,
				type: req.user?.userType || "server",
				name:
					req.user?.firstName && req.user?.lastName
						? `${req.user.firstName} ${req.user.lastName}`
						: req.user?.email || "Utilisateur",
			};

			// Table assignée ou modifiée
			if (
				updates.tableId &&
				updates.tableId !== oldReservation.tableId?.toString()
			) {
				const table = await Table.findById(updates.tableId);
				const action = oldReservation.tableId
					? "table_changed"
					: "table_assigned";
				await addAudit(updated, action, user, {
					oldValue: oldReservation.tableId,
					newValue: updates.tableId,
					tableNumber: table?.number,
				});
			}

			// Autres champs modifiés
			const auditableFields = [
				"nbPersonnes",
				"clientName",
				"phone",
				"allergies",
				"restrictions",
				"notes",
			];
			for (const field of auditableFields) {
				if (updates[field] && updates[field] !== oldReservation[field]) {
					await addAudit(updated, "field_updated", user, {
						fieldName: field,
						oldValue: oldReservation[field],
						newValue: updates[field],
					});
				}
			}

			await updated.save();
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
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

			// ⭐ Audit
			const user = {
				id: req.user?.id,
				type: req.user?.userType || "server",
				name:
					req.user?.firstName && req.user?.lastName
						? `${req.user.firstName} ${req.user.lastName}`
						: req.user?.email || "Utilisateur",
			};
			await addAudit(reservation, "present_changed", user, {
				newValue: reservation.isPresent,
			});

			await reservation.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"presentToggled",
					reservation.toObject(),
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
);

// Mettre à jour le statut d'une réservation (en attente, ouverte, terminée, annulée)
router.put(
	"/:id/status",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { status } = req.body; // le nouveau statut envoyé par le front

			const allowedStatuses = ["en attente", "ouverte", "terminée", "annulée"];

			// Vérification que le statut demandé est valide
			if (!allowedStatuses.includes(status)) {
				return res.status(400).json({ message: "Statut invalide" });
			}

			const reservation = await Reservation.findById(req.params.id);

			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

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
					reservation.toObject(),
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error("❌ Erreur /:id/status:", err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
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

			// ⭐ Marquer toutes les commandes comme payées AVANT le save
			// (le hook pre("save") recalcule paidAmount depuis les orders)
			if (reservation.orderIds && reservation.orderIds.length > 0) {
				const Order = require("../models/Order");
				await Order.updateMany(
					{ _id: { $in: reservation.orderIds } },
					{ $set: { paymentStatus: "paid" } },
				);
			}

			// Mettre à jour les champs de paiement
			if (paymentMethod) reservation.paymentMethod = paymentMethod;

			// Forcer le statut à "terminée" après paiement
			// (le hook pre("save") va recalculer paidAmount/remainingAmount correctement)
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
						} (orderId: ${reservation._id})`,
					);
				} catch (err) {
					require("../utils/logger").error(
						"[PAIEMENT][ERREUR] Impossible de vider les guests",
						{
							error: err,
							orderId: reservation._id,
							tableId: reservation.tableId,
						},
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
					reservation.toObject(),
				);
			}

			res.json(reservation);
		} catch (err) {
			console.error("❌ Erreur mise à jour paiement:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// 🍳 Route pour mettre à jour le statut de préparation (dishStatus)
router.patch(
	"/:id/dish-status",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { dishStatus } = req.body;
			const allowedDishStatuses = [
				"En attente",
				"En cours",
				"Annulé",
				"Terminé",
			];

			if (!dishStatus || !allowedDishStatuses.includes(dishStatus)) {
				return res.status(400).json({
					message: `dishStatus invalide. Valeurs acceptées: ${allowedDishStatuses.join(", ")}`,
				});
			}

			const reservation = await Reservation.findById(req.params.id);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			reservation.dishStatus = dishStatus;
			reservation.updatedAt = new Date();
			await reservation.save();

			console.log(
				`🍳 [DISH STATUS] Réservation ${reservation._id} → dishStatus: ${dishStatus}`,
			);

			// Émettre événement WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId,
					"statusUpdated",
					reservation.toObject(),
				);
			}

			res.json({ success: true, reservation });
		} catch (err) {
			console.error("❌ Erreur mise à jour dishStatus:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
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
					oldTable.isAvailable,
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
				newTable.isAvailable,
			);
		}

		// 3. Mettre à jour la réservation
		const updatedReservation = await Reservation.findByIdAndUpdate(
			reservationId,
			{ tableId: tableId },
			{ new: true },
		).populate("tableId");

		console.log("✅ Réservation mise à jour");

		// ⭐ Émettre l'événement WebSocket
		const io = getIO(req);
		if (io && updatedReservation.restaurantId) {
			emitReservationEvent(
				io,
				updatedReservation.restaurantId,
				"tableAssigned",
				updatedReservation.toObject(),
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
	},
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
	},
);

// GET /restaurant/:restaurantId/monthly-counts - nombre de résas par jour pour un mois donné
// Query params: year (YYYY), month (1-12)
// Retourne: { "2026-03-01": 2, "2026-03-15": 1, ... }
router.get(
	"/restaurant/:restaurantId/monthly-counts",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;
			const year = parseInt(req.query.year) || new Date().getFullYear();
			const month = parseInt(req.query.month) || new Date().getMonth() + 1;

			// Bornes en UTC tenant compte d'Europe/Paris (max offset = +2h été)
			// On élargit d'1 jour de chaque côté pour couvrir tous les cas DST
			const startDate = new Date(
				Date.UTC(year, month - 1, 1) - 2 * 60 * 60 * 1000,
			);
			const endDate = new Date(Date.UTC(year, month, 1) + 2 * 60 * 60 * 1000);

			const tables = await Table.find({ restaurantId }).select("_id");
			const tableIds = tables.map((t) => t._id);

			const counts = await Reservation.aggregate([
				{
					$match: {
						$or: [
							{ tableId: { $in: tableIds } },
							{
								restaurantId:
									require("mongoose").Types.ObjectId.createFromHexString(
										restaurantId,
									),
							},
						],
						reservationDate: { $gte: startDate, $lt: endDate },
					},
				},
				{
					$group: {
						_id: {
							$dateToString: {
								format: "%Y-%m-%d",
								date: "$reservationDate",
								timezone: "Europe/Paris",
							},
						},
						count: { $sum: 1 },
					},
				},
			]);

			const result = {};
			for (const entry of counts) {
				result[entry._id] = entry.count;
			}

			res.json(result);
		} catch (err) {
			console.error("❌ [monthly-counts]", err);
			res.status(500).json({ message: "Erreur server" });
		}
	},
);

// GET /restaurant/:restaurantId/available-slots - créneaux disponibles pour un jour donné
// Query params: date (YYYY-MM-DD, requis), step (minutes, défaut 15), includeZero (bool, défaut false)
// Retourne: [{ time: "18:00", availableTables: 4, totalTables: 10 }, ...]
router.get(
	"/restaurant/:restaurantId/available-slots",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;
			const { date, step, includeZero, guests } = req.query;

			if (!date) {
				return res
					.status(400)
					.json({ message: "Paramètre date requis (YYYY-MM-DD)" });
			}

			const slots = await getAvailableSlotsForDay({
				restaurantId,
				date: new Date(date),
				stepMinutes: step ? parseInt(step) : 15,
				includeZero: includeZero === "true",
				guests: guests ? parseInt(guests) : 0,
			});

			res.json(slots);
		} catch (err) {
			console.error("❌ [available-slots]", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
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

			console.log("\n🔵 [DEBUG RESA API] ===============================");
			console.log(
				"🔵 [DEBUG RESA API] GET /reservations/restaurant/:restaurantId",
			);
			console.log("🔵 RestaurantId:", req.params.restaurantId);
			console.log("🔵 Tables trouvées:", tables.length);
			if (tables.length === 0) {
				console.warn("⚠️ Aucune table liée à ce restaurant");
			} else {
				console.log(
					"🔵 Exemple tableIds:",
					tableIds.slice(0, 5).map((id) => id.toString()),
				);
			}

			const {
				date,
				clientName,
				server,
				page = 1,
				limit = 100, // ⭐ Augmenté de 20 à 100 pour éviter les pertes
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

			const totalByRestaurant = await Reservation.countDocuments({
				restaurantId: req.params.restaurantId,
			});
			const totalByTables = await Reservation.countDocuments({
				tableId: { $in: tableIds },
			});

			console.log("🔵 Total réservations par restaurantId:", totalByRestaurant);
			console.log("🔵 Total réservations par tableIds:", totalByTables);

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

			console.log("🔵 Réservations retournées:", reservations.length);
			console.log("🔵 [DEBUG RESA API] ===============================\n");

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
	},
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
			const { emitOrderEvent } = require("../utils/socketEmitter");
			const io = require("../start").io;

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

				// ⚡ Émettre WebSocket pour notifier le frontend
				if (io && order.restaurantId) {
					emitOrderEvent(
						io,
						order.restaurantId.toString(),
						"updated",
						order.toObject(),
					);
					console.log(
						`📡 WebSocket: Commande ${order._id} marquée payée → Frontend`,
					);
				}
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
					updatedReservation,
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
