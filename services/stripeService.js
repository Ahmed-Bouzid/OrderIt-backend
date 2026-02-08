const Stripe = require("stripe");
const Payment = require("../models/Payment");
const Order = require("../models/Order");
const logger = require("../utils/secureLogger"); // ✅ Logger sécurisé

/**
 * Service Stripe - Gestion centralisée de tous les paiements Stripe
 *
 * Fonctionnalités:
 * - Création de PaymentIntent
 * - Confirmation de paiement
 * - Gestion des webhooks
 * - Mode test/fake
 */
class StripeService {
	constructor() {
		// Initialiser Stripe avec la clé secrète (mode test par défaut)
		const stripeSecretKey =
			process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;

		if (!stripeSecretKey) {
			console.warn(
				"⚠️ STRIPE_SECRET_KEY non définie - Les paiements ne fonctionneront pas",
			);
			this.stripe = null;
		} else {
			this.stripe = new Stripe(stripeSecretKey, {
				apiVersion: "2023-10-16", // Version stable
			});

			// Détecter si mode test
			this.isTestMode = stripeSecretKey.startsWith("sk_test_");
			console.log(
				`✅ Stripe initialisé en mode ${
					this.isTestMode ? "TEST" : "PRODUCTION"
				}`,
			);
		}

		this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
	}

	/**
	 * Vérifie si Stripe est configuré
	 */
	isConfigured() {
		return this.stripe !== null;
	}

	/**
	 * Crée un PaymentIntent Stripe
	 *
	 * @param {Object} params - Paramètres du paiement
	 * @param {string} params.orderId - ID de la commande MongoDB
	 * @param {number} params.amount - Montant en centimes (ex: 2550 = 25.50€)
	 * @param {string} params.currency - Devise (ex: "eur")
	 * @param {string} params.paymentMode - "client" ou "terminal"
	 * @param {Array<string>} params.paymentMethodTypes - ["card", "apple_pay"]
	 * @param {number} params.tipAmount - Pourboire en centimes (optionnel)
	 * @param {Object} params.metadata - Métadonnées supplémentaires
	 * @returns {Promise<Object>} { paymentIntent, payment (document DB) }
	 */
	async createPaymentIntent({
		orderId,
		amount,
		currency = "eur",
		paymentMode = "client",
		paymentMethodTypes = ["card"],
		tipAmount = 0,
		metadata = {},
	}) {
		if (!this.isConfigured()) {
			throw new Error(
				"Stripe n'est pas configuré - vérifiez STRIPE_SECRET_KEY",
			);
		}

		// 1. Récupérer la commande pour validation
		const order = await Order.findById(orderId)
			.populate("reservationId")
			.populate("restaurantId");

		if (!order) {
			throw new Error(`Commande ${orderId} introuvable`);
		}

		if (order.paid) {
			throw new Error(`Commande ${orderId} déjà payée`);
		}

		// 2. Calculer le montant total (commande + pourboire)
		const totalAmount = amount + tipAmount;

		if (totalAmount < 50) {
			// Minimum Stripe = 0.50€ = 50 centimes
			throw new Error("Le montant minimum est de 0.50€");
		}

		// 3. Créer le PaymentIntent sur Stripe
		const paymentIntent = await this.stripe.paymentIntents.create({
			amount: totalAmount,
			currency: currency.toLowerCase(),
			payment_method_types: paymentMethodTypes,
			metadata: {
				orderId: orderId.toString(),
				restaurantId: order.restaurantId._id.toString(),
				reservationId: order.reservationId?._id.toString() || "",
				paymentMode,
				tipAmount: tipAmount.toString(),
				...metadata,
			},
			description: `Order #${orderId.toString().substring(0, 8)} - ${
				order.restaurantId.name || "Restaurant"
			}`,
			// Capture automatique (pas de pre-auth)
			capture_method: "automatic",
		});

		logger.info("PaymentIntent créé avec succès", {
			paymentIntentId: paymentIntent.id.substring(0, 12) + "...",
			amount: totalAmount / 100 + "€",
			currency: currency,
		});

		// 4. Sauvegarder dans la DB
		const payment = new Payment({
			orderId: order._id,
			restaurantId: order.restaurantId._id,
			reservationId: order.reservationId?._id,
			stripePaymentIntentId: paymentIntent.id,
			clientSecret: paymentIntent.client_secret,
			amount: totalAmount,
			currency,
			status: "pending",
			paymentMethod: paymentMethodTypes.includes("apple_pay")
				? "apple_pay"
				: "card",
			paymentMode,
			tipAmount,
			isTest: this.isTestMode,
			isFake: false,
		});

		await payment.save();

		return {
			paymentIntent,
			payment,
			clientSecret: paymentIntent.client_secret,
		};
	}

