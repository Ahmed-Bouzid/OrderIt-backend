const express = require("express");
const router = express.Router();
const stripeService = require("../services/stripeService");
const Payment = require("../models/Payment");
const Order = require("../models/Order");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const { body, validationResult } = require("express-validator");
const {
	emitOrderEvent,
	emitPaymentCompleted,
} = require("../utils/socketEmitter");

function isAdmin(req) {
	return req.user?.role === "admin";
}

function isRestaurantStaff(req) {
	return ["admin", "server"].includes(req.user?.role);
}

function hasSameRestaurantAccess(req, restaurantId) {
	if (isAdmin(req)) {
		return true;
	}

	return Boolean(
		req.user?.restaurantId &&
		restaurantId &&
		restaurantId.toString() === req.user.restaurantId.toString(),
	);
}

function canAccessOrder(req, order) {
	if (!order) {
		return false;
	}

	if (isAdmin(req)) {
		return true;
	}

	if (req.user?.role === "server") {
		return hasSameRestaurantAccess(req, order.restaurantId);
	}

	if (req.user?.role !== "client") {
		return false;
	}

	if (!hasSameRestaurantAccess(req, order.restaurantId)) {
		return false;
	}

	if (req.user.clientId && order.clientId) {
		return order.clientId.toString() === req.user.clientId.toString();
	}

	if (req.user.tableId && order.tableId) {
		return order.tableId.toString() === req.user.tableId.toString();
	}

	return false;
}

async function getPaymentAndOrderByIntentId(paymentIntentId) {
	const payment = await Payment.findOne({ stripePaymentIntentId: paymentIntentId }).maxTimeMS(10000);
	if (!payment) {
		return { payment: null, order: null };
	}

	if (!payment.orderId) {
		return { payment, order: null };
	}

	const order = await Order.findById(payment.orderId).maxTimeMS(10000);
	return { payment, order };
}

