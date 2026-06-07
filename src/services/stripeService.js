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

		// 2.b Réutiliser un intent ouvert existant pour éviter les doublons
		const existingOpenPayment = await Payment.findOne({
			orderId: order._id,
			amount: totalAmount,
			status: { $in: ["pending", "processing", "requires_action"] },
			isFake: { $ne: true },
		})
			.sort({ createdAt: -1 })
			.maxTimeMS(10000);

		if (existingOpenPayment?.stripePaymentIntentId) {
			try {
				const existingIntent = await this.stripe.paymentIntents.retrieve(
					existingOpenPayment.stripePaymentIntentId,
				);

				if (!["canceled", "succeeded"].includes(existingIntent.status)) {
					logger.info("Réutilisation PaymentIntent existant", {
						orderId: order._id.toString(),
						paymentId: existingOpenPayment._id.toString(),
						paymentIntentId:
							existingIntent.id.substring(0, 12) + "...",
						status: existingIntent.status,
					});

					return {
						paymentIntent: existingIntent,
						payment: existingOpenPayment,
						clientSecret:
							existingOpenPayment.clientSecret || existingIntent.client_secret,
					};
				}
			} catch (reuseErr) {
				logger.warn("Impossible de réutiliser le PaymentIntent existant", {
					orderId: order._id.toString(),
					paymentId: existingOpenPayment._id.toString(),
					error: reuseErr.message,
				});
			}
		}

		// ─── Stripe Connect : commission SunnyGo ───────────────────────────
		// Si le restaurant a un compte Connect onboardé, l'argent va directement
		// sur son compte. SunnyGo prélève une commission via application_fee_amount.
		//   - "pay_per_use"  → 100 centimes (1€) par paiement
		//   - "annual"       → 0 centimes (engagement annuel déjà facturé)
		const restaurant = order.restaurantId;
		const hasConnect = !!(restaurant?.stripeOnboarded && restaurant?.stripeAccountId);
		const commissionPlan = restaurant?.stripeCommissionPlan || "pay_per_use";
		const platformFee = hasConnect
			? commissionPlan === "annual" ? 0 : 100 // 1€ en centimes
			: 0;

		// 3. Créer le PaymentIntent sur Stripe
		const paymentIntentParams = {
			amount: totalAmount,
			currency: currency.toLowerCase(),
			payment_method_types: paymentMethodTypes,
			metadata: {
				orderId: orderId.toString(),
				restaurantId: restaurant._id.toString(),
				reservationId: order.reservationId?._id.toString() || "",
				paymentMode,
				tipAmount: tipAmount.toString(),
				commissionPlan,
				...metadata,
			},
			description: `Order #${orderId.toString().substring(0, 8)} - ${
				restaurant.name || "Restaurant"
			}`,
			// Capture automatique (pas de pre-auth)
			capture_method: "automatic",
		};

		// Ajouter les params Connect seulement si le restaurant est onboardé
		if (hasConnect) {
			paymentIntentParams.application_fee_amount = platformFee;
			paymentIntentParams.transfer_data = {
				destination: restaurant.stripeAccountId,
			};
		}

		const retryWindow = Math.floor(Date.now() / (2 * 60 * 1000)); // fenêtre 2 minutes
		const idempotencyKey = `order_${order._id.toString()}_${totalAmount}_${paymentMode}_${retryWindow}`;
		const paymentIntent = await this.stripe.paymentIntents.create(
			paymentIntentParams,
			{ idempotencyKey },
		);

		logger.info("PaymentIntent créé avec succès", {
			paymentIntentId: paymentIntent.id.substring(0, 12) + "...",
			amount: totalAmount / 100 + "€",
			currency: currency,
			idempotencyKey,
			connectAccount: hasConnect ? restaurant.stripeAccountId?.substring(0, 12) + "..." : "direct",
			platformFee: platformFee / 100 + "€",
		});

		// 4. Sauvegarder dans la DB
		const payment = new Payment({
			orderId: order._id,
			restaurantId: restaurant._id,
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
			platformFee,
			stripeConnectAccountId: hasConnect ? restaurant.stripeAccountId : null,
			commissionPlan: hasConnect ? commissionPlan : "none",
		});

		try {
			await payment.save();
		} catch (saveErr) {
			// E11000 : doublon sur stripePaymentIntentId (double-tap simultané)
			// Stripe retourne le même intent (idempotent) — on renvoie le Payment existant
			if (saveErr.code === 11000 && saveErr.keyPattern?.stripePaymentIntentId) {
				const existing = await Payment.findOne({ stripePaymentIntentId: paymentIntent.id }).lean();
				if (existing) {
					return { paymentIntent, payment: existing, clientSecret: paymentIntent.client_secret };
				}
			}
			throw saveErr;
		}

		return {
			paymentIntent,
			payment,
			clientSecret: paymentIntent.client_secret,
		};
	}

	/**
	 * Crée un PaymentIntent AGRÉGÉ (1 transaction Stripe pour N commandes).
	 * Au webhook succeeded, on cascade le paid sur toutes les commandes via
	 * Payment.relatedOrders[] (incluant la commande principale en index 0).
	 */
	async createAggregatedPaymentIntent({
		orderSlices,
		currency = "eur",
		paymentMode = "client",
		paymentMethodTypes = ["card"],
		tipAmount = 0,
		metadata = {},
	}) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré");
		}
		if (!Array.isArray(orderSlices) || orderSlices.length < 2) {
			throw new Error("createAggregatedPaymentIntent: 2+ commandes requises");
		}

		const orders = await Promise.all(
			orderSlices.map((s) =>
				Order.findById(s.orderId)
					.populate("reservationId")
					.populate("restaurantId"),
			),
		);
		for (let i = 0; i < orders.length; i++) {
			if (!orders[i]) {
				throw new Error(`Commande ${orderSlices[i].orderId} introuvable`);
			}
			if (orders[i].paid) {
				throw new Error(`Commande ${orders[i]._id} déjà payée`);
			}
		}
		const restaurantId = orders[0].restaurantId._id.toString();
		const reservationId = orders[0].reservationId?._id?.toString() || "";
		for (const o of orders) {
			if (o.restaurantId._id.toString() !== restaurantId) {
				throw new Error(
					"Toutes les commandes doivent appartenir au même restaurant",
				);
			}
			const rid = o.reservationId?._id?.toString() || "";
			if (rid !== reservationId) {
				throw new Error(
					"Toutes les commandes doivent appartenir à la même réservation",
				);
			}
		}

		const restaurant = orders[0].restaurantId;
		const totalAmount =
			orderSlices.reduce((s, x) => s + (x.amount || 0), 0) + tipAmount;

		if (totalAmount < 50) {
			throw new Error("Le montant minimum est de 0.50€");
		}

		const hasConnect = !!(
			restaurant?.stripeOnboarded && restaurant?.stripeAccountId
		);
		const commissionPlan = restaurant?.stripeCommissionPlan || "pay_per_use";
		const platformFee = hasConnect
			? commissionPlan === "annual"
				? 0
				: 100
			: 0;

		const orderIdsCsv = orderSlices.map((s) => s.orderId.toString()).join(",");
		const amountsCsv = orderSlices.map((s) => s.amount.toString()).join(",");

		const paymentIntentParams = {
			amount: totalAmount,
			currency: currency.toLowerCase(),
			payment_method_types: paymentMethodTypes,
			metadata: {
				aggregated: "true",
				orderIds: orderIdsCsv,
				amounts: amountsCsv,
				restaurantId,
				reservationId,
				paymentMode,
				tipAmount: tipAmount.toString(),
				commissionPlan,
				...metadata,
			},
			description: `${orders.length} commandes – ${restaurant.name || "Restaurant"}`,
			capture_method: "automatic",
		};

		if (hasConnect) {
			paymentIntentParams.application_fee_amount = platformFee;
			paymentIntentParams.transfer_data = {
				destination: restaurant.stripeAccountId,
			};
		}

		const retryWindow = Math.floor(Date.now() / (2 * 60 * 1000));
		const idempotencyKey = `aggr_${orderIdsCsv}_${totalAmount}_${paymentMode}_${retryWindow}`;
		const paymentIntent = await this.stripe.paymentIntents.create(
			paymentIntentParams,
			{ idempotencyKey },
		);

		logger.info("PaymentIntent agrégé créé", {
			paymentIntentId: paymentIntent.id.substring(0, 12) + "...",
			ordersCount: orders.length,
			totalAmount: totalAmount / 100 + "€",
		});

		const [primarySlice, ...otherSlices] = orderSlices;
		const payment = new Payment({
			orderId: primarySlice.orderId,
			restaurantId: restaurant._id,
			reservationId: orders[0].reservationId?._id,
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
			platformFee,
			stripeConnectAccountId: hasConnect ? restaurant.stripeAccountId : null,
			commissionPlan: hasConnect ? commissionPlan : "none",
			relatedOrders: [
				{ orderId: primarySlice.orderId, amount: primarySlice.amount },
				...otherSlices.map((s) => ({ orderId: s.orderId, amount: s.amount })),
			],
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

		console.log("[💳 PAYMENT SUCCESS] Traitement PaymentIntent:", {
			paymentIntentId: paymentIntent.id,
			amount: paymentIntent.amount,
			status: paymentIntent.status,
		});

		// 1. Récupérer le paiement dans la DB
		const payment = await Payment.findByPaymentIntentId(paymentIntent.id);

		if (!payment) {
			console.error(`❌ [CRITICAL] Payment introuvable pour PI: ${paymentIntent.id}. Payment record n'a pas été créé lors du createPaymentIntent!`);
			return { success: false, error: "Payment not found in database" };
		}

		console.log("[💳 PAYMENT FOUND] Payment document trouvé dans DB:", {
			paymentId: payment._id,
			orderId: payment.orderId,
			status: payment.status,
		});

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

		// 4. Mettre à jour la/les commande(s)
		// 🆕 Cas AGRÉGÉ : Payment.relatedOrders[] liste toutes les commandes
		// concernées (incluant la commande principale en index 0). On marque
		// chacune comme payée avec son slice de montant.
		const isAggregated =
			Array.isArray(payment.relatedOrders) &&
			payment.relatedOrders.length > 0;

		if (isAggregated) {
			console.log(
				`[💳 AGGREGATED] Cascade paid sur ${payment.relatedOrders.length} commandes`,
			);
			for (const slice of payment.relatedOrders) {
				const o = await Order.findById(slice.orderId);
				if (!o) {
					console.error(`❌ Commande ${slice.orderId} introuvable (agrégé)`);
					continue;
				}
				if (o.paid) continue;
				o.paid = true;
				o.paymentStatus = "paid";
				o.paidAmount = (slice.amount || 0) / 100;
				o.paidAt = new Date();
				if (o.orderStatus === "pending") {
					o.orderStatus = "confirmed";
				}
				await o.save();
			}
		} else {
			const order = await Order.findById(payment.orderId);
			if (order) {
				order.paid = true;
				order.paymentStatus = "paid";
				order.paidAmount = payment.amount / 100;
				order.tip = payment.tipAmount / 100;
				order.paidAt = new Date();
				if (order.orderStatus === "pending") {
					order.orderStatus = "confirmed";
				}
				await order.save();
			} else {
				console.error(`❌ Commande ${payment.orderId} introuvable`);
			}
		}

		console.log("[✅ PAYMENT SUCCESS] Paiement finalisé avec succès!", {
			paymentId: payment._id,
			orderId: payment.orderId,
			amount: payment.amount,
			status: payment.status,
		});

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

	/**
	 * Rembourse un paiement (partiel ou total) via Stripe.
	 * Met à jour le document Payment + Order en DB de façon atomique.
	 *
	 * @param {string} paymentIntentId - ID du PaymentIntent à rembourser
	 * @param {number|null} amountCents - Montant en centimes. null = remboursement total
	 * @param {string} reason - "duplicate" | "fraudulent" | "requested_by_customer"
	 * @returns {Promise<Object>} { refund, payment, order }
	 */
	async createRefund({ paymentIntentId, amountCents = null, reason = "requested_by_customer" }) {
		if (!this.isConfigured()) {
			throw new Error("Stripe n'est pas configuré - vérifiez STRIPE_SECRET_KEY");
		}

		// 1. Vérifier le paiement en DB
		const payment = await Payment.findOne({ stripePaymentIntentId: paymentIntentId });
		if (!payment) {
			throw new Error(`Paiement ${paymentIntentId} introuvable en DB`);
		}
		if (payment.status === "refunded") {
			throw new Error("Ce paiement a déjà été remboursé en totalité");
		}
		if (payment.status !== "succeeded") {
			throw new Error(`Impossible de rembourser un paiement en statut "${payment.status}"`);
		}

		const maxRefundable = payment.amount - (payment.refundAmount || 0);
		if (amountCents && amountCents > maxRefundable) {
			throw new Error(
				`Montant demandé ${amountCents}¢ dépasse le remboursable ${maxRefundable}¢`
			);
		}

		// 2. Créer le remboursement sur Stripe
		const refundParams = {
			payment_intent: paymentIntentId,
			reason,
		};
		if (amountCents) {
			refundParams.amount = amountCents;
		}

		const refund = await this.stripe.refunds.create(refundParams);

		logger.info("Remboursement Stripe créé", {
			refundId: refund.id,
			amount: (amountCents || payment.amount) / 100 + "€",
			reason,
		});

		// 3. Mettre à jour le document Payment en DB
		const refundedTotal = (payment.refundAmount || 0) + refund.amount;
		const isFullRefund = refundedTotal >= payment.amount;

		payment.refundAmount = refundedTotal;
		payment.status = isFullRefund ? "refunded" : "partially_refunded";
		payment.refundedAt = new Date();
		await payment.save();

		// 4. Mettre à jour la commande si remboursement total
		const order = await Order.findById(payment.orderId);
		if (order && isFullRefund) {
			order.paymentStatus = "refunded";
			order.paid = false;
			await order.save();
		}

		return { refund, payment, order };
	}
}

// Singleton
module.exports = new StripeService();
