const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");
const Server = require("../models/Server");
const Admin = require("../models/Admin");
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
const { addAudit, getAuditUser } = require("../utils/auditHelper");
const { checkOverbooking } = require("../utils/tableAvailabilityChecker");
const { getAvailableSlotsForDay } = require("../utils/slotGenerator");

// ⭐ Helper pour accéder à io via req.app
const getIO = (req) => req.app.locals.io;

const { requireClientDeviceBinding } = require("../middlewares/auth");

// ⭐ Phase B — TableSession + Participant (dual-write)
const TableSession = require("../models/TableSession");
const Participant = require("../models/Participant");
const {
	cancelOpenStripePaymentsForOrder,
} = require("../utils/cancelOpenStripePayments");
const generateClientToken = require("../utils/generateClientToken");

/**
 * Normalise un nom (Option B) : trim + lowercase + suppression des accents.
 * Sert au matching d'identité lors d'une reconnexion : un client qui retape
 * “herve” au lieu de “Hervé” retrouve son identité stable.
 */
function normalizeClientName(name) {
	if (typeof name !== "string") return null;
	const trimmed = name.trim().toLowerCase();
	if (!trimmed) return null;
	return trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Résout l'identité stable d'un client qui rejoint / reprend une réservation.
 * Cherche dans cet ordre, parmi les Participants ACTIFS de la session :
 *   1) match par deviceId (le plus fiable, même device qui revient)
 *   2) match par nom normalisé (même personne qui a réinstallé / clear cache)
 *
 * Retourne { resolved: true, clientId } si trouvé (le clientId existant
 * doit être réutilisé), sinon { resolved: false, clientId: tokenClientId }.
 */
async function resolveStableClientId({
	reservation,
	tokenClientId,
	deviceId,
	clientName,
}) {
	try {
		if (!reservation?._id) {
			return { resolved: false, clientId: tokenClientId || null };
		}
		const session = await TableSession.findOne({
			reservationId: reservation._id,
			status: "active",
		}).select("_id");
		if (!session) {
			return { resolved: false, clientId: tokenClientId || null };
		}
		const participants = await Participant.find({
			tableSessionId: session._id,
			leftAt: null,
		}).select("clientId clientName deviceId");

		// 1) Match deviceId
		if (deviceId) {
			const byDevice = participants.find(
				(p) => p.deviceId && p.deviceId === deviceId && p.clientId,
			);
			if (byDevice && byDevice.clientId !== tokenClientId) {
				return { resolved: true, clientId: byDevice.clientId };
			}
			if (byDevice) {
				return { resolved: false, clientId: byDevice.clientId };
			}
		}

		// 2) Match nom normalisé
		const normalizedNew = normalizeClientName(clientName);
		if (normalizedNew) {
			const byName = participants.find(
				(p) =>
					p.clientId &&
					normalizeClientName(p.clientName) === normalizedNew,
			);
			if (byName && byName.clientId !== tokenClientId) {
				return { resolved: true, clientId: byName.clientId };
			}
			if (byName) {
				return { resolved: false, clientId: byName.clientId };
			}
		}

		return { resolved: false, clientId: tokenClientId || null };
	} catch (err) {
		console.error("[STABLE-CLIENT] Erreur résolution:", err.message);
		return { resolved: false, clientId: tokenClientId || null };
	}
}

/**
 * Dual-write : crée ou récupère la TableSession pour cette réservation,
 * puis crée/met à jour le Participant correspondant.
 * Fire-and-forget : les erreurs sont loguées mais n'interrompent pas la réponse.
 */
