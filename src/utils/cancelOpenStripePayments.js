const Payment = require("../models/Payment");
const stripeService = require("../services/stripeService");

const OPEN_PAYMENT_STATUSES = ["pending", "processing", "requires_action"];

async function cancelOpenStripePaymentsForOrder(orderId, context = "unknown") {
	if (!orderId) {
		return { canceled: 0, errors: [] };
	}

	const openPayments = await Payment.find({
		orderId,
		status: { $in: OPEN_PAYMENT_STATUSES },
		isFake: { $ne: true },
		stripePaymentIntentId: { $exists: true, $ne: null },
	})
		.sort({ createdAt: -1 })
		.maxTimeMS(10000);

	let canceled = 0;
	const errors = [];

	for (const payment of openPayments) {
		try {
			if (stripeService.isConfigured()) {
				await stripeService.cancelPaymentIntent(payment.stripePaymentIntentId);
			} else {
				payment.status = "canceled";
				await payment.save();
			}
			canceled += 1;
		} catch (err) {
			const message = err?.message || "unknown_error";

			// Stripe peut répondre que l'intent est déjà finalisé/cancelled.
			if (
				/payment_intent_unexpected_state|already canceled|No such payment_intent/i.test(
					message,
				)
			) {
				try {
					const latestIntent = stripeService.isConfigured()
						? await stripeService.getPaymentIntent(payment.stripePaymentIntentId)
						: null;

					if (latestIntent?.status === "canceled") {
						payment.status = "canceled";
						await payment.save();
						canceled += 1;
						continue;
					}
					if (latestIntent?.status === "succeeded") {
						payment.status = "succeeded";
						if (!payment.confirmedAt) payment.confirmedAt = new Date();
						await payment.save();
						continue;
					}
				} catch (syncErr) {
					errors.push(
						`[${context}] sync_failed payment=${payment._id}: ${syncErr.message}`,
					);
				}
			}

			errors.push(`[${context}] cancel_failed payment=${payment._id}: ${message}`);
		}
	}

	return { canceled, errors };
}

module.exports = {
	cancelOpenStripePaymentsForOrder,
};
