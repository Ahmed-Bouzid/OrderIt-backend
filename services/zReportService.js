/**
 * zReportService.js — Logique de calcul et génération du Z de caisse
 *
 * Règles comptables :
 *   grossSalesCents  = Σ(Payment.amount) où status = 'succeeded' sur la période
 *   totalVoidsCents  = Σ(Order.totalAmount × 100) où paymentStatus = 'refunded' (voids)
 *   totalRefundsCents = Σ(Payment.amount) où status IN ('refunded','partially_refunded')
 *   netSalesCents    = grossSalesCents - totalDiscountsCents - totalVoidsCents - totalRefundsCents
 *   cashExpected     = openingFloatCents + Σ(espèces capturées)
 *   cashVariance     = closingCountCents - cashExpectedCents
 *
 *   Tous les montants Order.totalAmount sont en euros float → on multiplie par 100 et Math.round
 *   Les Payment.amount Stripe sont déjà en centimes → pas de conversion
 */

const Order    = require("../models/Order");
const Payment  = require("../models/Payment");
const ZReport  = require("../models/ZReport");

/**
 * Calcule les chiffres du Z sans sauvegarder.
 * Utilisé pour la prévisualisation avant clôture.
 *
 * @param {string} restaurantId
 * @param {Date}   periodStart
 * @param {Date}   periodEnd
 * @returns {Object} données calculées
 */
async function computeZ({ restaurantId, periodStart, periodEnd }) {
	const start = new Date(periodStart);
	const end   = new Date(periodEnd);

	// ── 1. Paiements Stripe capturés sur la période ────────────────────────
	const succeededPayments = await Payment.find({
		restaurantId,
		status: "succeeded",
		createdAt: { $gte: start, $lte: end },
	}).lean();

	const grossSalesCents = succeededPayments.reduce(
		(sum, p) => sum + (p.amount || 0),
		0,
	);

	// ── 2. Remboursements Stripe (refunds) sur la période ─────────────────
	const refundPayments = await Payment.find({
		restaurantId,
		status: { $in: ["refunded", "partially_refunded"] },
		createdAt: { $gte: start, $lte: end },
	}).lean();

	const totalRefundsCents = refundPayments.reduce(
		(sum, p) => sum + (p.amount || 0),
		0,
	);

	// ── 3. Commandes annulées sur la période ──────────────────────────────
	const cancelledOrders = await Order.find({
		restaurantId,
		orderStatus: "cancelled",
		createdAt: { $gte: start, $lte: end },
	})
		.select("totalAmount")
		.lean();

	// totalAmount est un float (ex: 25.50) → centimes = Math.round(25.50 * 100)
	const totalVoidsCents = cancelledOrders.reduce(
		(sum, o) => sum + Math.round((o.totalAmount || 0) * 100),
		0,
	);

	// ── 4. Nombre total de commandes (hors annulées) ─────────────────────
	const activeOrders = await Order.find({
		restaurantId,
		orderStatus: { $ne: "cancelled" },
		createdAt: { $gte: start, $lte: end },
	})
		.select("totalAmount paymentMethod")
		.lean();

	const ticketCount = activeOrders.length;

	// ── 5. Ticket le plus élevé ──────────────────────────────────────────
	const maxTicketCents =
		activeOrders.length > 0
			? Math.max(...activeOrders.map((o) => Math.round((o.totalAmount || 0) * 100)))
			: 0;

	// ── 6. Détail par moyen de paiement ──────────────────────────────────
	const paymentMap = {};
	for (const p of succeededPayments) {
		const method = p.paymentMethod || "other";
		if (!paymentMap[method]) {
			paymentMap[method] = { method, amountCents: 0, ticketCount: 0 };
		}
		paymentMap[method].amountCents += p.amount || 0;
		paymentMap[method].ticketCount += 1;
	}
	const paymentBreakdown = Object.values(paymentMap);

	// ── 7. CA net ────────────────────────────────────────────────────────
	const totalDiscountsCents = 0; // réservé pour future implémentation des remises
	const netSalesCents =
		grossSalesCents - totalDiscountsCents - totalVoidsCents - totalRefundsCents;

	// ── 8. Panier moyen ─────────────────────────────────────────────────
	const avgBasketCents = ticketCount > 0 ? Math.round(netSalesCents / ticketCount) : 0;

	return {
		grossSalesCents,
		totalDiscountsCents,
		totalVoidsCents,
		totalRefundsCents,
		netSalesCents,
		paymentBreakdown,
		ticketCount,
		voidCount:    cancelledOrders.length,
		refundCount:  refundPayments.length,
		avgBasketCents,
		maxTicketCents,
	};
}

/**
 * Génère et scelle le Z de caisse.
 * Idempotent : si un Z existe déjà sur cette période exacte, le retourne.
 *
 * @param {string} restaurantId
 * @param {Date|string} periodStart
 * @param {Date|string} periodEnd
 * @param {number} openingFloatCents   — fond initial (centimes)
 * @param {number} closingCountCents   — espèces comptées (centimes)
 * @param {string} generatedBy         — ObjectId du serveur/manager
 * @param {string} [notes]
 * @returns {ZReport}
 */
async function generateZ({
	restaurantId,
	periodStart,
	periodEnd,
	openingFloatCents,
	closingCountCents,
	generatedBy,
	notes = "",
}) {
	const start = new Date(periodStart);
	const end   = new Date(periodEnd);

	// ── Idempotence : vérifier si un Z existe déjà ───────────────────────
	const existing = await ZReport.findOne({
		restaurantId,
		periodStart: start,
		periodEnd: end,
	});
	if (existing) return existing;

	// ── Calcul ────────────────────────────────────────────────────────────
	const computed = await computeZ({ restaurantId, periodStart: start, periodEnd: end });

	// ── Numéro séquentiel (dernier Z du restaurant + 1) ───────────────────
	const lastZ = await ZReport.findOne({ restaurantId })
		.sort({ sequenceNumber: -1 })
		.select("sequenceNumber")
		.lean();
	const sequenceNumber = (lastZ?.sequenceNumber ?? 0) + 1;

	// ── Espèces ───────────────────────────────────────────────────────────
	const cashEntry = computed.paymentBreakdown.find((p) => p.method === "cash");
	const cashSalesCents = cashEntry?.amountCents ?? 0;
	const cashExpectedCents = openingFloatCents + cashSalesCents;
	const cashVarianceCents = closingCountCents - cashExpectedCents;

	// ── Création ─────────────────────────────────────────────────────────
	const z = await ZReport.create({
		restaurantId,
		sequenceNumber,
		periodStart: start,
		periodEnd: end,
		generatedBy,
		openingFloatCents,
		closingCountCents,
		cashExpectedCents,
		cashVarianceCents,
		...computed,
		notes,
		status: "sealed",
	});

	return z;
}

module.exports = { computeZ, generateZ };
