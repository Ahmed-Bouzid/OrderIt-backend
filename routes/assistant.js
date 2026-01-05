/**
 * assistant.js - Routes pour l'assistant intelligent de réservations
 */

const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const { checkAvailability } = require("../services/availabilityService"); // Ancien (places globales)
const {
	checkTableAvailability,
} = require("../services/tableAvailabilityService"); // Nouveau (table par table)
const Restaurant = require("../models/Restaurant");

/**
 * POST /assistant/check-availability
 * Vérifie la disponibilité d'un créneau et propose des alternatives
 */
router.post(
	"/check-availability",
	auth,
	checkRoles(["admin", "server"]),
	[
		body("restaurantId")
			.notEmpty()
			.withMessage("Restaurant ID requis")
			.isMongoId()
			.withMessage("Restaurant ID invalide"),
		body("date")
			.notEmpty()
			.withMessage("Date requise")
			.isISO8601()
			.withMessage("Format de date invalide (YYYY-MM-DD attendu)"),
		body("time")
			.notEmpty()
			.withMessage("Heure requise")
			.matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
			.withMessage("Format d'heure invalide (HH:MM attendu)"),
		body("people")
			.notEmpty()
			.withMessage("Nombre de personnes requis")
			.isInt({ min: 1, max: 50 })
			.withMessage("Le nombre de personnes doit être entre 1 et 50"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({
				errors: errors.array().map((err) => ({
					field: err.param,
					message: err.msg,
				})),
			});
		}

		try {
			const { restaurantId, date, time, people } = req.body;

			console.log(
				"🔍 [ASSISTANT] Vérification disponibilité (table par table):",
				{
					restaurantId,
					date,
					time,
					people,
				}
			);

			// Utiliser le nouveau service basé sur les tables
			const result = await checkTableAvailability({
				restaurantId,
				date,
				time,
				people: parseInt(people),
			});

			console.log("✅ [ASSISTANT] Résultat:", result.status, result.reason);

			res.json(result);
		} catch (error) {
			console.error("❌ Erreur assistant/check-availability:", error);
			res.status(500).json({
				message: "Erreur lors de la vérification de disponibilité",
				error: error.message,
			});
		}
	}
);

/**
 * GET /assistant/settings/:restaurantId
 * Récupère les paramètres de l'assistant (turnover, etc.)
 */
router.get(
	"/settings/:restaurantId",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;

			const restaurant = await Restaurant.findById(restaurantId).select(
				"turnoverTime"
			);

			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}

			res.json({
				turnoverTime: restaurant.turnoverTime || 120,
			});
		} catch (error) {
			console.error("❌ Erreur assistant/settings:", error);
			res.status(500).json({
				message: "Erreur lors de la récupération des paramètres",
			});
		}
	}
);

/**
 * PUT /assistant/settings/:restaurantId
 * Met à jour les paramètres de l'assistant
 */
router.put(
	"/settings/:restaurantId",
	auth,
	checkRoles(["admin"]),
	[
		body("turnoverTime")
			.optional()
			.isInt({ min: 30, max: 300 })
			.withMessage("Le turnover doit être entre 30 et 300 minutes"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({
				errors: errors.array().map((err) => ({
					field: err.param,
					message: err.msg,
				})),
			});
		}

		try {
			const { restaurantId } = req.params;
			const { turnoverTime } = req.body;

			const restaurant = await Restaurant.findByIdAndUpdate(
				restaurantId,
				{ turnoverTime },
				{ new: true }
			).select("turnoverTime");

			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}

			console.log(
				`✅ Assistant - Turnover mis à jour: ${turnoverTime} min pour restaurant ${restaurantId}`
			);

			res.json({
				message: "Paramètres mis à jour",
				turnoverTime: restaurant.turnoverTime,
			});
		} catch (error) {
			console.error("❌ Erreur assistant/settings update:", error);
			res.status(500).json({
				message: "Erreur lors de la mise à jour des paramètres",
			});
		}
	}
);

