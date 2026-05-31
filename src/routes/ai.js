/**
 * ai.js — Routes API pour les 9 fonctions d'IA de réservation
 * Montées dans server.js sous /ai
 *
 * Toutes les routes nécessitent un token JWT valide (middleware auth).
 *
 * GET  /ai/:restaurantId/smart-slots?date=YYYY-MM-DD&guests=N
 * GET  /ai/:restaurantId/alternatives?date=YYYY-MM-DD&time=HH:MM&guests=N
 * POST /ai/:restaurantId/auto-assign/:reservationId
 * GET  /ai/:restaurantId/heatmap?weeks=N
 * GET  /ai/:restaurantId/gaps?date=YYYY-MM-DD
 * GET  /ai/:restaurantId/smart-duration?guests=N
 * GET  /ai/:restaurantId/waiting-list?date=YYYY-MM-DD
 * POST /ai/:restaurantId/promote-waiting  body: { date, freedTableId }
 * GET  /ai/:restaurantId/predict?date=YYYY-MM-DD&weeks=N
 * GET  /ai/:restaurantId/strategic-slots
 */

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const {
	generateSmartSlots,
	suggestAlternativeSlots,
	autoAssignTable,
	buildHeatmap,
	detectGaps,
	getSmartDuration,
	getWaitingList,
	promoteFromWaitingList,
	predictAffluence,
	recommendStrategicSlots,
} = require("../services/reservationAI");

// ─── Helper ──────────────────────────────────────────────────────────────────
const handle = (fn) => async (req, res) => {
	try {
		const result = await fn(req, res);
		res.json(result);
	} catch (e) {
		console.error("❌ [AI]", e.message);
		res.status(500).json({ message: e.message });
	}
};

// ─── 1. Créneaux enrichis ────────────────────────────────────────────────────
// GET /ai/:restaurantId/smart-slots?date=YYYY-MM-DD&guests=N
router.get(
	"/:restaurantId/smart-slots",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { date, guests } = req.query;
		if (!date) throw new Error("Paramètre 'date' requis");
		return generateSmartSlots(restaurantId, date, Number(guests) || 0);
	}),
);

// ─── 2. Alternatives si créneau complet ──────────────────────────────────────
// GET /ai/:restaurantId/alternatives?date=YYYY-MM-DD&time=HH:MM&guests=N
router.get(
	"/:restaurantId/alternatives",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { date, time, guests } = req.query;
		if (!date || !time) throw new Error("Paramètres 'date' et 'time' requis");
		return suggestAlternativeSlots(
			restaurantId,
			date,
			time,
			Number(guests) || 0,
		);
	}),
);

// ─── 3. Auto-assignation de table ────────────────────────────────────────────
// POST /ai/:restaurantId/auto-assign/:reservationId
router.post(
	"/:restaurantId/auto-assign/:reservationId",
	auth,
	handle(async (req, res) => {
		const { restaurantId, reservationId } = req.params;
		const result = await autoAssignTable(restaurantId, reservationId);
		if (!result) {
			res
				.status(404)
				.json({ message: "Aucune table disponible pour ce créneau" });
			return null; // stopper le handle
		}
		return result;
	}),
);

// ─── 4. Heatmap ──────────────────────────────────────────────────────────────
// GET /ai/:restaurantId/heatmap?weeks=N
router.get(
	"/:restaurantId/heatmap",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { weeks } = req.query;
		return buildHeatmap(restaurantId, Number(weeks) || 8);
	}),
);

// ─── 5. Détection de trous ───────────────────────────────────────────────────
// GET /ai/:restaurantId/gaps?date=YYYY-MM-DD
router.get(
	"/:restaurantId/gaps",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { date } = req.query;
		if (!date) throw new Error("Paramètre 'date' requis");
		return detectGaps(restaurantId, date);
	}),
);

// ─── 6. Durée intelligente ───────────────────────────────────────────────────
// GET /ai/:restaurantId/smart-duration?guests=N
router.get(
	"/:restaurantId/smart-duration",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { guests } = req.query;
		return getSmartDuration(restaurantId, Number(guests) || 2);
	}),
);

// ─── 7. Liste d'attente ──────────────────────────────────────────────────────
// GET /ai/:restaurantId/waiting-list?date=YYYY-MM-DD
router.get(
	"/:restaurantId/waiting-list",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { date } = req.query;
		if (!date) throw new Error("Paramètre 'date' requis");
		return getWaitingList(restaurantId, date);
	}),
);

// POST /ai/:restaurantId/promote-waiting
// body: { date: "YYYY-MM-DD", freedTableId: "..." }
router.post(
	"/:restaurantId/promote-waiting",
	auth,
	handle(async (req, res) => {
		const { restaurantId } = req.params;
		const { date, freedTableId } = req.body;
		if (!date || !freedTableId)
			throw new Error("Paramètres 'date' et 'freedTableId' requis");
		const result = await promoteFromWaitingList(
			restaurantId,
			freedTableId,
			date,
		);
		if (!result) {
			res
				.status(404)
				.json({ message: "Aucune réservation en attente compatible" });
			return null;
		}
		return result;
	}),
);

// ─── 8. Prédiction d'affluence ───────────────────────────────────────────────
// GET /ai/:restaurantId/predict?date=YYYY-MM-DD&weeks=N
router.get(
	"/:restaurantId/predict",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		const { date, weeks } = req.query;
		if (!date) throw new Error("Paramètre 'date' requis");
		return predictAffluence(restaurantId, date, Number(weeks) || 8);
	}),
);

// ─── 9. Créneaux stratégiques ────────────────────────────────────────────────
// GET /ai/:restaurantId/strategic-slots
router.get(
	"/:restaurantId/strategic-slots",
	auth,
	handle(async (req) => {
		const { restaurantId } = req.params;
		return recommendStrategicSlots(restaurantId);
	}),
);

module.exports = router;
