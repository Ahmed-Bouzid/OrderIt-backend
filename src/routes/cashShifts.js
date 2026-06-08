/**
 * cashShifts.js — Gestion des shifts de caisse (Event Sourcing)
 * 
 * Endpoints :
 *  POST /cash-shifts/open                — Ouvrir un nouveau shift
 *  POST /cash-shifts/:id/close           — Fermer un shift + générer Z
 *  GET  /cash-shifts/active              — Récupérer le shift actif
 *  GET  /cash-shifts                     — Liste des shifts (pagination)
 *  GET  /cash-shifts/:id                 — Détail d'un shift
 */

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const CashShift = require("../models/CashShift");
const ZReport = require("../models/ZReport");
const Event = require("../models/Event");
const ZProjectionService = require("../services/ZProjectionService");

// ═══════════════════════════════════════════════════════════════════════════════
// POST /cash-shifts/open — Ouvrir un nouveau shift
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
	"/open",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const { restaurantId, id: userId } = req.user;
			const { openingFloatCents, deviceId, notes } = req.body;

			if (typeof openingFloatCents !== "number" || openingFloatCents < 0) {
				return res.status(400).json({ message: "openingFloatCents doit être >= 0" });
			}

			// Vérifier qu'aucun shift n'est déjà ouvert
			const existing = await CashShift.getActiveShift(restaurantId);
			if (existing) {
				return res.status(409).json({
					message: "Un shift est déjà ouvert",
					shift: existing,
				});
			}

			// Ouvrir le shift
			const shift = await CashShift.openShift(
				restaurantId,
				userId,
				openingFloatCents,
				deviceId,
			);

			if (notes) {
				shift.notes = notes;
				await shift.save();
			}

			// Créer l'événement shift_opened
			const idempotencyKey = `shift_opened_${shift._id}_${Date.now()}`;
			await Event.createIdempotent({
				eventType: "shift_opened",
				idempotencyKey,
				restaurantId,
				shiftId: shift._id,
				payload: {
					sequenceNumber: shift.sequenceNumber,
					openingFloatCents,
					deviceId,
				},
				occurredAt: shift.openedAt,
				actorId: userId,
				actorType: "admin",
			});

			return res.status(201).json({
				success: true,
				message: "Shift ouvert avec succès",
				shift,
			});
		} catch (err) {
			console.error("[CASH-SHIFT] open error:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /cash-shifts/:id/close — Fermer un shift + générer Z
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
	"/:id/close",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			const { id: shiftId } = req.params;
			const { restaurantId, id: userId } = req.user;
			const { closingCountCents, notes } = req.body;

			if (typeof closingCountCents !== "number" || closingCountCents < 0) {
				return res.status(400).json({ message: "closingCountCents doit être >= 0" });
			}

			if (!mongoose.Types.ObjectId.isValid(shiftId)) {
				return res.status(400).json({ message: "shiftId invalide" });
			}

			// Récupérer le shift
			const shift = await CashShift.findOne({ _id: shiftId, restaurantId }).session(session);
			if (!shift) {
				await session.abortTransaction();
				return res.status(404).json({ message: "Shift introuvable" });
			}

			if (shift.status === "closed") {
				await session.abortTransaction();
				return res.status(409).json({ message: "Shift déjà fermé" });
			}

			// Étape 1 : Marquer "closing" pour empêcher nouveaux tickets
			if (shift.status === "open") {
				await shift.startClosing(userId);
			}

			// Étape 2 : Générer le Z depuis les events
			const zData = await ZProjectionService.projectShift(
				restaurantId,
				shift._id,
				shift.openingFloatCents,
			);

			// Calculer l'écart caisse
			const cashVarianceCents = closingCountCents - zData.expectedCashCents;

			// Récupérer le dernier numéro de Z
			const lastZ = await ZReport.findOne(
				{ restaurantId },
				{ sequenceNumber: 1 },
				{ sort: { sequenceNumber: -1 }, session },
			).lean();
			const sequenceNumber = (lastZ?.sequenceNumber || 0) + 1;

			// Créer l'idempotency key
			const idempotencyKey = `z_${restaurantId}_${shift._id}_${Date.now()}`;

			// Créer le hash de vérification
			const checksumData = JSON.stringify({
				restaurantId,
				shiftId: shift._id,
				sequenceNumber,
				...zData,
				openingFloatCents: shift.openingFloatCents,
				closingCountCents,
			});
			const checksumSHA256 = crypto.createHash("sha256").update(checksumData).digest("hex");

			// Créer le Z
			const zReport = await ZReport.create(
				[
					{
						restaurantId,
						shiftId: shift._id,
						idempotencyKey,
						generationMode: "event_sourced",
						sequenceNumber,
						periodStart: shift.openedAt,
						periodEnd: new Date(),
						...zData,
						openingFloatCents: shift.openingFloatCents,
						closingCountCents,
						cashVarianceCents,
						generatedBy: userId,
						notes: notes || "",
						checksumSHA256,
					},
				],
				{ session },
			);

			// Étape 3 : Verrouiller tous les events du shift
			const eventsLocked = await Event.lockShiftEvents(
				restaurantId,
				shift._id,
				zReport[0]._id,
			);

			// Mettre à jour le nombre d'events verrouillés
			zReport[0].eventsLocked = eventsLocked;
			await zReport[0].save({ session });

			// Étape 4 : Finaliser la fermeture du shift
			await shift.finalizeClosure(zReport[0]._id, closingCountCents);
			await shift.save({ session });

			// Créer l'événement shift_closed
			const closedIdempotencyKey = `shift_closed_${shift._id}_${Date.now()}`;
			await Event.createIdempotent({
				eventType: "shift_closed",
				idempotencyKey: closedIdempotencyKey,
				restaurantId,
				shiftId: shift._id,
				payload: {
					zReportId: zReport[0]._id,
					sequenceNumber: zReport[0].sequenceNumber,
					closingCountCents,
					cashVarianceCents,
					eventsLocked,
				},
				occurredAt: new Date(),
				actorId: userId,
				actorType: "admin",
				isLocked: true,
				lockedByZReport: zReport[0]._id,
			});

			await session.commitTransaction();

			return res.status(201).json({
				success: true,
				message: "Shift fermé et Z généré avec succès",
				shift,
				zReport: zReport[0],
			});
		} catch (err) {
			await session.abortTransaction();
			console.error("[CASH-SHIFT] close error:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		} finally {
			session.endSession();
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /cash-shifts/active — Récupérer le shift actif
// ═══════════════════════════════════════════════════════════════════════════════
router.get(
	"/active",
	auth,
	checkRoles(["admin", "manager", "server"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;

			const shift = await CashShift.getActiveShift(restaurantId);

			if (!shift) {
				return res.json({
					success: true,
					shift: null,
					message: "Aucun shift actif",
				});
			}

			return res.json({
				success: true,
				shift,
			});
		} catch (err) {
			console.error("[CASH-SHIFT] get active error:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /cash-shifts — Liste paginée des shifts
// ═══════════════════════════════════════════════════════════════════════════════
router.get(
	"/",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;
			const page = Math.max(1, parseInt(req.query.page || "1", 10));
			const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));

			const total = await CashShift.countDocuments({ restaurantId });
			const shifts = await CashShift.find({ restaurantId })
				.sort({ openedAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.populate("openedBy", "name")
				.populate("closedBy", "name")
				.populate("zReportId", "sequenceNumber netSalesCents")
				.lean();

			return res.json({
				success: true,
				data: shifts,
				meta: {
					total,
					page,
					limit,
					pages: Math.ceil(total / limit),
				},
			});
		} catch (err) {
			console.error("[CASH-SHIFT] list error:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /cash-shifts/:id — Détail d'un shift
// ═══════════════════════════════════════════════════════════════════════════════
router.get(
	"/:id",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const { id: shiftId } = req.params;
			const { restaurantId } = req.user;

			if (!mongoose.Types.ObjectId.isValid(shiftId)) {
				return res.status(400).json({ message: "shiftId invalide" });
			}

			const shift = await CashShift.findOne({ _id: shiftId, restaurantId })
				.populate("openedBy", "name email")
				.populate("closedBy", "name email")
				.populate("zReportId")
				.lean();

			if (!shift) {
				return res.status(404).json({ message: "Shift introuvable" });
			}

			// Récupérer les events du shift
			const events = await Event.find({ shiftId: shift._id })
				.sort({ occurredAt: 1 })
				.select("eventType payload occurredAt actorId isLocked")
				.populate("actorId", "name")
				.lean();

			return res.json({
				success: true,
				shift,
				eventsCount: events.length,
				events: events.slice(0, 100), // Limiter à 100 pour éviter payload trop gros
			});
		} catch (err) {
			console.error("[CASH-SHIFT] get error:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		}
	},
);

module.exports = router;