async function getPaymentAndOrderByPaymentId(paymentId) {
	const payment = await Payment.findById(paymentId).maxTimeMS(10000);
	if (!payment) {
		return { payment: null, order: null };
	}

	if (!payment.orderId) {
		return { payment, order: null };
	}

	const order = await Order.findById(payment.orderId).maxTimeMS(10000);
	return { payment, order };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/create-intent
// Crée un PaymentIntent Stripe
// Accessible par: client (via token spécial) ou admin/server
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/create-intent",
	auth,
	[
		body("orderId").notEmpty().withMessage("orderId requis"),
		body("amount")
			.isInt({ min: 50 })
			.withMessage("Montant minimum 50 centimes"),
		body("currency").optional().isString(),
		body("paymentMethodTypes").optional().isArray(),
		body("tipAmount").optional().isInt({ min: 0 }),
		body("paymentMode")
			.optional()
			.isIn(["client", "terminal"])
			.withMessage("paymentMode doit être 'client' ou 'terminal'"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const {
				orderId,
				amount,
				currency = "eur",
				paymentMethodTypes = ["card"],
				tipAmount = 0,
				paymentMode = "client",
				metadata = {},
			} = req.body;

			// ── Sécurité : vérifier que la commande existe et appartient au restaurant du JWT ──
			const order = await Order.findById(orderId).lean();
			if (!order) {
				return res.status(404).json({ error: "Commande introuvable." });
			}

			if (!canAccessOrder(req, order)) {
				return res.status(403).json({ error: "Accès refusé à cette commande." });
			}

			// ── Sécurité : valider que le montant déclaré ≥ total réel de la commande ──
			// Empêche un client de sous-déclarer le montant pour payer moins
			const orderTotalCents = Math.round((order.totalAmount || 0) * 100);
			if (amount < orderTotalCents) {
				return res.status(400).json({
					error: "Montant insuffisant.",
					message: `Le montant déclaré (${amount} cts) est inférieur au total de la commande (${orderTotalCents} cts).`,
				});
			}

			// Vérifier que Stripe est configuré
			if (!stripeService.isConfigured()) {
				return res.status(503).json({
					error: "Service de paiement indisponible",
					message:
						"Stripe n'est pas configuré. Contactez l'administrateur ou utilisez le mode fake.",
				});
			}

			// Créer le PaymentIntent
			const result = await stripeService.createPaymentIntent({
				orderId,
				amount,
				currency,
				paymentMode,
				paymentMethodTypes,
				tipAmount,
				metadata: {
					...metadata,
					userId: req.user.id || req.user.clientId,
					userRole: req.user.role,
				},
			});

			// Retourner le client_secret au front
			res.json({
				success: true,
				clientSecret: result.clientSecret,
				paymentIntentId: result.paymentIntent.id,
				paymentId: result.payment._id,
				amount: result.payment.amount,
				currency: result.payment.currency,
			});
		} catch (err) {
			console.error("❌ Erreur création PaymentIntent:", err);

			// Erreurs Stripe spécifiques
			if (err.type === "StripeCardError") {
				return res.status(400).json({
					error: "Erreur carte",
					message: err.message,
				});
			}

			res.status(500).json({
				error: "Erreur serveur",
				message: err.message,
			});
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/confirm
// Confirme un PaymentIntent (optionnel, généralement géré côté client)
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/confirm",
	auth,
	[
		body("paymentIntentId").notEmpty().withMessage("paymentIntentId requis"),
		body("paymentMethodId").optional().isString(),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { paymentIntentId, paymentMethodId } = req.body;
			const { payment, order } = await getPaymentAndOrderByIntentId(paymentIntentId);

			if (!payment || !order) {
				return res.status(404).json({ error: "Paiement introuvable" });
			}

			if (!canAccessOrder(req, order)) {
				return res.status(403).json({ error: "Accès non autorisé" });
			}


			const paymentIntent = await stripeService.confirmPaymentIntent(
				paymentIntentId,
				paymentMethodId,
			);

			res.json({
				success: true,
				status: paymentIntent.status,
				paymentIntent,
			});
		} catch (err) {
			console.error("❌ Erreur confirmation PaymentIntent:", err);
			res.status(500).json({
				error: "Erreur serveur",
				message: err.message,
			});
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/confirm-test
// Confirme un PaymentIntent avec la carte test Stripe 4242 4242 4242 4242
// 🧪 MODE TEST UNIQUEMENT - Pour simulateur Tap to Pay
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/confirm-test",
	auth,
	checkRoles(["admin", "server"]),
	[body("paymentIntentId").notEmpty().withMessage("paymentIntentId requis")],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { paymentIntentId } = req.body;

			if (process.env.NODE_ENV === "production") {
				return res.status(403).json({ error: "Route de test désactivée en production" });
			}

			const { payment, order } = await getPaymentAndOrderByIntentId(paymentIntentId);

			if (!payment || !order) {
				return res.status(404).json({ error: "Paiement introuvable" });
			}

			if (!hasSameRestaurantAccess(req, payment.restaurantId)) {
				return res.status(403).json({ error: "Accès non autorisé" });
			}


			const paymentIntent =
				await stripeService.confirmWithTestCard(paymentIntentId);

			res.json({
				success: true,
				status: paymentIntent.status,
				paymentIntentId: paymentIntent.id,
				testMode: true,
			});
		} catch (err) {
			console.error("❌ Erreur confirmation test:", err);
			res.status(500).json({
				error: "Erreur serveur",
				message: err.message,
			});
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/cancel
// Annule un PaymentIntent
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/cancel",
	auth,
	checkRoles(["admin", "server"]),
	[body("paymentIntentId").notEmpty().withMessage("paymentIntentId requis")],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { paymentIntentId } = req.body;
			const { payment } = await getPaymentAndOrderByIntentId(paymentIntentId);

			if (!payment) {
				return res.status(404).json({ error: "Paiement introuvable" });
			}

			if (!hasSameRestaurantAccess(req, payment.restaurantId)) {
				return res.status(403).json({ error: "Accès non autorisé" });
			}


			const paymentIntent =
				await stripeService.cancelPaymentIntent(paymentIntentId);

			res.json({
				success: true,
				status: paymentIntent.status,
			});
		} catch (err) {
			console.error("❌ Erreur annulation PaymentIntent:", err);
			res.status(500).json({
				error: "Erreur serveur",
				message: err.message,
			});
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: GET /payments/:paymentId/status
// Récupère uniquement le statut d'un paiement (pour polling)
// ════════════════════════════════════════════════════════════════════════════

router.get("/:paymentId/status", auth, async (req, res) => {
	try {
		const payment = await Payment.findById(req.params.paymentId).select(
			"status stripePaymentIntentId amount currency createdAt updatedAt orderId paymentMethod restaurantId",
		);

		if (!payment) {
			return res.status(404).json({ error: "Paiement introuvable" });
		}

		const order = await Order.findById(payment.orderId).select(
			"restaurantId clientId tableId paid paidAt paymentMethod",
		);

		if (!order) {
			return res.status(404).json({ error: "Commande associée introuvable" });
		}

		if (!canAccessOrder(req, order)) {
			return res.status(403).json({ error: "Accès non autorisé" });
		}

		// Si le paiement est en pending, vérifier le statut sur Stripe
		if (payment.status === "pending" && payment.stripePaymentIntentId) {
			try {
				const stripePI = await stripeService.getPaymentIntent(
					payment.stripePaymentIntentId,
				);

				// Mettre à jour le statut local si changé
				if (stripePI.status !== payment.status) {
					payment.status =
						stripePI.status === "succeeded" ? "succeeded" : stripePI.status;
					await payment.save();

					// Si succès, marquer la commande comme payée
					if (stripePI.status === "succeeded") {
						const order = await Order.findById(payment.orderId);
						if (order && !order.paid) {
							order.paid = true;
							order.paidAt = new Date();
							order.paymentMethod = payment.paymentMethod;
							await order.save();

						}
					}
				}
			} catch (stripeError) {
				console.error("⚠️ Erreur vérification Stripe:", stripeError.message);
				// Continuer avec le statut local
			}
		}

		res.json({
			status: payment.status,
			amount: payment.amount,
			currency: payment.currency,
			paymentIntentId: payment.stripePaymentIntentId,
			createdAt: payment.createdAt,
			updatedAt: payment.updatedAt,
		});
	} catch (err) {
		console.error("❌ Erreur récupération statut paiement:", err);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: GET /payments/:paymentId
// Récupère les détails d'un paiement
// ════════════════════════════════════════════════════════════════════════════

router.get("/payments/:paymentId", auth, async (req, res) => {
	try {
		const payment = await Payment.findById(req.params.paymentId)
			.populate("orderId", "items totalAmount orderStatus")
			.populate("restaurantId", "name")
			.maxTimeMS(10000);

		if (!payment) {
			return res.status(404).json({ error: "Paiement introuvable" });
		}

		// Vérifier les permissions (admin, serveur du restaurant, ou client de la commande)
		const order = await Order.findById(payment.orderId);
		if (!canAccessOrder(req, order)) {
			return res.status(403).json({ error: "Accès non autorisé" });
		}

		res.json(payment);
	} catch (err) {
		console.error("❌ Erreur récupération paiement:", err);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: GET /payments/order/:orderId
// Récupère tous les paiements d'une commande
// ════════════════════════════════════════════════════════════════════════════

router.get("/order/:orderId", auth, async (req, res) => {
	try {
		const order = await Order.findById(req.params.orderId).select(
			"restaurantId clientId tableId",
		);

		if (!order) {
			return res.status(404).json({ error: "Commande introuvable" });
		}

		if (!canAccessOrder(req, order)) {
			return res.status(403).json({ error: "Accès non autorisé" });
		}

		const payments = await Payment.find({ orderId: req.params.orderId })
			.sort({ createdAt: -1 })
			.maxTimeMS(10000);

		res.json(payments);
	} catch (err) {
		console.error("❌ Erreur récupération paiements:", err);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: GET /payments/restaurant/:restaurantId
// Liste tous les paiements d'un restaurant
// ════════════════════════════════════════════════════════════════════════════

router.get(
	"/restaurant/:restaurantId",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { startDate, endDate, status } = req.query;

			if (!hasSameRestaurantAccess(req, req.params.restaurantId)) {
				return res.status(403).json({ error: "Accès refusé — restaurant non correspondant" });
			}

			const query = { restaurantId: req.params.restaurantId };

			if (status) {
				query.status = status;
			}

			if (startDate || endDate) {
				query.createdAt = {};
				if (startDate) query.createdAt.$gte = new Date(startDate);
				if (endDate) query.createdAt.$lte = new Date(endDate);
			}

			const payments = await Payment.find(query)
				.sort({ createdAt: -1 })
				.populate("orderId", "items totalAmount")
				.limit(100)
				.maxTimeMS(10000);

			// Calcul des statistiques
			const totalRevenue = payments
				.filter((p) => p.status === "succeeded")
				.reduce((sum, p) => sum + p.amount, 0);

			const totalTips = payments
				.filter((p) => p.status === "succeeded")
				.reduce((sum, p) => sum + p.tipAmount, 0);

			res.json({
				payments,
				stats: {
					total: payments.length,
					succeeded: payments.filter((p) => p.status === "succeeded").length,
					failed: payments.filter((p) => p.status === "failed").length,
					pending: payments.filter((p) => p.status === "pending").length,
					totalRevenue: totalRevenue / 100, // Convertir en euros
					totalTips: totalTips / 100,
				},
			});
		} catch (err) {
			console.error("❌ Erreur récupération paiements restaurant:", err);
			res.status(500).json({ error: "Erreur serveur" });
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/fake
// Crée un paiement FAKE pour développement
// ⚠️ À DÉSACTIVER EN PRODUCTION
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/fake",
	auth,
	checkRoles(["admin", "server"]),
	[
		body("orderId").notEmpty().withMessage("orderId requis"),
		body("amount")
			.isInt({ min: 50 })
			.withMessage("Montant minimum 50 centimes"),
		body("tipAmount").optional().isInt({ min: 0 }),
	],
	async (req, res) => {
		// ⚠️ Vérifier l'environnement
		if (
			process.env.NODE_ENV === "production" &&
			!process.env.ALLOW_FAKE_PAYMENTS
		) {
			return res.status(403).json({
				error: "Paiements fake désactivés en production",
			});
		}

		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { orderId, amount, tipAmount = 0 } = req.body;
			const order = await Order.findById(orderId).select("restaurantId");

			if (!order) {
				return res.status(404).json({ error: "Commande introuvable" });
			}

			if (!hasSameRestaurantAccess(req, order.restaurantId)) {
				return res.status(403).json({ error: "Accès non autorisé" });
			}


			const result = await stripeService.createFakePayment(
				orderId,
				amount,
				tipAmount,
			);

			// Émettre événement WebSocket pour mise à jour commande
			const io = req.app.locals.io;
			if (io && result.order.restaurantId) {
				emitOrderEvent(
					io,
					result.order.restaurantId.toString(),
					"updated",
					result.order.toObject(),
				);

				// 🔔 Émettre notification de paiement complété
				// Récupérer les infos de table pour la notification
				const Table = require("../models/Table");
				const Reservation = require("../models/Reservation");
				const table = await Table.findById(result.order.tableId).select(
					"number",
				);
				const reservation = await Reservation.findById(
					result.order.reservationId,
				).select("guestName");

				emitPaymentCompleted(io, result.order.restaurantId.toString(), {
					tableNumber: table?.number || "?",
					guestName: reservation?.guestName || "Client",
					amount: amount / 100, // Convertir en euros
					orderId: result.order._id,
					tableId: result.order.tableId,
				});
			}

			res.json({
				success: true,
				fake: true,
				payment: result.payment,
				order: result.order,
				message: "✅ Paiement fake créé avec succès",
			});
		} catch (err) {
			console.error("❌ Erreur création paiement fake:", err);
			res.status(500).json({
				error: "Erreur serveur",
				message: err.message,
			});
		}
	},
);

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/webhook/stripe
// Webhook Stripe pour recevoir les événements
// ⚠️ PAS de middleware auth (Stripe envoie les webhooks)
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/webhook/stripe",
	express.raw({ type: "application/json" }), // Important: body brut pour vérification signature
	async (req, res) => {
		const sig = req.headers["stripe-signature"];

		try {
			// Vérifier la signature du webhook
			const event = stripeService.verifyWebhookSignature(req.body, sig);


			// Traiter l'événement
			const result = await stripeService.handleWebhookEvent(event);

			// Si paiement réussi, émettre événement WebSocket
			if (
				event.type === "payment_intent.succeeded" &&
				result.success &&
				result.orderId
			) {
				const order = await Order.findById(result.orderId).populate(
					"restaurantId",
				);

				if (order) {
					const io = req.app.locals.io;
					if (io) {
						emitOrderEvent(
							io,
							order.restaurantId._id.toString(),
							"payment_succeeded",
							order.toObject(),
						);

						// 🔔 Émettre notification de paiement complété
						const Table = require("../models/Table");
						const Reservation = require("../models/Reservation");
						const table = await Table.findById(order.tableId).select("number");
						const reservation = await Reservation.findById(
							order.reservationId,
						).select("guestName");

						emitPaymentCompleted(io, order.restaurantId._id.toString(), {
							tableNumber: table?.number || "?",
							guestName: reservation?.guestName || "Client",
							amount: order.total / 100, // Convertir en euros
							orderId: order._id,
							tableId: order.tableId,
						});

					}
				}
			}

			res.json({ received: true, result });
		} catch (err) {
			console.error("❌ Erreur webhook Stripe:", err);
			res.status(400).send(`Webhook Error: ${err.message}`);
		}
	},
);

module.exports = router;

// ════════════════════════════════════════════════════════════════════════════
// ROUTE: POST /payments/refund
// Rembourse un paiement (partiel ou total)
// Accessible par: restaurant (admin/server) uniquement
// ════════════════════════════════════════════════════════════════════════════

router.post(
	"/refund",
	auth,
	checkRoles(["admin", "server"]),
	[
		body("paymentIntentId").notEmpty().withMessage("paymentIntentId requis"),
		body("amountCents")
			.optional()
			.isInt({ min: 1 })
			.withMessage("amountCents doit être un entier positif en centimes"),
		body("reason")
			.optional()
			.isIn(["duplicate", "fraudulent", "requested_by_customer"])
			.withMessage("reason invalide"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { paymentIntentId, amountCents = null, reason = "requested_by_customer" } = req.body;

		try {
			// Vérifier que le paiement appartient bien à ce restaurant
			const payment = await Payment.findOne({ stripePaymentIntentId: paymentIntentId });
			if (!payment) {
				return res.status(404).json({ error: "Paiement introuvable" });
			}

			if (
				req.user.role !== "admin" &&
				payment.restaurantId.toString() !== req.user.restaurantId?.toString()
			) {
				return res.status(403).json({ error: "Accès refusé — restaurant non correspondant" });
			}

			const result = await stripeService.createRefund({ paymentIntentId, amountCents, reason });

			res.json({
				success: true,
				refundId: result.refund.id,
				amountRefunded: result.refund.amount,
				status: result.payment.status,
			});
		} catch (err) {
			console.error("❌ Erreur remboursement:", err.message);
			res.status(400).json({ error: err.message });
		}
	},
);