async function dualWriteSession({ reservation, clientName, clientId, deviceId, isCreator = false }) {
	try {
		// Trouver ou créer la TableSession liée à cette réservation
		let session = await TableSession.findOne({ reservationId: reservation._id, status: "active" });
		if (!session) {
			session = await TableSession.create({
				restaurantId: reservation.restaurantId,
				tableId: reservation.tableId || null,
				reservationId: reservation._id,
				status: "active",
				openedAt: new Date(),
			});
		}

		// Créer le Participant si pas encore enregistré pour ce device
		const filter = deviceId
			? { tableSessionId: session._id, deviceId }
			: { tableSessionId: session._id, clientId };

		const exists = await Participant.findOne(filter);
		if (!exists) {
			await Participant.create({
				tableSessionId: session._id,
				reservationId: reservation._id,
				clientId: clientId || null,
				deviceId: deviceId || null,
				clientName,
				isCreator,
				joinedAt: new Date(),
			});
		}

		return session;
	} catch (err) {
		console.error("[DUAL-WRITE] Erreur TableSession/Participant:", err.message);
		return null;
	}
}

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

			// ⭐ CAS 16 — Validation double booking sur la même table
			if (req.body.tableId) {
				const requestedTime = new Date(req.body.reservationDate);
				const twoHoursBefore = new Date(requestedTime.getTime() - 2 * 3600 * 1000);
				const twoHoursAfter = new Date(requestedTime.getTime() + 2 * 3600 * 1000);

				const existingResa = await Reservation.findOne({
					tableId: req.body.tableId,
					reservationDate: {
						$gte: twoHoursBefore,
						$lte: twoHoursAfter,
					},
					status: { $in: ["en attente", "ouverte"] },
				});

				if (existingResa) {
					return res.status(409).json({
						message: `Table ${req.body.tableId} déjà réservée à ce créneau`,
						conflictingReservation: {
							clientName: existingResa.clientName,
							reservationDate: existingResa.reservationDate,
						},
					});
				}
			}

			const reservation = new Reservation(req.body);

			// ⭐ Audit : création
			const user = await getAuditUser(req);
			await addAudit(reservation, "created", user, {
				clientName: req.body.clientName,
			});
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
	auth,
	requireClientDeviceBinding,
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
			// ⭐ Forcer restaurant/table depuis le token (source de vérité — pas le body)
			const tokenRestaurantId = req.user.restaurantId;
			const tokenTableId = req.user.tableId || null;

			const {
				clientName,
				allergies,
				restrictions,
			} = req.body;

			// Utiliser les valeurs du token; ignorer le body pour ces champs critiques
			const tableIdFinal = tokenTableId || req.body.tableId || "1";
			const bodyRestaurantId = tokenRestaurantId;

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

			// Helper: Ajouter guest et marquer table occupée
			const addGuestAndOccupyTable = async (tableDoc) => {
				if (!tableDoc) return;
				let shouldSave = false;

				// Ajouter le guest s'il n'existe pas
				if (clientName && !tableDoc.guests.includes(clientName.trim())) {
					tableDoc.guests.push(clientName.trim());
					tableDoc.markModified("guests");
					shouldSave = true;
				}

				// Passer en occupée (le middleware pre-save mettra isAvailable=false)
				if (tableDoc.status !== "occupied") {
					tableDoc.status = "occupied";
					shouldSave = true;
				}

				if (shouldSave) {
					await tableDoc.save();
				}
			};

			// CAS 1: Table disponible → Créer nouvelle réservation
			if (table?.isAvailable === true) {
				table.guests = []; // Reset guests pour nouvelle session
				await table.save();
				// Continue vers création de réservation (après les cas)
			}
			// CAS 2: Dernière résa terminée + table non dispo → recycler la table puis créer une nouvelle réservation
			else if (lastReservation?.status === "terminée") {
				if (table) {
					table.guests = [];
					table.status = "available";
					table.markModified("guests");
					await table.save();
				}
				// Continue vers création de réservation
			}
			// CAS 3: Réservation en cours → Rejoindre (sauf pour foodtrucks)
			// ⭐ Pour les foodtrucks : chaque client a sa propre reservation
			else if (
				lastReservation &&
				lastReservation.status !== "terminée" &&
				!isFoodtruck
			) {
				await lastReservation.populate("tableId");
				const resaTable = lastReservation.tableId
					? await Table.findById(lastReservation.tableId._id)
					: null;

				await addGuestAndOccupyTable(resaTable);

				const guests = resaTable?.guests || [];
				const isCreator = lastReservation.clientName === clientName.trim();

				// ⭐ Phase B — Dual-write : enregistrer ce participant sur la session existante
				const joinDeviceId = req.headers["x-device-id"] || null;

				// �️ ANTI-DOUBLON DE PRÉNOM (normalisé)
				// Empêche 2 personnes d'utiliser le même prénom sur la même table
				// (Hélène ≠ helene → tout pareil après normalisation NFD).
				// On autorise UNIQUEMENT si c'est le même device qui revient.
				try {
					const normalizedNew = normalizeClientName(clientName);
					if (normalizedNew) {
						const activeSession = await TableSession.findOne({
							reservationId: lastReservation._id,
							status: "active",
						}).select("_id");
						if (activeSession) {
							const sameNameParticipants = await Participant.find({
								tableSessionId: activeSession._id,
								leftAt: null,
							}).select("clientName deviceId clientId");
							const conflict = sameNameParticipants.find(
								(p) =>
									normalizeClientName(p.clientName) === normalizedNew &&
									(!joinDeviceId || p.deviceId !== joinDeviceId),
							);
							if (conflict) {
								return res.status(409).json({
									error: "duplicate_client_name",
									message: `Le prénom "${clientName.trim()}" est déjà utilisé sur cette table. Choisissez un prénom différent (ex. ajoutez une initiale).`,
								});
							}
						}
					}
				} catch (e) {
					console.error("[DUPLICATE-NAME] Vérification échouée:", e.message);
				}

				// �🔐 Résoudre l'identité stable (deviceId puis nom normalisé)
				const stable = await resolveStableClientId({
					reservation: lastReservation,
					tokenClientId: req.user?.clientId || null,
					deviceId: joinDeviceId,
					clientName,
				});
				const effectiveClientId =
					stable.clientId || req.user?.clientId || null;

				dualWriteSession({
					reservation: lastReservation,
					clientName,
					clientId: effectiveClientId,
					deviceId: joinDeviceId,
					isCreator,
				});

				// 🔑 Si on a résolu un autre clientId que celui du token → réémettre un JWT
				let reissuedToken = null;
				if (
					stable.resolved &&
					effectiveClientId &&
					joinDeviceId &&
					lastReservation.restaurantId
				) {
					try {
						reissuedToken = generateClientToken({
							clientId: effectiveClientId,
							restaurantId: lastReservation.restaurantId.toString(),
							tableId: lastReservation.tableId
								? (lastReservation.tableId._id || lastReservation.tableId).toString()
								: null,
							deviceId: joinDeviceId,
							expiresIn: 2 * 3600,
						});
					} catch (e) {
						console.error("[STABLE-CLIENT] Réémission token échouée:", e.message);
					}
				}

				return res.status(200).json({
					reservation: lastReservation,
					creatorName: lastReservation.clientName,
					guests,
					resolvedClientId: effectiveClientId,
					token: reissuedToken, // null si pas réémis (frontend ignore)
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

			// ⭐ Audit : création client
			await addAudit(
				reservation,
				"created_client",
				{ id: null, type: "system", name: clientName || "Client" },
				{ clientName },
			);
			await reservation.save();

			// ⭐ Phase B — Dual-write TableSession + Participant
			const deviceId = req.headers["x-device-id"] || null;
			dualWriteSession({
				reservation,
				clientName,
				clientId: req.user?.clientId || null,
				deviceId,
				isCreator: true,
			});

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

// ⭐ Phase B — POST /client/reservations/resume
// Valide côté serveur qu'une session peut être reprise (réservation encore active + scope token OK)
router.post(
	"/client/reservations/resume",
	auth,
	requireClientDeviceBinding,
	async (req, res) => {
		try {
			const { reservationId } = req.body;
			if (!reservationId) {
				return res.status(400).json({ valid: false, reason: "reservationId manquant" });
			}

			const reservation = await Reservation.findById(reservationId)
				.select("status tableId restaurantId clientName")
				.lean();

			if (!reservation) {
				return res.status(200).json({ valid: false, reason: "not_found" });
			}

			if (reservation.status === "terminée" || reservation.status === "annulée") {
				return res.status(200).json({ valid: false, reason: "session_closed" });
			}

			// Vérifier scope restaurant
			if (
				req.user.restaurantId &&
				reservation.restaurantId &&
				reservation.restaurantId.toString() !== req.user.restaurantId.toString()
			) {
				return res.status(200).json({ valid: false, reason: "restaurant_mismatch" });
			}

			// Vérifier scope table si token la contient
			if (
				req.user.tableId &&
				reservation.tableId &&
				reservation.tableId.toString() !== req.user.tableId.toString()
			) {
				return res.status(200).json({ valid: false, reason: "table_mismatch" });
			}

			return res.status(200).json({ valid: true, reservation });
		} catch (err) {
			console.error("❌ [RESUME] Erreur:", err);
			return res.status(500).json({ valid: false, reason: "server_error" });
		}
	},
);

router.post("/client/reservations/join/:id", async (req, res) => {
	const reservation = await Reservation.findById(req.params.id);
	if (!reservation)
		return res.status(404).json({ message: "Réservation introuvable" });
	reservation.nbPersonnes = (reservation.nbPersonnes || 1) + 1;

	// ⭐ Audit : client rejoint
	const { clientName } = req.body;
	await addAudit(
		reservation,
		"joined",
		{ id: null, type: "system", name: clientName || "Client" },
		{ clientName: clientName || "Client" },
	);
	await reservation.save();

	// Ajout du client dans guests de la table (si non déjà présent)
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

// GET /upcoming/:restaurantId - réservations à venir (dans les prochaines heures)
router.get(
	"/upcoming/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;
			const now = new Date();
			const upcomingWindow = new Date(now.getTime() + 72 * 60 * 60 * 1000); // +72h (3 jours)

			const upcomingReservations = await Reservation.find({
				restaurantId,
				status: "en attente",
				reservationDate: { $gte: now, $lte: upcomingWindow },
			})
				.populate("serverId", "name serverId")
				.populate("tableId", "number")
				.populate("tableIds", "number")
				.sort({ reservationDate: 1 });

			res.json(upcomingReservations);
		} catch (err) {
			console.error("[UPCOMING-RESAS] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// GET /:id - récupérer une réservation
router.get(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const reservation = await Reservation.findById(req.params.id)
				.populate("serverId", "name serverId")
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
			.populate("serverId", "name serverId")
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
			"staffNotes",
			"openedBy",
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
			return res.status(400).json({
				message: "Pour modifier le statut, utilisez la route PUT /:id/status",
				hint: "Cette route ne permet pas de modifier le statut directement",
			});
		}

		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key)),
		);

		// ⭐ Si staffNotes est modifié, ajouter le timestamp
		if (updates.staffNotes !== undefined) {
			updates.staffNotesUpdatedAt = new Date();
		}

		// ⭐ Si serverId change, chercher le nom du serveur pour openedBy
		if (updates.serverId && updates.serverId !== "null") {
			try {
				let serverDoc = await Server.findById(updates.serverId).select("name");
				if (!serverDoc) {
					serverDoc = await Admin.findById(updates.serverId).select("name");
				}
				if (serverDoc) {
					updates.openedBy = serverDoc.name;
				}
			} catch (lookupErr) {
				console.error("⚠️ Lookup serveur pour openedBy:", lookupErr.message);
			}
		}

		try {
			// Récupérer l'ancienne réservation pour l'audit
			const oldReservation = await Reservation.findById(req.params.id);
			if (!oldReservation)
				return res.status(404).json({ message: "Réservation non trouvée" });

			const updated = await Reservation.findByIdAndUpdate(
				req.params.id,
				updates,
				{ new: true },
			).populate("serverId", "name serverId");

			// ⭐ Audit des modifications importantes
			const user = await getAuditUser(req);

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
				"staffNotes",
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

			// ⭐ Émettre l'événement WebSocket pour propager les modifications
			const io = getIO(req);
			if (io && updated.restaurantId) {
				emitReservationEvent(
					io,
					updated.restaurantId,
					"updated",
					updated.toObject(),
				);

				// ⭐ Si un serveur a été assigné, envoyer une notification ciblée
				if (
					updates.serverId &&
					updates.serverId !== oldReservation.serverId?.toString()
				) {
					const targetServerId = updates.serverId;
					// Chercher la socket du serveur cible dans la room du restaurant
					const roomName = `restaurant-${updated.restaurantId}`;
					const room = io.sockets.adapter.rooms.get(roomName);
					if (room) {
						for (const socketId of room) {
							const s = io.sockets.sockets.get(socketId);
							if (s && s.userId === targetServerId) {
								s.emit("notification", {
									type: "server_assigned",
									title: "Nouvelle réservation assignée",
									message: `La réservation de ${updated.clientName} vous a été assignée`,
									reservationId: updated._id,
									clientName: updated.clientName,
									timestamp: new Date().toISOString(),
								});
							}
						}
					}
				}
			}

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
			const user = await getAuditUser(req);
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

			// ⭐ AUTO-ASSIGN : Enregistrer le serveur/admin qui ouvre la réservation
			if (status === "ouverte" && req.user?.id) {
				try {
					let opener = await Server.findById(req.user.id).select("name");
					if (!opener) {
						opener = await Admin.findById(req.user.id).select("name");
					}
					if (opener) {
						reservation.openedBy = opener.name;
						// Assigner serverId seulement si c'est un serveur (ref "Server")
						if (req.user.userType === "server") {
							reservation.serverId = req.user.id;
						}
					}
				} catch (lookupErr) {
					console.error(
						"⚠️ Impossible de récupérer le nom du serveur:",
						lookupErr.message,
					);
					// On continue même si le lookup échoue
				}
			}

			const oldStatus = reservation.status;
			reservation.status = status;

			// ⭐ Audit : changement de statut
			const user = await getAuditUser(req);
			await addAudit(reservation, "status_changed", user, {
				oldValue: oldStatus,
				newValue: status,
			});
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
					{ $set: { paymentStatus: "paid", paid: true, paidAt: new Date() } },
				);

				for (const orderId of reservation.orderIds) {
					const cancelResult = await cancelOpenStripePaymentsForOrder(
						orderId,
						"reservation_payment_finalization",
					);
					if (cancelResult.errors.length > 0) {
						console.warn("⚠️ [RESERVATION_PAYMENT] Annulation intents incomplète", {
							orderId: orderId.toString(),
							errors: cancelResult.errors,
						});
					}
				}
			}

			// Mettre à jour les champs de paiement
			if (paymentMethod) reservation.paymentMethod = paymentMethod;

			// Forcer le statut à "terminée" après paiement
			// (le hook pre("save") va recalculer paidAmount/remainingAmount correctement)
			const oldPayStatus = reservation.status;
			reservation.status = "terminée";
			reservation.isPresent = false; // ⭐ RÈGLE MÉTIER
			reservation.updatedAt = new Date();

			// ⭐ Audit : paiement
			const user = await getAuditUser(req);
			await addAudit(reservation, "payment", user, {
				amount: reservation.totalAmount,
				paymentMethod: paymentMethod || reservation.paymentMethod,
			});
			if (oldPayStatus !== "terminée") {
				await addAudit(reservation, "status_changed", user, {
					oldValue: oldPayStatus,
					newValue: "terminée",
				});
			}
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

			const oldDish = reservation.dishStatus;
			reservation.dishStatus = dishStatus;
			reservation.updatedAt = new Date();

			// ⭐ Audit : changement statut cuisine
			const user = await getAuditUser(req);
			await addAudit(reservation, "dish_status_changed", user, {
				oldValue: oldDish,
				newValue: dishStatus,
				dishStatus,
			});
			await reservation.save();

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

		// 1. Libérer l'ancienne table SI elle existe
		if (oldTableId) {
			const oldTable = await Table.findById(oldTableId);
			if (oldTable) {
				oldTable.isAvailable = true;
				await oldTable.save(); // ⭐ UTILISER save()
			}
		}

		// 2. Occuper la nouvelle table
		const newTable = await Table.findById(tableId);
		if (newTable) {
			newTable.isAvailable = false;
			await newTable.save(); // ⭐ UTILISER save()
		}

		// 3. Mettre à jour la réservation
		const oldReservation = await Reservation.findById(reservationId);
		const updatedReservation = await Reservation.findByIdAndUpdate(
			reservationId,
			{ tableId: tableId },
			{ new: true },
		).populate("tableId");

		// ⭐ Audit : table assignée
		const user = await getAuditUser(req);
		const action = oldReservation?.tableId ? "table_changed" : "table_assigned";
		await addAudit(updatedReservation, action, user, {
			oldValue: oldReservation?.tableId?.toString() || "",
			newValue: tableId,
			tableNumber: newTable?.number || tableId,
		});
		await updatedReservation.save();

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
			const toDelete = await Reservation.findById(req.params.id);
			if (!toDelete)
				return res.status(404).json({ message: "Réservation non trouvée" });

			// ⭐ Audit : suppression (sauvegardé avant delete)
			const user = await getAuditUser(req);
			await addAudit(toDelete, "deleted", user, {
				clientName: toDelete.clientName,
			});
			await toDelete.save();
			await Reservation.findByIdAndDelete(req.params.id);
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

			if (tables.length === 0) {
				console.warn("⚠️ Aucune table liée à ce restaurant");
			} else {
			}

			const {
				date,
				clientName,
				server,
				page = 1,
				limit = 500, // ⭐ Augmenté à 500 pour couvrir l'historique complet
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

			// ⭐ FIX: Filtre date avec range (startOfDay → endOfDay) au lieu d'une comparaison exacte string vs Date
			if (date) {
				const startOfDay = new Date(date);
				startOfDay.setUTCHours(0, 0, 0, 0);
				const endOfDay = new Date(date);
				endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
				endOfDay.setUTCHours(0, 0, 0, 0);
				filter.reservationDate = { $gte: startOfDay, $lt: endOfDay };
			}
			if (clientName) filter.clientName = { $regex: clientName, $options: "i" };
			if (server) filter.server = server;

			const sortOrder = order === "asc" ? 1 : -1;

			const reservations = await Reservation.find(filter)
				.populate("serverId", "name serverId")
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
	},
);

// ⭐⭐ PLACEZ VOTRE ROUTE ICI - À LA FIN DU FICHIER
router.put("/client/:id/close", async (req, res) => {
	try {
		const { id } = req.params;

		// 1. Trouver la réservation
		const reservation = await Reservation.findById(id);
		if (!reservation) {
			return res.status(404).json({ message: "Réservation non trouvée" });
		}

		// 2. Vérifier que la réservation peut être terminée
		if (reservation.status === "terminée") {
			return res.status(400).json({ message: "Réservation déjà terminée" });
		}

		// 3. Mise à jour
		const oldClientStatus = reservation.status;
		reservation.status = "terminée";
		reservation.isPresent = false;

		// ⭐ Audit : fermeture client
		await addAudit(
			reservation,
			"closed_client",
			{ id: null, type: "system", name: "Client" },
			{ oldValue: oldClientStatus, newValue: "terminée" },
		);

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

				const cancelResult = await cancelOpenStripePaymentsForOrder(
					order._id,
					"reservation_client_close",
				);
				if (cancelResult.errors.length > 0) {
					console.warn("⚠️ [CLIENT_CLOSE] Annulation intents incomplète", {
						orderId: order._id.toString(),
						errors: cancelResult.errors,
					});
				}

				// ⚡ Émettre WebSocket pour notifier le frontend
				if (io && order.restaurantId) {
					emitOrderEvent(
						io,
						order.restaurantId.toString(),
						"updated",
						order.toObject(),
					);
				}
			}
			// Log détaillé pour debug
			const debugOrders = await Order.find({
				_id: { $in: reservation.orderIds },
			});
			debugOrders.forEach((o) => {});
		}

		// Forcer la sauvegarde et la propagation du statut
		await reservation.save();
		// Recharger la réservation après save pour obtenir le statut à jour
		const updatedReservation = await Reservation.findById(id);

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
			await Table.findByIdAndUpdate(reservation.tableId, {
				isAvailable: true,
				guests: [],
			});
		}

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

// 🛡️ POST /reservations/client/:reservationId/payment-lock
// Acquiert un lock pessimiste "payeur table" pour 5 min.
// Empêche que 2 clients paient simultanément la note des autres.
router.post(
	"/client/:reservationId/payment-lock",
	auth,
	requireClientDeviceBinding,
	async (req, res) => {
		try {
			if (req.user?.role !== "client") {
				return res.status(403).json({ message: "Réservé aux clients." });
			}
			const { reservationId } = req.params;
			const reservation = await Reservation.findById(reservationId);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation introuvable." });
			}
			// Sécurité : restaurant du token doit matcher
			if (
				reservation.restaurantId?.toString() !==
				req.user.restaurantId?.toString()
			) {
				return res.status(403).json({ message: "Accès refusé." });
			}

			const now = new Date();
			const lock = reservation.paymentLock;
			const isActive =
				lock?.clientId && lock?.expiresAt && new Date(lock.expiresAt) > now;
			const isOwnLock = isActive && lock.clientId === req.user.clientId;

			if (isActive && !isOwnLock) {
				return res.status(409).json({
					locked: true,
					lockedBy: lock.clientName || "un autre client",
					expiresAt: lock.expiresAt,
					message: `${lock.clientName || "Un autre client"} est déjà en train de payer pour la table.`,
				});
			}

			const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min
			reservation.paymentLock = {
				clientId: req.user.clientId,
				clientName:
					req.body?.clientName?.trim?.() ||
					lock?.clientName ||
					"Client",
				lockedAt: now,
				expiresAt,
			};
			await reservation.save();

			return res.json({
				locked: true,
				lockedBy: reservation.paymentLock.clientName,
				expiresAt: reservation.paymentLock.expiresAt,
				ownLock: true,
			});
		} catch (err) {
			console.error("❌ [PAYMENT-LOCK] Erreur:", err);
			return res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// 🛡️ DELETE /reservations/client/:reservationId/payment-lock
// Libère le lock si on en est le détenteur (ex: cancel paiement).
router.delete(
	"/client/:reservationId/payment-lock",
	auth,
	requireClientDeviceBinding,
	async (req, res) => {
		try {
			if (req.user?.role !== "client") {
				return res.status(403).json({ message: "Réservé aux clients." });
			}
			const reservation = await Reservation.findById(
				req.params.reservationId,
			);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation introuvable." });
			}
			const lock = reservation.paymentLock;
			if (!lock?.clientId || lock.clientId !== req.user.clientId) {
				return res
					.status(200)
					.json({ released: false, message: "Aucun lock à libérer." });
			}
			reservation.paymentLock = {
				clientId: null,
				clientName: null,
				lockedAt: null,
				expiresAt: null,
			};
			await reservation.save();
			return res.json({ released: true });
		} catch (err) {
			console.error("❌ [PAYMENT-LOCK] Erreur release:", err);
			return res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

/**
 * POST /reservations/:id/arrive
 * CAS 1/10/13 — Client arrive : créer TableSession(s) + link avec Reservation
 * Gère multi-tables (CAS 10) et override table (CAS 13)
 */
router.post(
	"/:id/arrive",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { overrideTableId, actualArrivalTime } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID réservation invalide" });
			}

			const reservation = await Reservation.findById(id);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation introuvable" });
			}

			if (reservation.tableSessionId) {
				return res.status(400).json({
					message: "Client déjà arrivé (session existe)",
				});
			}

			// Déterminer les tables (multi-tables ou single)
			let tableIds = [];
			if (overrideTableId) {
				// CAS 13 : override table (conflit)
				tableIds = [overrideTableId];
				reservation.originalTableId = reservation.tableId;
				reservation.actualTableId = overrideTableId;
				reservation.reassignReason = req.body.reassignReason || "Staff override";
			} else if (reservation.tableIds && reservation.tableIds.length > 0) {
				// CAS 10 : multi-tables
				tableIds = reservation.tableIds;
			} else if (reservation.tableId) {
				// Single table classique
				tableIds = [reservation.tableId];
			} else {
				return res.status(400).json({
					message: "Aucune table assignée à cette réservation",
				});
			}

			// Vérifier que toutes les tables sont disponibles
			for (const tableId of tableIds) {
				const existingSession = await TableSession.findOne({
					tableId,
					billStatus: { $ne: "closed" },
				});

				if (existingSession) {
					const table = await Table.findById(tableId);
					return res.status(409).json({
						message: `Table ${table?.number || tableId} déjà occupée`,
					});
				}
			}

			// Créer TableSession(s)
			const sessions = [];
			for (let i = 0; i < tableIds.length; i++) {
				const session = new TableSession({
					restaurantId: reservation.restaurantId,
					tableId: tableIds[i],
					reservationId: reservation._id,
					source: "reservation",
					status: "active",
					billStatus: "open",
					openedAt: actualArrivalTime || new Date(),
					groupIndex: tableIds.length > 1 ? i + 1 : null,
				});

				await session.save();
				sessions.push(session);

				// Lock table
				await Table.findByIdAndUpdate(tableIds[i], {
					status: "occupied",
				});
			}

			// Link première session à la résa (ou toutes si multi)
			reservation.tableSessionId = sessions[0]._id;
			reservation.status = "ouverte";
			reservation.arrivalTime = actualArrivalTime || new Date();

			// Audit
			const user = await getAuditUser(req);
			await addAudit(reservation, "status_changed", user, {
				from: reservation.status,
				to: "ouverte",
				note: "Client arrivé",
			});

			await reservation.save();

			// WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId.toString(),
					"updated",
					reservation.toObject()
				);

				sessions.forEach((s) => {
					const { emitTableSessionEvent } = require("../utils/socketEmitter");
					emitTableSessionEvent(
						io,
						reservation.restaurantId.toString(),
						"opened",
						s.toObject()
					);
				});
			}

			res.status(200).json({
				reservation,
				sessions,
			});
		} catch (err) {
			console.error("Erreur arrive client :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

/**
 * PATCH /reservations/:id/no-show
 * CAS 3 — Marquer no-show (client pas venu)
 */
router.patch(
	"/:id/no-show",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID réservation invalide" });
			}

			const reservation = await Reservation.findById(id);
			if (!reservation) {
				return res.status(404).json({ message: "Réservation introuvable" });
			}

			if (reservation.tableSessionId) {
				return res.status(400).json({
					message: "Impossible : client déjà arrivé (session active)",
				});
			}

			reservation.status = "annulée";
			reservation.canceledAt = new Date();

			// Libérer table(s)
			const tableIds = reservation.tableIds?.length > 0
				? reservation.tableIds
				: reservation.tableId
				? [reservation.tableId]
				: [];

			for (const tableId of tableIds) {
				await Table.findByIdAndUpdate(tableId, {
					status: "available",
				});
			}

			// Audit
			const user = await getAuditUser(req);
			await addAudit(reservation, "status_changed", user, {
				from: reservation.status,
				to: "annulée",
				note: "No-show",
			});

			await reservation.save();

			// WebSocket
			const io = getIO(req);
			if (io && reservation.restaurantId) {
				emitReservationEvent(
					io,
					reservation.restaurantId.toString(),
					"no_show",
					reservation.toObject()
				);
			}

			res.status(200).json(reservation);
		} catch (err) {
			console.error("Erreur no-show :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

// 🌐 GET /public/availability/:restaurantId
// Endpoint PUBLIC (pas d'auth) pour afficher les créneaux disponibles
// Utilisé par le site web de réservation
router.get("/public/availability/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { date, guests } = req.query;

		// Validation restaurantId
		if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
			return res.status(400).json({ message: "restaurantId invalide" });
		}

		// Date par défaut = aujourd'hui si non fournie
		const targetDate = date ? new Date(date) : new Date();
		
		// Validation date (pas dans le passé)
		// Normaliser les deux dates à minuit pour comparer uniquement jour/mois/année
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		const targetDateNormalized = new Date(targetDate);
		targetDateNormalized.setHours(0, 0, 0, 0);
		
		if (targetDateNormalized < today) {
			return res.status(400).json({ message: "Date dans le passé" });
		}

		// Vérifier que le restaurant existe
		const restaurant = await Restaurant.findById(restaurantId).select("name category").lean();
		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant introuvable" });
		}

		// Générer les créneaux disponibles
		const slots = await getAvailableSlotsForDay({
			restaurantId,
			date: targetDate,
			guests: guests ? parseInt(guests) : undefined,
		});

		res.json({
			restaurantId,
			restaurantName: restaurant.name,
			date: targetDate.toISOString().split('T')[0],
			guests: guests ? parseInt(guests) : null,
			slots,
			totalSlots: slots.length,
		});
	} catch (err) {
		console.error("❌ [PUBLIC/AVAILABILITY] Erreur:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

module.exports = router;
