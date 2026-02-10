const express = require("express");
const router = express.Router();
const ClientFeedback = require("../../models/ClientFeedback");
const { body, validationResult } = require("express-validator");
const logger = require("../../utils/secureLogger"); // ✅ Logger sécurisé

/**
 * 🌟 Routes pour la collecte d'avis clients
 *
 * Fonctionnalités :
 * - POST /submit : Enregistrer un feedback client
 * - GET /stats/:restaurantId : Statistiques d'un restaurant
 * - GET /improvement/:restaurantId : Feedbacks d'amélioration
 */

// ⭐ Validation des données de feedback
const validateClientFeedback = [
	body("restaurantId")
		.notEmpty()
		.withMessage("ID restaurant requis")
		.isMongoId()
		.withMessage("ID restaurant invalide"),
	body("serviceRating")
		.isBoolean()
		.withMessage("Note service doit être true/false"),
	body("foodQuality")
		.isBoolean()
		.withMessage("Note qualité plats doit être true/false"),
	body("venueExperience")
		.isBoolean()
		.withMessage("Note lieu doit être true/false"),
	body("comment")
		.optional()
		.isString()
		.isLength({ max: 2000 })
		.withMessage("Commentaire trop long (max 2000 caractères)")
		.trim(),
	body("clientName")
		.optional()
		.isString()
		.isLength({ max: 100 })
		.withMessage("Nom client trop long")
		.trim(),
];

/**
 * 📝 POST /client-feedback/submit
 * Enregistre un feedback client (uniquement pour clients non 100% satisfaits)
 */
router.post("/submit", validateClientFeedback, async (req, res) => {
	logger.debug("Réception feedback client");

	try {
		// Vérifier les erreurs de validation
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			console.log("❌ [CLIENT-FEEDBACK] Erreurs de validation détaillées:");
			errors.array().forEach((error, index) => {
				console.log(`  ${index + 1}. Champ '${error.param}': ${error.msg} (valeur: "${error.value}")`);
			});
			console.log("❌ [CLIENT-FEEDBACK] Corps de la requête complet:", req.body);
			
			logger.warn("Erreurs validation feedback", {
				errorsCount: errors.array().length,
				details: errors.array()
			});
			return res.status(400).json({
				success: false,
				message: "Données invalides",
				errors: errors.array(),
			});
		}
		
		console.log("✅ [CLIENT-FEEDBACK] Validation réussie, données reçues:", req.body);

		const {
			restaurantId,
			tableId,
			reservationId,
			clientId,
			clientName,
			serviceRating,
			foodQuality,
			venueExperience,
			comment = "",
			redirectedToGoogle = false,
		} = req.body;

		// 🚨 RÈGLE IMPORTANTE : On ne stocke que les feedbacks non 100% positifs
		// Les clients 100% satisfaits sont dirigés vers Google sans stockage
		const allPositive =
			serviceRating === true &&
			foodQuality === true &&
			venueExperience === true;

		if (allPositive && !comment.trim()) {
			// Client très satisfait sans commentaire → pas de stockage, juste log
			console.log(
				"✅ [CLIENT-FEEDBACK] Client très satisfait sans commentaire - pas de stockage",
			);
			return res.status(200).json({
				success: true,
				message: "Merci pour votre retour positif !",
				action: "redirect_to_google",
				shouldStore: false,
			});
		}

		// Créer l'enregistrement feedback
		const clientFeedback = new ClientFeedback({
			restaurantId,
			tableId: tableId || null,
			reservationId: reservationId || null,
			clientId: clientId || null,
			clientName: clientName || null,
			serviceRating,
			foodQuality,
			venueExperience,
			comment: comment.trim(),
			redirectedToGoogle,
			ipAddress: req.ip || req.connection.remoteAddress,
			userAgent: req.get("User-Agent"),
		});

		// Le middleware pre("save") calculera automatiquement :
		// - overallSatisfied
		// - feedbackType

		await clientFeedback.save();

		console.log(
			`✅ [CLIENT-FEEDBACK] Feedback enregistré - Type: ${clientFeedback.feedbackType}, ID: ${clientFeedback._id}`,
		);

		// ⭐ Émettre événement WebSocket pour notifier le frontend
		const io = req.app.locals.io;
		if (io && clientFeedback.restaurantId) {
			const { emitNotification } = require("../../utils/socketEmitter");
			emitNotification(
				io,
				clientFeedback.restaurantId.toString(),
				"Nouveau Feedback",
				`Avis ${clientFeedback.feedbackType} reçu : ${clientFeedback.comment || "Sans commentaire"}`,
				clientFeedback.feedbackType === "mixed" ? "warning" : "info",
				{
					feedbackId: clientFeedback._id,
					feedbackType: clientFeedback.feedbackType,
					tableId: clientFeedback.tableId,
					clientName: clientFeedback.clientName || "Client",
				},
			);
			console.log(
				`📡 WebSocket: Feedback ${clientFeedback._id} émis vers restaurant ${clientFeedback.restaurantId}`,
			);
		}

		// Message de réponse selon le type
		let responseMessage = "Merci pour votre retour !";
		let action = "redirect_to_google";

		if (clientFeedback.feedbackType === "positive") {
			responseMessage =
				"Merci pour votre retour positif ! Votre commentaire peut être utilisé pour votre avis Google.";
			action = "redirect_to_google_with_comment";
		} else if (clientFeedback.feedbackType === "mixed") {
			responseMessage =
				"Merci pour votre retour ! Vos suggestions nous aideront à nous améliorer.";
			action = "redirect_to_google";
		}

		res.status(201).json({
			success: true,
			message: responseMessage,
			action,
			feedbackId: clientFeedback._id,
			feedbackType: clientFeedback.feedbackType,
			shouldStore: true,
		});
	} catch (error) {
		logger.error("Erreur enregistrement feedback", { error: error.message });

		// Même en cas d'erreur, on laisse l'utilisateur accéder à Google
		res.status(500).json({
			success: false,
			message:
				"Erreur technique, mais vous pouvez toujours laisser un avis sur Google",
			action: "redirect_to_google",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: "Erreur interne",
		});
	}
});

