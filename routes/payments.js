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
					userId: req.user.userId,
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
	[body("paymentIntentId").notEmpty().withMessage("paymentIntentId requis")],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { paymentIntentId } = req.body;


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
			"status stripePaymentIntentId amount currency createdAt updatedAt",
		);

		if (!payment) {
			return res.status(404).json({ error: "Paiement introuvable" });
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
		if (
			req.user.role !== "admin" &&
			order.restaurantId.toString() !== req.user.restaurantId?.toString() &&
			order.clientId !== req.user.userId
		) {
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
