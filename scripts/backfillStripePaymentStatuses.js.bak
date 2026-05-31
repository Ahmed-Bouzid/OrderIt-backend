require("dotenv").config();
const mongoose = require("mongoose");
const Stripe = require("stripe");

const Payment = require("../models/Payment");
const Order = require("../models/Order");

const MONGO_URI = process.env.MONGO_URI;
const STRIPE_SECRET_KEY =
	process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;

function parseArgs() {
	const args = process.argv.slice(2);
	return {
		apply: args.includes("--apply"),
		onlyTest: args.includes("--only-test"),
		limit: (() => {
			const limitArg = args.find((a) => a.startsWith("--limit="));
			if (!limitArg) return 500;
			const value = Number(limitArg.split("=")[1]);
			return Number.isFinite(value) && value > 0 ? value : 500;
		})(),
	};
}

function mapStripeStatusToLocal(stripeStatus) {
	switch (stripeStatus) {
		case "succeeded":
			return "succeeded";
		case "processing":
			return "processing";
		case "requires_action":
			return "requires_action";
		case "canceled":
			return "canceled";
		case "requires_payment_method":
		case "payment_failed":
			return "failed";
		default:
			return null;
	}
}

async function syncOrderOnSucceeded(payment, now, apply) {
	if (!payment.orderId) return { updatedOrder: false };

	const order = await Order.findById(payment.orderId).maxTimeMS(10000);
	if (!order) return { updatedOrder: false };

	const shouldUpdate = !order.paid || order.paymentStatus !== "paid";
	if (!shouldUpdate) return { updatedOrder: false };

	if (apply) {
		order.paid = true;
		order.paymentStatus = "paid";
		order.paidAmount = payment.amount / 100;
		order.tip = payment.tipAmount / 100;
		order.paidAt = now;
		if (order.orderStatus === "pending") {
			order.orderStatus = "confirmed";
		}
		await order.save();
	}

	return { updatedOrder: true };
}

async function run() {
	const { apply, onlyTest, limit } = parseArgs();

	if (!MONGO_URI) {
		throw new Error("MONGO_URI manquant");
	}

	if (!STRIPE_SECRET_KEY) {
		throw new Error("STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY manquant");
	}

	const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

	await mongoose.connect(MONGO_URI);
	console.log("✅ MongoDB connecté");

	const query = {
		status: { $in: ["pending", "processing", "requires_action"] },
		stripePaymentIntentId: { $exists: true, $ne: null },
	};
	if (onlyTest) {
		query.isTest = true;
	}

	const pendingPayments = await Payment.find(query)
		.sort({ createdAt: -1 })
		.limit(limit)
		.maxTimeMS(15000);

	console.log(
		`🔎 ${pendingPayments.length} paiements candidats (apply=${apply}, onlyTest=${onlyTest}, limit=${limit})`,
	);

	let checked = 0;
	let changed = 0;
	let toSucceeded = 0;
	let toFailed = 0;
	let toCanceled = 0;
	let toProcessing = 0;
	let toRequiresAction = 0;
	let ordersUpdated = 0;
	let notFoundOnStripe = 0;
	let stripeErrors = 0;

	for (const payment of pendingPayments) {
		checked += 1;
		const paymentIntentId = payment.stripePaymentIntentId;

		let paymentIntent;
		try {
			paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
		} catch (err) {
			if (err && err.code === "resource_missing") {
				notFoundOnStripe += 1;
				console.warn(`⚠️ Introuvable sur Stripe: ${paymentIntentId}`);
				continue;
			}
			stripeErrors += 1;
			console.warn(`⚠️ Erreur Stripe pour ${paymentIntentId}: ${err.message}`);
			continue;
		}

		const localTargetStatus = mapStripeStatusToLocal(paymentIntent.status);
		if (!localTargetStatus) {
			continue;
		}

		if (payment.status === localTargetStatus) {
			continue;
		}

		changed += 1;

		if (localTargetStatus === "succeeded") toSucceeded += 1;
		if (localTargetStatus === "failed") toFailed += 1;
		if (localTargetStatus === "canceled") toCanceled += 1;
		if (localTargetStatus === "processing") toProcessing += 1;
		if (localTargetStatus === "requires_action") toRequiresAction += 1;

		console.log(
			`↻ ${payment._id.toString()}: ${payment.status} -> ${localTargetStatus} (${paymentIntentId})`,
		);

		if (!apply) {
			continue;
		}

		const now = new Date();
		if (localTargetStatus === "succeeded") {
			let cardDetails = null;
			if (paymentIntent.charges?.data?.length > 0) {
				const method = paymentIntent.charges.data[0].payment_method_details;
				if (method?.card) {
					cardDetails = {
						brand: method.card.brand,
						last4: method.card.last4,
						expMonth: method.card.exp_month,
						expYear: method.card.exp_year,
					};
				}
			}

			payment.status = "succeeded";
			payment.confirmedAt = now;
			if (cardDetails) {
				payment.cardDetails = cardDetails;
			}
			payment.stripeEvents.push({
				eventId: paymentIntent.id,
				eventType: "backfill.payment_intent.succeeded",
				receivedAt: now,
			});
			await payment.save();

			const orderSync = await syncOrderOnSucceeded(payment, now, true);
			if (orderSync.updatedOrder) {
				ordersUpdated += 1;
			}
			continue;
		}

		if (localTargetStatus === "failed") {
			payment.status = "failed";
			payment.failedAt = now;
			payment.errorMessage =
				paymentIntent.last_payment_error?.message || payment.errorMessage || null;
			payment.errorCode =
				paymentIntent.last_payment_error?.code || payment.errorCode || null;
			payment.stripeEvents.push({
				eventId: paymentIntent.id,
				eventType: "backfill.payment_intent.failed",
				receivedAt: now,
			});
			await payment.save();
			continue;
		}

		if (localTargetStatus === "canceled") {
			payment.status = "canceled";
			payment.stripeEvents.push({
				eventId: paymentIntent.id,
				eventType: "backfill.payment_intent.canceled",
				receivedAt: now,
			});
			await payment.save();
			continue;
		}

		if (localTargetStatus === "processing") {
			payment.status = "processing";
			await payment.save();
			continue;
		}

		if (localTargetStatus === "requires_action") {
			payment.status = "requires_action";
			await payment.save();
		}
	}

	console.log("\n📊 Résumé backfill:");
	console.log(`- Vérifiés: ${checked}`);
	console.log(`- Changements détectés: ${changed}`);
	console.log(`- -> succeeded: ${toSucceeded}`);
	console.log(`- -> failed: ${toFailed}`);
	console.log(`- -> canceled: ${toCanceled}`);
	console.log(`- -> processing: ${toProcessing}`);
	console.log(`- -> requires_action: ${toRequiresAction}`);
	console.log(`- Orders mis à jour: ${ordersUpdated}`);
	console.log(`- Introuvables Stripe: ${notFoundOnStripe}`);
	console.log(`- Erreurs Stripe: ${stripeErrors}`);
	console.log(apply ? "✅ APPLY terminé" : "✅ DRY-RUN terminé (aucune écriture)");

	await mongoose.disconnect();
}

run().catch(async (err) => {
	console.error("❌ Erreur backfill:", err.message);
	try {
		await mongoose.disconnect();
	} catch (_) {
		// no-op
	}
	process.exit(1);
});