/**
 * 📊 GET /client-feedback/stats/:restaurantId
 * Statistiques des feedbacks pour un restaurant (30 derniers jours par défaut)
 */
router.get("/stats/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { days = 30 } = req.query;

		console.log(
			`📊 [CLIENT-FEEDBACK] Demande stats restaurant ${restaurantId} (${days} jours)`,
		);

		if (!restaurantId || !restaurantId.match(/^[0-9a-fA-F]{24}$/)) {
			return res.status(400).json({
				success: false,
				message: "ID restaurant invalide",
			});
		}

		const stats = await ClientFeedback.getRestaurantStats(
			restaurantId,
			parseInt(days),
		);

		console.log(`✅ [CLIENT-FEEDBACK] Stats calculées:`, stats);

		res.json({
			success: true,
			data: stats,
		});
	} catch (error) {
		logger.error("Erreur statistiques feedback", { error: error.message });
		res.status(500).json({
			success: false,
			message: "Erreur lors du calcul des statistiques",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: "Erreur interne",
		});
	}
});

/**
 * 💡 GET /client-feedback/improvement/:restaurantId
 * Récupère les feedbacks négatifs/mixtes pour amélioration
 */
router.get("/improvement/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { limit = 50 } = req.query;

		console.log(
			`💡 [CLIENT-FEEDBACK] Demande feedbacks amélioration restaurant ${restaurantId}`,
		);

		if (!restaurantId || !restaurantId.match(/^[0-9a-fA-F]{24}$/)) {
			return res.status(400).json({
				success: false,
				message: "ID restaurant invalide",
			});
		}

		const feedbacks = await ClientFeedback.getImprovementFeedback(
			restaurantId,
			parseInt(limit),
		);

		console.log(`✅ [CLIENT-FEEDBACK] ${feedbacks.length} feedbacks récupérés`);

		res.json({
			success: true,
			data: feedbacks,
			count: feedbacks.length,
		});
	} catch (error) {
		logger.error("Erreur récupération feedbacks", { error: error.message });
		res.status(500).json({
			success: false,
			message: "Erreur lors de la récupération des feedbacks",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: "Erreur interne",
		});
	}
});

/**
 * 🔍 GET /client-feedback/test
 * Route de test pour vérifier que le module fonctionne
 */
router.get("/test", (req, res) => {
	res.json({
		success: true,
		message: "Module Client Feedback opérationnel ! 🌟",
		timestamp: new Date(),
		routes: {
			submit: "POST /client-feedback/submit",
			stats: "GET /client-feedback/stats/:restaurantId",
			improvement: "GET /client-feedback/improvement/:restaurantId",
		},
	});
});

module.exports = router;
