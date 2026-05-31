/**
 * zReports.js — Endpoints Z de caisse
 *
 * Endpoints :
 *  GET  /z-reports/preview?restaurantId=&from=&to=  — aperçu (lecture seule)
 *  POST /z-reports/generate                          — générer & sceller le Z
 *  GET  /z-reports?restaurantId=&page=&limit=        — liste paginée
 *  GET  /z-reports/:id?restaurantId=                 — détail d'un Z
 *
 * Réservé aux admins du restaurant.
 * Source de données : TableSession (source=counter, billStatus=closed) + Orders paid.
 */

const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const auth       = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const TableSession = require("../models/TableSession");
const ZReport      = require("../models/ZReport");

// ─────────────────────────────────────────────────────────────────────────────
// Helper — Agrège les sessions fermées d'un restaurant sur une période
// ─────────────────────────────────────────────────────────────────────────────
async function computeZData(restaurantId, fromDate, toDate) {
	const sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt:   { $gte: fromDate, $lte: toDate },
	}).lean();

	const breakdown = {};
	let grossCents = 0;
	let maxCents   = 0;

	for (const s of sessions) {
		const amtCents = Math.round((s.totalAmount || 0) * 100);
		// Normaliser les méthodes : card_offline → card
		const method = s.paymentMethod === "card_offline" ? "card" : (s.paymentMethod || "cash");

		if (!breakdown[method]) {
			breakdown[method] = { method, amountCents: 0, ticketCount: 0 };
		}
		breakdown[method].amountCents += amtCents;
		breakdown[method].ticketCount += 1;
		grossCents += amtCents;
		if (amtCents > maxCents) maxCents = amtCents;
	}

	const ticketCount      = sessions.length;
	const netSalesCents    = grossCents;
	const avgBasketCents   = ticketCount > 0 ? Math.round(netSalesCents / ticketCount) : 0;
	const paymentBreakdown = Object.values(breakdown);

	return {
		grossSalesCents:   grossCents,
		totalRefundsCents: 0,
		totalVoidsCents:   0,
		netSalesCents,
		paymentBreakdown,
		ticketCount,
		avgBasketCents,
		maxTicketCents:    maxCents,
		voidCount:         0,
		refundCount:       0,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /z-reports/preview
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	"/preview",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const { restaurantId, from, to } = req.query;

			if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide." });
			}
			if (!from || !to) {
				return res.status(400).json({ message: "Paramètres from et to requis." });
			}

			const fromDate = new Date(from);
			const toDate   = new Date(to);
			if (isNaN(fromDate) || isNaN(toDate)) {
				return res.status(400).json({ message: "Dates invalides." });
			}

			const data = await computeZData(restaurantId, fromDate, toDate);
			return res.json({ data });
		} catch (err) {
			console.error("[Z-REPORT] preview error:", err);
			return res.status(500).json({ message: "Erreur serveur." });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /z-reports/generate
// ─────────────────────────────────────────────────────────────────────────────
router.post(
	"/generate",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const {
				restaurantId,
				periodStart,
				periodEnd,
				openingFloatCents = 0,
				closingCountCents = 0,
				notes = "",
			} = req.body;

			if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide." });
			}
			if (!periodStart || !periodEnd) {
				return res.status(400).json({ message: "periodStart et periodEnd requis." });
			}

			const fromDate = new Date(periodStart);
			const toDate   = new Date(periodEnd);
			if (isNaN(fromDate) || isNaN(toDate)) {
				return res.status(400).json({ message: "Dates invalides." });
			}

			// Calculer les données
			const zData = await computeZData(restaurantId, fromDate, toDate);

			// Calculer l'écart caisse
			const cashEntry  = zData.paymentBreakdown.find((p) => p.method === "cash");
			const cashSales  = cashEntry ? cashEntry.amountCents : 0;
			const expectedCash   = (openingFloatCents || 0) + cashSales;
			const cashVarianceCents = (closingCountCents || 0) - expectedCash;

			// Numéro séquentiel (par restaurant)
			const lastZ = await ZReport.findOne(
				{ restaurantId },
				{ sequenceNumber: 1 },
				{ sort: { sequenceNumber: -1 } },
			).lean();
			const sequenceNumber = (lastZ?.sequenceNumber || 0) + 1;

			// Créer et sauvegarder
			const report = await ZReport.create({
				restaurantId,
				sequenceNumber,
				periodStart:  fromDate,
				periodEnd:    toDate,
				...zData,
				openingFloatCents: openingFloatCents || 0,
				closingCountCents: closingCountCents || 0,
				cashVarianceCents,
				generatedBy: req.user?.id || null,
				notes,
			});

			return res.status(201).json({ data: report });
		} catch (err) {
			console.error("[Z-REPORT] generate error:", err);
			return res.status(500).json({ message: "Erreur serveur." });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /z-reports  (liste paginée)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	"/",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.query;
			const page  = Math.max(1, parseInt(req.query.page  || "1",  10));
			const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));

			if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide." });
			}

			const total = await ZReport.countDocuments({ restaurantId });
			const data  = await ZReport.find({ restaurantId })
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean();

			return res.json({
				data,
				meta: {
					total,
					page,
					limit,
					pages: Math.ceil(total / limit),
				},
			});
		} catch (err) {
			console.error("[Z-REPORT] list error:", err);
			return res.status(500).json({ message: "Erreur serveur." });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /z-reports/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	"/:id",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { restaurantId } = req.query;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID invalide." });
			}
			if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide." });
			}

			const report = await ZReport.findOne({ _id: id, restaurantId }).lean();
			if (!report) {
				return res.status(404).json({ message: "Z de caisse introuvable." });
			}

			return res.json({ data: report });
		} catch (err) {
			console.error("[Z-REPORT] getById error:", err);
			return res.status(500).json({ message: "Erreur serveur." });
		}
	},
);

module.exports = router;