	/**
	 * Récupère un PaymentIntent depuis Stripe
	 *
	 * @param {string} paymentIntentId - ID du PaymentIntent
	 * @returns {Promise<Object>} PaymentIntent Stripe
	 */
	async getPaymentIntent(paymentIntentId) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré");
		}

		return await this.stripe.paymentIntents.retrieve(paymentIntentId);
	}

	/**
	 * Confirme un PaymentIntent (si confirmation manuelle requise)
	 *
	 * @param {string} paymentIntentId - ID du PaymentIntent
	 * @param {string} paymentMethodId - ID de la méthode de paiement (optionnel)
	 * @returns {Promise<Object>} PaymentIntent confirmé
	 */
	async confirmPaymentIntent(paymentIntentId, paymentMethodId = null) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré");
		}

		const params = {};
		if (paymentMethodId) {
			params.payment_method = paymentMethodId;
		}

		return await this.stripe.paymentIntents.confirm(paymentIntentId, params);
	}

	/**
	 * Annule un PaymentIntent
	 *
	 * @param {string} paymentIntentId - ID du PaymentIntent
	 * @returns {Promise<Object>} PaymentIntent annulé
	 */
	async cancelPaymentIntent(paymentIntentId) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré");
		}

		const paymentIntent =
			await this.stripe.paymentIntents.cancel(paymentIntentId);

		// Mettre à jour la DB
		const payment = await Payment.findByPaymentIntentId(paymentIntentId);
		if (payment) {
			payment.status = "canceled";
			await payment.save();
		}

		return paymentIntent;
	}

	/**
	 * Confirme un PaymentIntent avec la carte test Stripe 4242 4242 4242 4242
	 * 🧪 MODE TEST UNIQUEMENT
	 *
	 * @param {string} paymentIntentId - ID du PaymentIntent
	 * @returns {Promise<Object>} PaymentIntent confirmé
	 */
	async confirmWithTestCard(paymentIntentId) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré");
		}

		if (!this.isTestMode) {
			throw new Error("Cette méthode est disponible uniquement en mode TEST");
		}

		logger.debug("Mode test: Confirmation avec token Visa test");

		// ✅ Utiliser le token de test prédéfini par Stripe (carte Visa 4242)
		// Plus sécurisé que d'envoyer les détails bruts de la carte
		const testPaymentMethodId = "pm_card_visa";

		console.log(`✅ Utilisation PaymentMethod test: ${testPaymentMethodId}`);

		// Confirmer le PaymentIntent avec le token de test Stripe
		const confirmedPaymentIntent = await this.stripe.paymentIntents.confirm(
			paymentIntentId,
			{
				payment_method: testPaymentMethodId,
			},
		);

		// Mettre à jour la DB
		const payment = await Payment.findByPaymentIntentId(paymentIntentId);
		if (payment) {
			payment.status = confirmedPaymentIntent.status;
			payment.paymentMethod = "card";
			await payment.save();

			// Si succès, marquer la commande comme payée
			if (confirmedPaymentIntent.status === "succeeded") {
				const order = await Order.findById(payment.orderId);
				if (order && !order.paid) {
					order.paid = true;
					order.paidAt = new Date();
					order.paymentMethod = "card";
					order.paidAmount = payment.amount / 100; // Convertir centimes en euros
					order.paymentStatus = "paid";
					await order.save();
					logger.info("Commande marquée comme payée");

					// ⭐ Mettre à jour aussi la réservation
					if (order.reservationId) {
						const Reservation = require("../models/Reservation");
						const reservation = await Reservation.findById(order.reservationId);
						if (reservation) {
							reservation.paidAmount =
								(reservation.paidAmount || 0) + payment.amount / 100;
							await reservation.save();
							console.log(
								`✅ Réservation ${reservation._id} mise à jour - paidAmount: ${reservation.paidAmount}€`,
							);
						}
					}
				}
			}
		}

		return confirmedPaymentIntent;
	}

	/**
	 * Gère un événement webhook Stripe
	 *
	 * @param {Object} event - Événement Stripe
	 * @returns {Promise<Object>} Résultat du traitement
	 */
	async handleWebhookEvent(event) {
		console.log(`📡 Webhook Stripe reçu: ${event.type} - ${event.id}`);

		switch (event.type) {
			case "payment_intent.succeeded":
				return await this.handlePaymentSucceeded(event.data.object);

			case "payment_intent.payment_failed":
				return await this.handlePaymentFailed(event.data.object);

			case "payment_intent.canceled":
				return await this.handlePaymentCanceled(event.data.object);

			case "payment_intent.requires_action":
				return await this.handlePaymentRequiresAction(event.data.object);

			default:
				console.log(`ℹ️ Événement non géré: ${event.type}`);
				return { received: true, handled: false };
		}
	}

	/**
	 * Gère un paiement réussi
	 *
	 * @param {Object} paymentIntent - PaymentIntent Stripe
	 * @returns {Promise<Object>} Résultat
	 */
	async handlePaymentSucceeded(paymentIntent) {
		console.log(`✅ Paiement réussi: ${paymentIntent.id}`);

		// 1. Récupérer le paiement dans la DB
		const payment = await Payment.findByPaymentIntentId(paymentIntent.id);

		if (!payment) {
			console.error(`❌ Payment introuvable pour PI: ${paymentIntent.id}`);
			return { error: "Payment not found in database" };
		}

		// 2. Extraire les infos de la carte (si disponible)
		let cardDetails = null;
		if (paymentIntent.charges?.data?.length > 0) {
			const charge = paymentIntent.charges.data[0];
			const paymentMethod = charge.payment_method_details;

			if (paymentMethod?.card) {
				cardDetails = {
					brand: paymentMethod.card.brand,
					last4: paymentMethod.card.last4,
					expMonth: paymentMethod.card.exp_month,
					expYear: paymentMethod.card.exp_year,
				};
			}
		}

		// 3. Mettre à jour le paiement
		await payment.markAsSucceeded(cardDetails);
		await payment.addStripeEvent(paymentIntent.id, "payment_intent.succeeded");

		// 4. Mettre à jour la commande
		const order = await Order.findById(payment.orderId);
		if (order) {
			order.paid = true;
			order.paymentStatus = "paid";
			order.paidAmount = payment.amount / 100; // Convertir en euros
			order.tip = payment.tipAmount / 100;
			order.paidAt = new Date();

			// Changer le statut si encore pending
			if (order.orderStatus === "pending") {
				order.orderStatus = "confirmed";
			}

			await order.save();

			console.log(`✅ Commande ${order._id} marquée comme payée`);

			// 5. Émettre un événement WebSocket (si disponible)
			// Note: req.app.locals.io n'est pas disponible ici, gérer dans le contrôleur
		} else {
			console.error(`❌ Commande ${payment.orderId} introuvable`);
		}

		return {
			success: true,
			paymentId: payment._id,
			orderId: payment.orderId,
		};
	}

	/**
	 * Gère un paiement échoué
	 *
	 * @param {Object} paymentIntent - PaymentIntent Stripe
	 * @returns {Promise<Object>} Résultat
	 */
	async handlePaymentFailed(paymentIntent) {
		console.log(`❌ Paiement échoué: ${paymentIntent.id}`);

		const payment = await Payment.findByPaymentIntentId(paymentIntent.id);

		if (!payment) {
			console.error(`❌ Payment introuvable pour PI: ${paymentIntent.id}`);
			return { error: "Payment not found in database" };
		}

		const errorMessage =
			paymentIntent.last_payment_error?.message || "Payment failed";
		const errorCode = paymentIntent.last_payment_error?.code || "unknown";

		await payment.markAsFailed(errorMessage, errorCode);
		await payment.addStripeEvent(
			paymentIntent.id,
			"payment_intent.payment_failed",
		);

		return {
			success: false,
			paymentId: payment._id,
			error: errorMessage,
		};
	}

	/**
	 * Gère un paiement annulé
	 *
	 * @param {Object} paymentIntent - PaymentIntent Stripe
	 * @returns {Promise<Object>} Résultat
	 */
	async handlePaymentCanceled(paymentIntent) {
		console.log(`🚫 Paiement annulé: ${paymentIntent.id}`);

		const payment = await Payment.findByPaymentIntentId(paymentIntent.id);

		if (!payment) {
			return { error: "Payment not found in database" };
		}

		payment.status = "canceled";
		await payment.addStripeEvent(paymentIntent.id, "payment_intent.canceled");
		await payment.save();

		return {
			success: true,
			paymentId: payment._id,
			status: "canceled",
		};
	}

	/**
	 * Gère un paiement nécessitant une action (3DS)
	 *
	 * @param {Object} paymentIntent - PaymentIntent Stripe
	 * @returns {Promise<Object>} Résultat
	 */
	async handlePaymentRequiresAction(paymentIntent) {
		console.log(`⚠️ Paiement nécessite action (3DS): ${paymentIntent.id}`);

		const payment = await Payment.findByPaymentIntentId(paymentIntent.id);

		if (!payment) {
			return { error: "Payment not found in database" };
		}

		payment.status = "requires_action";
		await payment.addStripeEvent(
			paymentIntent.id,
			"payment_intent.requires_action",
		);
		await payment.save();

		return {
			success: true,
			paymentId: payment._id,
			status: "requires_action",
		};
	}

	/**
	 * Vérifie la signature d'un webhook Stripe
	 *
	 * @param {string} payload - Corps brut de la requête
	 * @param {string} signature - En-tête stripe-signature
	 * @returns {Object} Événement vérifié
	 */
	verifyWebhookSignature(payload, signature) {
		// ✅ SÉCURITÉ: Webhook secret OBLIGATOIRE en production
		if (!this.webhookSecret) {
			const error =
				"🚨 STRIPE_WEBHOOK_SECRET manquant - Webhooks REFUSÉS pour sécurité !";
			console.error(error);
			throw new Error("Webhook secret requis");
		}

		// ✅ SÉCURITÉ: Signature obligatoire
		if (!signature) {
			console.error("🚨 Webhook sans signature rejeté");
			throw new Error("Signature webhook manquante");
		}

		try {
			// ✅ Vérification cryptographique de la signature
			const event = this.stripe.webhooks.constructEvent(
				payload,
				signature,
				this.webhookSecret,
			);

			console.log(`✅ Webhook vérifié: ${event.type} - ${event.id}`);
			return event;
		} catch (err) {
			logger.error("Erreur vérification webhook", { error: err.message });
			throw new Error("Webhook signature verification failed");
		}
	}

	/**
	 * Crée un paiement FAKE (dev only)
	 * Simule un paiement réussi sans passer par Stripe
	 *
	 * @param {string} orderId - ID de la commande
	 * @param {number} amount - Montant en centimes
	 * @param {number} tipAmount - Pourboire (optionnel)
	 * @returns {Promise<Object>} Paiement fake créé
	 */
	async createFakePayment(orderId, amount, tipAmount = 0) {
		console.log(`🎭 Création paiement FAKE pour commande ${orderId}`);

		// 1. Récupérer la commande
		const order = await Order.findById(orderId)
			.populate("reservationId")
			.populate("restaurantId");

		if (!order) {
			throw new Error(`Commande ${orderId} introuvable`);
		}

		if (order.paid) {
			throw new Error(`Commande ${orderId} déjà payée`);
		}

		// 2. Créer un Payment fake
		const fakePaymentIntentId = `pi_fake_${Date.now()}_${Math.random()
			.toString(36)
			.substring(7)}`;

		const payment = new Payment({
			orderId: order._id,
			restaurantId: order.restaurantId._id,
			reservationId: order.reservationId?._id,
			stripePaymentIntentId: fakePaymentIntentId,
			amount: amount + tipAmount,
			currency: "eur",
			status: "succeeded",
			paymentMethod: "fake",
			paymentMode: "client",
			tipAmount,
			isTest: true,
			isFake: true,
			confirmedAt: new Date(),
			cardDetails: {
				brand: "visa",
				last4: "4242",
				expMonth: 12,
				expYear: 2030,
			},
		});

		await payment.save();

		// 3. Mettre à jour la commande
		order.paid = true;
		order.paymentStatus = "paid";
		order.paidAmount = (amount + tipAmount) / 100;
		order.tip = tipAmount / 100;
		order.paidAt = new Date();

		if (order.orderStatus === "pending") {
			order.orderStatus = "confirmed";
		}

		await order.save();

		logger.info("Paiement fake créé avec succès");

		return {
			success: true,
			payment,
			order,
			fake: true,
		};
	}
}

// Singleton
module.exports = new StripeService();
