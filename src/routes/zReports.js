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
const Order        = require("../models/Order");
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /z-reports/sessions — sessions fermées détaillées avec leurs orders
// Utilisé pour l'export Z détaillé côté frontend
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	"/sessions",
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

			// Sessions fermées de la période
			const sessions = await TableSession.find({
				restaurantId,
				billStatus: "closed",
				closedAt: { $gte: fromDate, $lte: toDate },
			})
				.populate("tableId", "number")
				.populate("serverId", "name")
				.lean();

			// Orders associés à ces sessions
			const sessionIds = sessions.map((s) => s._id);
			const orders = await Order.find({
				tableSessionId: { $in: sessionIds },
				orderStatus: { $ne: "cancelled" },
			})
				.populate("serverId", "name")
				.lean();

			// Indexer les orders par sessionId
			const ordersBySession = {};
			for (const o of orders) {
				const key = o.tableSessionId?.toString();
				if (!key) continue;
				if (!ordersBySession[key]) ordersBySession[key] = [];
				ordersBySession[key].push(o);
			}

			// Assembler
			const result = sessions.map((s) => ({
				...s,
				orders: ordersBySession[s._id.toString()] || [],
			}));

			// Trier par closedAt croissant
			result.sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));

			return res.json({ data: result });
		} catch (err) {
			console.error("[Z-REPORT] sessions error:", err);
			return res.status(500).json({ message: "Erreur serveur." });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 GET /z-reports/pilotage — Z de caisse avec indicateurs de pilotage
// type=basic (simplifié) ou type=complet (full dashboard)
// ═══════════════════════════════════════════════════════════════════════════════
router.get(
	"/pilotage",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;
			const {
				type = "basic",
				from,
				to,
				openingFloatCents = 0,
				closingCountCents = 0,
			} = req.query;

			// Validation type
			if (!["basic", "complet"].includes(type)) {
				return res.status(400).json({ message: "Type doit être 'basic' ou 'complet'." });
			}

			// Dates par défaut : aujourd'hui minuit → maintenant
			const now = new Date();
			const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const toDate = to ? new Date(to) : now;

			if (isNaN(fromDate) || isNaN(toDate)) {
				return res.status(400).json({ message: "Dates invalides." });
			}

			const rid = new mongoose.Types.ObjectId(restaurantId);

			// ═══ CALCUL DES DONNÉES SELON LE TYPE ═══
			const data = type === "basic"
				? await computeBasicZ(rid, fromDate, toDate, parseInt(openingFloatCents), parseInt(closingCountCents))
				: await computeCompletZ(rid, fromDate, toDate, parseInt(openingFloatCents), parseInt(closingCountCents));

			return res.json({
				success: true,
				type,
				period: {
					from: fromDate.toISOString(),
					to: toDate.toISOString(),
				},
				data,
			});
		} catch (err) {
			console.error("[Z-PILOTAGE] Erreur:", err);
			return res.status(500).json({ message: "Erreur serveur.", error: err.message });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// 📊 HELPER — Z de caisse BASIC (indicateurs essentiels)
// ─────────────────────────────────────────────────────────────────────────────
async function computeBasicZ(restaurantId, fromDate, toDate, openingFloatCents, closingCountCents) {
	const TZ_MS = 2 * 60 * 60 * 1000; // UTC+2 France

	// ═══ 1. SESSIONS FERMÉES ═══
	const sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: fromDate, $lte: toDate },
	}).lean();

	// ═══ 2. VENTILATION PAR MOYEN DE PAIEMENT + CA TOTAL ═══
	const paymentBreakdown = { cash: 0, card: 0, other: 0 };
	let totalTTC = 0;
	let ticketCount = sessions.length;

	for (const s of sessions) {
		const amt = s.totalAmount || 0;
		totalTTC += amt;

		const method = s.paymentMethod === "card_offline" ? "card" : (s.paymentMethod || "cash");
		if (method === "cash") paymentBreakdown.cash += amt;
		else if (method === "card") paymentBreakdown.card += amt;
		else paymentBreakdown.other += amt;
	}

	// ═══ 3. CA HT + TVA (simplifié : on suppose 20% global) ═══
	const totalHT = totalTTC / 1.2;
	const totalTVA = totalTTC - totalHT;

	// ═══ 4. TICKET MOYEN ═══
	const ticketMoyen = ticketCount > 0 ? totalTTC / ticketCount : 0;

	// ═══ 5. REMISES / OFFERTS / ANNULATIONS ═══
	let totalDiscounts = 0;
	let totalVoids = 0;

	for (const s of sessions) {
		if (s.pricing?.totalDiscounts) totalDiscounts += s.pricing.totalDiscounts;
	}

	// Annulations = orders cancelled
	const cancelledOrders = await Order.find({
		restaurantId,
		orderStatus: "cancelled",
		createdAt: { $gte: fromDate, $lt: toDate },
	}).lean();

	for (const o of cancelledOrders) {
		totalVoids += o.totalAmount || 0;
	}

	// ═══ 6. ÉCART CAISSE ═══
	const cashSales = paymentBreakdown.cash * 100; // en centimes
	const expectedCashCents = openingFloatCents + cashSales;
	const varianceCents = closingCountCents - expectedCashCents;
	const variancePercent = expectedCashCents > 0 ? (varianceCents / expectedCashCents) * 100 : 0;
	
	// Alerte si écart > 2%
	const cashAlert = Math.abs(variancePercent) > 2 ? "ALERTE_ECART_CAISSE" : null;

	// ═══ 7. FRAIS BANCAIRES CB (estimation 1.5%) ═══
	const cardFees = paymentBreakdown.card * 0.015;

	// ═══ 8. RÉSULTAT ESTIMÉ (marge simplifiée : -30% matières -20% charges variables) ═══
	const estimatedCost = totalTTC * 0.3; // 30% food cost
	const estimatedCharges = totalTTC * 0.2; // 20% charges variables
	const estimatedResult = totalTTC - estimatedCost - estimatedCharges - cardFees;

	// ═══ 9. TOP 3 PRODUITS ═══
	const ordersWithItems = await Order.find({
		restaurantId,
		orderStatus: { $ne: "cancelled" },
		createdAt: { $gte: fromDate, $lt: toDate },
	}).select("items").lean();

	const productStats = {};
	for (const order of ordersWithItems) {
		for (const item of order.items || []) {
			const name = item.name || "Produit inconnu";
			if (!productStats[name]) {
				productStats[name] = { quantity: 0, revenue: 0 };
			}
			productStats[name].quantity += item.quantity || 1;
			productStats[name].revenue += (item.price || 0) * (item.quantity || 1);
		}
	}

	const top3Products = Object.entries(productStats)
		.sort(([, a], [, b]) => b.revenue - a.revenue)
		.slice(0, 3)
		.map(([name, stats]) => ({
			name,
			quantity: stats.quantity,
			revenue: Number(stats.revenue.toFixed(2)),
		}));

	// ═══ 10. COMPARAISON J-7 ═══
	const j7Start = new Date(fromDate.getTime() - 7 * 24 * 60 * 60 * 1000);
	const j7End = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

	const j7Sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: j7Start, $lte: j7End },
	}).lean();

	let j7TotalTTC = 0;
	const j7TicketCount = j7Sessions.length;
	for (const s of j7Sessions) {
		j7TotalTTC += s.totalAmount || 0;
	}
	const j7TicketMoyen = j7TicketCount > 0 ? j7TotalTTC / j7TicketCount : 0;

	const compareJ7 = {
		ca: {
			j7: Number(j7TotalTTC.toFixed(2)),
			current: Number(totalTTC.toFixed(2)),
			variation: j7TotalTTC > 0 ? ((totalTTC - j7TotalTTC) / j7TotalTTC) * 100 : 0,
		},
		ticketMoyen: {
			j7: Number(j7TicketMoyen.toFixed(2)),
			current: Number(ticketMoyen.toFixed(2)),
			variation: j7TicketMoyen > 0 ? ((ticketMoyen - j7TicketMoyen) / j7TicketMoyen) * 100 : 0,
		},
	};

	// ═══ 11. STATUT CLÔTURE ═══
	const anomalies = [];
	if (cashAlert) anomalies.push(cashAlert);
	if (totalVoids > totalTTC * 0.05) anomalies.push("TAUX_ANNULATION_ELEVE"); // >5%
	if (compareJ7.ca.variation < -20) anomalies.push("CHUTE_CA_IMPORTANTE");

	const status = anomalies.length === 0 ? "OK" : "ANOMALIE";

	// ═══ RETOUR BASIC ═══
	return {
		// Financiers
		caTTC: Number(totalTTC.toFixed(2)),
		caHT: Number(totalHT.toFixed(2)),
		tvaTotale: Number(totalTVA.toFixed(2)),

		// Paiements
		paymentBreakdown: {
			cash: Number(paymentBreakdown.cash.toFixed(2)),
			card: Number(paymentBreakdown.card.toFixed(2)),
			other: Number(paymentBreakdown.other.toFixed(2)),
		},

		// Tickets
		ticketCount,
		ticketMoyen: Number(ticketMoyen.toFixed(2)),

		// Réductions / Erreurs
		totalDiscounts: Number(totalDiscounts.toFixed(2)),
		totalVoids: Number(totalVoids.toFixed(2)),

		// Caisse
		cashVariance: {
			expectedCents: Math.round(expectedCashCents),
			countedCents: closingCountCents,
			varianceCents: Math.round(varianceCents),
			variancePercent: Number(variancePercent.toFixed(2)),
			alert: cashAlert,
		},

		// Frais
		cardFees: Number(cardFees.toFixed(2)),

		// Résultat
		estimatedResult: {
			totalRevenue: Number(totalTTC.toFixed(2)),
			estimatedCosts: Number(estimatedCost.toFixed(2)),
			estimatedCharges: Number(estimatedCharges.toFixed(2)),
			cardFees: Number(cardFees.toFixed(2)),
			netResult: Number(estimatedResult.toFixed(2)),
			marginPercent: totalTTC > 0 ? Number(((estimatedResult / totalTTC) * 100).toFixed(1)) : 0,
		},

		// Produits
		top3Products,

		// Comparaison
		compareJ7,

		// Statut
		status,
		anomalies,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 📊 HELPER — Z de caisse COMPLET (dashboard full pilotage)
// ─────────────────────────────────────────────────────────────────────────────
async function computeCompletZ(restaurantId, fromDate, toDate, openingFloatCents, closingCountCents) {
	const TZ_MS = 2 * 60 * 60 * 1000; // UTC+2 France

	// ═══ 1. SESSIONS FERMÉES ═══
	const sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: fromDate, $lte: toDate },
	}).lean();

	// ═══ 2. VENTILATION PAR MOYEN DE PAIEMENT + CA TOTAL ═══
	const paymentBreakdown = { cash: 0, card: 0, other: 0 };
	let totalTTC = 0;
	let ticketCount = sessions.length;
	let totalCouverts = 0;
	let maxTicket = 0;

	for (const s of sessions) {
		const amt = s.totalAmount || 0;
		totalTTC += amt;
		if (amt > maxTicket) maxTicket = amt;

		const method = s.paymentMethod === "card_offline" ? "card" : (s.paymentMethod || "cash");
		if (method === "cash") paymentBreakdown.cash += amt;
		else if (method === "card") paymentBreakdown.card += amt;
		else paymentBreakdown.other += amt;

		// Estimer couverts (si dispo, sinon on suppose 1 couvert par session)
		totalCouverts += s.guestCount || 1;
	}

	// ═══ 3. CA HT + TVA DÉTAILLÉE PAR TAUX ═══
	// Simplifié : on suppose 20% pour boissons/resto standard, 10% pour certains produits
	// Dans un vrai système, on itère sur items.vatRate
	const totalHT = totalTTC / 1.2;
	const tva20 = totalTTC - totalHT;
	const tva10 = 0; // À calculer si items ont vatRate

	// ═══ 4. TICKET MOYEN ═══
	const ticketMoyen = ticketCount > 0 ? totalTTC / ticketCount : 0;

	// ═══ 5. REMISES / OFFERTS / ANNULATIONS ═══
	let totalDiscounts = 0;
	let totalOfferts = 0;
	let offertsCount = 0;
	let totalVoids = 0;

	for (const s of sessions) {
		if (s.pricing?.totalDiscounts) totalDiscounts += s.pricing.totalDiscounts;
		
		// Offerts = discounts avec reason "geste_commercial" ou "anniversaire"
		for (const disc of s.discounts || []) {
			if (["geste_commercial", "anniversaire", "client_fidele"].includes(disc.reason)) {
				totalOfferts += disc.amountDeducted || 0;
				offertsCount++;
			}
		}
	}

	// Annulations = orders cancelled
	const cancelledOrders = await Order.find({
		restaurantId,
		orderStatus: "cancelled",
		createdAt: { $gte: fromDate, $lt: toDate },
	}).lean();

	let cancelledItems = 0;
	for (const o of cancelledOrders) {
		totalVoids += o.totalAmount || 0;
		cancelledItems += o.items?.length || 0;
	}

	// ═══ 6. ÉCART CAISSE ═══
	const cashSales = paymentBreakdown.cash * 100; // en centimes
	const expectedCashCents = openingFloatCents + cashSales;
	const varianceCents = closingCountCents - expectedCashCents;
	const variancePercent = expectedCashCents > 0 ? (varianceCents / expectedCashCents) * 100 : 0;

	// ═══ 7. FRAIS BANCAIRES CB ═══
	const cardFees = paymentBreakdown.card * 0.015; // 1.5% terminal
	const pspFees = paymentBreakdown.card * 0.0025; // 0.25% PSP

	// ═══ 8. MARGES + COÛTS ═══
	const estimatedFoodCost = totalTTC * 0.3; // 30%
	const foodCostPercent = 30;
	const estimatedLaborCost = totalTTC * 0.25; // 25% (estimation basique)
	const laborCostPercent = 25;
	const grossMargin = totalTTC - estimatedFoodCost;
	const grossMarginPercent = totalTTC > 0 ? (grossMargin / totalTTC) * 100 : 0;
	const netResult = totalTTC - estimatedFoodCost - estimatedLaborCost - cardFees - pspFees;

	// ═══ 9. TOP PRODUITS (quantité + CA + marge) ═══
	const ordersWithItems = await Order.find({
		restaurantId,
		orderStatus: { $ne: "cancelled" },
		createdAt: { $gte: fromDate, $lt: toDate },
	}).select("items").lean();

	const productStats = {};
	for (const order of ordersWithItems) {
		for (const item of order.items || []) {
			const name = item.name || "Produit inconnu";
			if (!productStats[name]) {
				productStats[name] = { quantity: 0, revenue: 0 };
			}
			productStats[name].quantity += item.quantity || 1;
			const itemRevenue = (item.price || 0) * (item.quantity || 1);
			productStats[name].revenue += itemRevenue;
			// Marge = revenue - 30% food cost
			productStats[name].margin = productStats[name].revenue * 0.7;
		}
	}

	const topProducts = Object.entries(productStats)
		.sort(([, a], [, b]) => b.revenue - a.revenue)
		.slice(0, 10)
		.map(([name, stats]) => ({
			name,
			quantity: stats.quantity,
			revenue: Number(stats.revenue.toFixed(2)),
			margin: Number((stats.margin || 0).toFixed(2)),
		}));

	// Produits annulés
	const cancelledProductStats = {};
	for (const order of cancelledOrders) {
		for (const item of order.items || []) {
			const name = item.name || "Produit inconnu";
			if (!cancelledProductStats[name]) {
				cancelledProductStats[name] = { count: 0, amount: 0 };
			}
			cancelledProductStats[name].count += item.quantity || 1;
			cancelledProductStats[name].amount += (item.price || 0) * (item.quantity || 1);
		}
	}

	const cancelledProducts = Object.entries(cancelledProductStats)
		.sort(([, a], [, b]) => b.count - a.count)
		.slice(0, 5)
		.map(([name, stats]) => ({
			name,
			count: stats.count,
			amount: Number(stats.amount.toFixed(2)),
		}));

	// ═══ 10. TEMPS MOYEN DE SERVICE (approximation) ═══
	let totalServiceTime = 0;
	let sessionsWithTime = 0;
	for (const s of sessions) {
		if (s.openedAt && s.closedAt) {
			const duration = (new Date(s.closedAt) - new Date(s.openedAt)) / 1000 / 60; // minutes
			if (duration > 0 && duration < 300) { // ignore aberrations
				totalServiceTime += duration;
				sessionsWithTime++;
			}
		}
	}
	const avgServiceTimeMinutes = sessionsWithTime > 0 ? totalServiceTime / sessionsWithTime : 0;

	// ═══ 11. HEURES DE PIC (ventes par tranche horaire) ═══
	const hourlyRevenue = Array(24).fill(0);
	const hourlyOrders = Array(24).fill(0);
	for (const s of sessions) {
		const hour = new Date(s.closedAt).getUTCHours() + 2; // UTC+2
		const h = hour % 24;
		hourlyRevenue[h] += s.totalAmount || 0;
		hourlyOrders[h]++;
	}

	const hourlyDistribution = hourlyRevenue.map((rev, h) => ({
		hour: h,
		revenue: Number(rev.toFixed(2)),
		orders: hourlyOrders[h],
	})).filter(h => h.revenue > 0);

	// Heure de pic
	const peakHour = hourlyRevenue.indexOf(Math.max(...hourlyRevenue));
	const peakRevenue = hourlyRevenue[peakHour];

	// ═══ 12. PERFORMANCE PAR SERVICE (midi / soir) ═══
	const serviceBreakdown = { midi: { revenue: 0, orders: 0, couverts: 0 }, soir: { revenue: 0, orders: 0, couverts: 0 } };
	for (const s of sessions) {
		const hour = new Date(s.closedAt).getUTCHours() + 2;
		const h = hour % 24;
		const service = (h >= 11 && h < 16) ? "midi" : (h >= 18 && h <= 23) ? "soir" : null;
		if (service) {
			serviceBreakdown[service].revenue += s.totalAmount || 0;
			serviceBreakdown[service].orders++;
			serviceBreakdown[service].couverts += s.guestCount || 1;
		}
	}

	// ═══ 13. COMPARAISON J-7 + MOYENNE MENSUELLE ═══
	const j7Start = new Date(fromDate.getTime() - 7 * 24 * 60 * 60 * 1000);
	const j7End = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

	const j7Sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: j7Start, $lte: j7End },
	}).lean();

	let j7TotalTTC = 0;
	const j7TicketCount = j7Sessions.length;
	for (const s of j7Sessions) {
		j7TotalTTC += s.totalAmount || 0;
	}
	const j7TicketMoyen = j7TicketCount > 0 ? j7TotalTTC / j7TicketCount : 0;

	// Moyenne mensuelle (30 derniers jours)
	const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	const monthSessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: monthStart, $lte: toDate },
	}).lean();

	let monthTotalTTC = 0;
	for (const s of monthSessions) {
		monthTotalTTC += s.totalAmount || 0;
	}
	const monthAvgDaily = monthTotalTTC / 30;

	const compareJ7 = {
		ca: {
			j7: Number(j7TotalTTC.toFixed(2)),
			current: Number(totalTTC.toFixed(2)),
			variation: j7TotalTTC > 0 ? Number((((totalTTC - j7TotalTTC) / j7TotalTTC) * 100).toFixed(1)) : 0,
		},
		ticketMoyen: {
			j7: Number(j7TicketMoyen.toFixed(2)),
			current: Number(ticketMoyen.toFixed(2)),
			variation: j7TicketMoyen > 0 ? Number((((ticketMoyen - j7TicketMoyen) / j7TicketMoyen) * 100).toFixed(1)) : 0,
		},
		monthAvgDaily: Number(monthAvgDaily.toFixed(2)),
		vsMonthAvg: monthAvgDaily > 0 ? Number((((totalTTC - monthAvgDaily) / monthAvgDaily) * 100).toFixed(1)) : 0,
	};

	// ═══ 14. PROJECTIONS FIN DE MOIS ═══
	const now = new Date();
	const dayOfMonth = now.getDate();
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const projectedMonthRevenue = (totalTTC / dayOfMonth) * daysInMonth;
	const projectedMonthResult = (netResult / dayOfMonth) * daysInMonth;
	const projectedTVA = (tva20 / dayOfMonth) * daysInMonth;

	// ═══ 15. ALERTES ANOMALIES ═══
	const alerts = [];

	// Dérive food cost (si >35%)
	if (foodCostPercent > 35) alerts.push({ type: "DERIVE_FOOD_COST", severity: "warning", message: `Food cost élevé: ${foodCostPercent}%` });

	// Chute ticket moyen (>15% vs J-7)
	if (compareJ7.ticketMoyen.variation < -15) alerts.push({ type: "CHUTE_TICKET_MOYEN", severity: "error", message: `Baisse ticket moyen: ${compareJ7.ticketMoyen.variation.toFixed(1)}%` });

	// Hausse annulations (>5% du CA)
	const voidRate = totalTTC > 0 ? (totalVoids / totalTTC) * 100 : 0;
	if (voidRate > 5) alerts.push({ type: "HAUSSE_ANNULATIONS", severity: "warning", message: `Taux annulation: ${voidRate.toFixed(1)}%` });

	// Écart caisse inhabituel (>2%)
	if (Math.abs(variancePercent) > 2) alerts.push({ type: "ECART_CAISSE", severity: "error", message: `Écart caisse: ${variancePercent.toFixed(2)}%` });

	// Baisse marge produit clé (top 1 sous 50%)
	if (topProducts.length > 0) {
		const topProductMarginPercent = topProducts[0].revenue > 0 ? (topProducts[0].margin / topProducts[0].revenue) * 100 : 0;
		if (topProductMarginPercent < 50) alerts.push({ type: "BAISSE_MARGE_PRODUIT_CLE", severity: "info", message: `Marge ${topProducts[0].name}: ${topProductMarginPercent.toFixed(1)}%` });
	}

	// ═══ 16. STATUT CLÔTURE ═══
	const hasCriticalAlerts = alerts.some(a => a.severity === "error");
	const status = hasCriticalAlerts ? "INCOHERENT" : (alerts.length > 0 ? "A_VERIFIER" : "OK");

	// ═══ RETOUR COMPLET ═══
	return {
		// Financiers
		netResult: Number(netResult.toFixed(2)),
		caTTC: Number(totalTTC.toFixed(2)),
		caHT: Number(totalHT.toFixed(2)),
		grossMargin: {
			amount: Number(grossMargin.toFixed(2)),
			percent: Number(grossMarginPercent.toFixed(1)),
		},
		costs: {
			foodCost: Number(estimatedFoodCost.toFixed(2)),
			foodCostPercent,
			laborCost: Number(estimatedLaborCost.toFixed(2)),
			laborCostPercent,
		},
		tva: {
			total: Number((tva20 + tva10).toFixed(2)),
			tva20: { base: Number((totalTTC * 0.833).toFixed(2)), amount: Number(tva20.toFixed(2)) },
			tva10: { base: Number(tva10.toFixed(2)), amount: Number(tva10.toFixed(2)) },
		},

		// Paiements
		paymentBreakdown: {
			cash: Number(paymentBreakdown.cash.toFixed(2)),
			card: Number(paymentBreakdown.card.toFixed(2)),
			other: Number(paymentBreakdown.other.toFixed(2)),
		},

		// Tickets
		ticketCount,
		totalCouverts,
		ticketMoyen: Number(ticketMoyen.toFixed(2)),
		maxTicket: Number(maxTicket.toFixed(2)),

		// Réductions / Erreurs
		discounts: {
			total: Number(totalDiscounts.toFixed(2)),
			offerts: { amount: Number(totalOfferts.toFixed(2)), count: offertsCount },
		},
		voids: {
			amount: Number(totalVoids.toFixed(2)),
			count: cancelledOrders.length,
			items: cancelledItems,
		},

		// Caisse
		cashVariance: {
			expectedCents: Math.round(expectedCashCents),
			countedCents: closingCountCents,
			varianceCents: Math.round(varianceCents),
			variancePercent: Number(variancePercent.toFixed(2)),
		},

		// Frais
		bankingFees: {
			cardTerminal: Number(cardFees.toFixed(2)),
			psp: Number(pspFees.toFixed(2)),
			total: Number((cardFees + pspFees).toFixed(2)),
		},

		// Produits
		topProducts,
		cancelledProducts,

		// Temps
		avgServiceTimeMinutes: Number(avgServiceTimeMinutes.toFixed(1)),

		// Heures de pic
		hourlyDistribution,
		peakHour: { hour: peakHour, revenue: Number(peakRevenue.toFixed(2)) },

		// Services
		serviceBreakdown: {
			midi: {
				revenue: Number(serviceBreakdown.midi.revenue.toFixed(2)),
				orders: serviceBreakdown.midi.orders,
				couverts: serviceBreakdown.midi.couverts,
			},
			soir: {
				revenue: Number(serviceBreakdown.soir.revenue.toFixed(2)),
				orders: serviceBreakdown.soir.orders,
				couverts: serviceBreakdown.soir.couverts,
			},
		},

		// Comparaisons
		compareJ7,

		// Projections
		projections: {
			monthRevenue: Number(projectedMonthRevenue.toFixed(2)),
			monthResult: Number(projectedMonthResult.toFixed(2)),
			monthTVA: Number(projectedTVA.toFixed(2)),
		},

		// Alertes
		alerts,
		status,
	};
}

module.exports = router;