/**
 * POST /assistant/auto-assign-tables
 * Attribution automatique des tables pour une date donnée
 * Body: { date: "2026-01-11", restaurantId: "..." }
 */
router.post(
	"/auto-assign-tables",
	auth,
	checkRoles(["admin", "server"]),
	async (req, res) => {
		console.log("🔵 [ROUTE] /auto-assign-tables APPELÉE");
		console.log("🔵 [ROUTE] Body reçu:", JSON.stringify(req.body, null, 2));
		console.log("🔵 [ROUTE] User:", req.user?.email, "| Role:", req.user?.role);

		try {
			const { date, restaurantId } = req.body;

			console.log("🔍 [ROUTE] Validation params:", { date, restaurantId });

			if (!date) {
				console.error("❌ [ROUTE] Date manquante");
				return res.status(400).json({
					status: "error",
					message: "La date est requise",
				});
			}

			if (!restaurantId) {
				console.error("❌ [ROUTE] RestaurantId manquant");
				return res.status(400).json({
					status: "error",
					message: "Le restaurant ID est requis",
				});
			}

			console.log("🤖 [ROUTE] Attribution automatique:", {
				date,
				restaurantId,
				user: req.user?.email,
			});

			const {
				autoAssignTables,
			} = require("../services/tableAssignmentService");

			console.log("⚙️ [ROUTE] Appel service autoAssignTables...");
			const result = await autoAssignTables(restaurantId, new Date(date));

			console.log(
				"✅ [ROUTE] Résultat service:",
				JSON.stringify(result, null, 2)
			);
			res.json(result);
		} catch (error) {
			console.error("❌ [ROUTE] Erreur attribution:", error);
			console.error("❌ [ROUTE] Stack:", error.stack);
			res.status(500).json({
				status: "error",
				message: "Erreur lors de l'attribution automatique",
				error: error.message,
			});
		}
	}
);

/**
 * POST /assistant/clear-assignments
 * Supprime toutes les attributions de tables pour une date donnée
 */
router.post(
	"/clear-assignments",
	auth,
	checkRoles(["admin", "server"]),
	[
		body("restaurantId")
			.notEmpty()
			.withMessage("Restaurant ID requis")
			.isMongoId()
			.withMessage("Restaurant ID invalide"),
		body("date")
			.notEmpty()
			.withMessage("Date requise")
			.isISO8601()
			.withMessage("Format de date invalide (YYYY-MM-DD attendu)"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({
				errors: errors.array().map((err) => ({
					field: err.param,
					message: err.msg,
				})),
			});
		}

		try {
			const { restaurantId, date } = req.body;

			console.log("🗑️ [ROUTE] Suppression attributions:", {
				restaurantId,
				date,
			});

			const Reservation = require("../models/Reservation");

			// Construire les bornes de la date
			const dateStart = new Date(date);
			dateStart.setHours(0, 0, 0, 0);
			const dateEnd = new Date(date);
			dateEnd.setHours(23, 59, 59, 999);

			// Trouver toutes les réservations de la date
			const reservations = await Reservation.find({
				restaurantId: restaurantId,
				reservationDate: { $gte: dateStart, $lte: dateEnd },
				status: { $in: ["en attente", "ouverte"] },
			});

			console.log(`📊 [CLEAR] ${reservations.length} réservations trouvées`);

			// Supprimer les tableId
			let clearedCount = 0;
			for (const reservation of reservations) {
				if (reservation.tableId) {
					reservation.tableId = undefined;
					await reservation.save();
					clearedCount++;
				}
			}

			console.log(
				`✅ [CLEAR] ${clearedCount} attributions supprimées sur ${reservations.length} réservations`
			);

			res.json({
				status: "success",
				message: `${clearedCount} attribution(s) supprimée(s)`,
				clearedCount,
				totalReservations: reservations.length,
			});
		} catch (error) {
			console.error("❌ [ROUTE] Erreur suppression:", error);
			res.status(500).json({
				status: "error",
				message: "Erreur lors de la suppression des attributions",
				error: error.message,
			});
		}
	}
);

module.exports = router;
