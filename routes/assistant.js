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
const { getAvailableSlotsForDay } = require("../utils/slotGenerator");

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

			// Utiliser le nouveau service basé sur les tables
			const result = await checkTableAvailability({
				restaurantId,
				date,
				time,
				people: parseInt(people),
			});


			res.json(result);
		} catch (error) {
			console.error("❌ Erreur assistant/check-availability:", error);
			res.status(500).json({
				message: "Erreur lors de la vérification de disponibilité",
				error: error.message,
			});
		}
	},
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

			const restaurant =
				await Restaurant.findById(restaurantId).select("turnoverTime");

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
	},
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
				{ new: true },
			).select("turnoverTime");

			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}


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
	},
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
		try {
			const { date, restaurantId } = req.body;


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

			const {
				autoAssignTables,
			} = require("../services/tableAssignmentService");

			const result = await autoAssignTables(restaurantId, new Date(date));

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
	},
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
				status: { $in: ["pending", "confirmed", "en attente", "ouverte"] },
			});


			// Supprimer les tableId
			let clearedCount = 0;
			for (const reservation of reservations) {
				if (reservation.tableId) {
					reservation.tableId = undefined;
					await reservation.save();
					clearedCount++;
				}
			}


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
	},
);

/**
 * Raisonne sur les créneaux disponibles et retourne les meilleures suggestions.
 * Catégorise par service (déjeuner 11-15h / dîner 18-23h), choisit le créneau
 * le plus disponible par service + un 3e créneau s'il n'est pas déjà proposé.
 *
 * @param {Array} slots - résultat de getAvailableSlotsForDay
 * @returns {{ summary: string, suggestions: Array }}
 */
function reasonAboutSlots(slots) {
	if (slots.length === 0) {
		return {
			summary: "Aucun créneau disponible pour ce jour.",
			suggestions: [],
		};
	}

	const getHour = (time) => parseInt(time.split(":")[0]);

	const lunchSlots = slots.filter((s) => {
		const h = getHour(s.time);
		return h >= 11 && h < 15;
	});
	const dinnerSlots = slots.filter((s) => {
		const h = getHour(s.time);
		return h >= 18 && h < 23;
	});

	const makeSuggestion = (slot, label) => {
		const fillRate = 1 - slot.availableTables / slot.totalTables;
		let reason;
		if (fillRate === 0) reason = "Service vide, toutes les tables libres";
		else if (fillRate < 0.3) reason = "Service calme, large choix de tables";
		else if (fillRate < 0.6)
			reason = "Service à moitié rempli, bonne disponibilité";
		else reason = "Service chargé, quelques tables restantes";
		return { ...slot, label, reason };
	};

	const suggestions = [];

	if (lunchSlots.length > 0) {
		const best = lunchSlots.reduce((a, b) =>
			a.availableTables >= b.availableTables ? a : b,
		);
		suggestions.push(makeSuggestion(best, "Déjeuner"));
	}

	if (dinnerSlots.length > 0) {
		const best = dinnerSlots.reduce((a, b) =>
			a.availableTables >= b.availableTables ? a : b,
		);
		suggestions.push(makeSuggestion(best, "Dîner"));
	}

	// Aucun service standard détecté (horaires atypiques) → top 3 par disponibilité
	if (suggestions.length === 0) {
		[...slots]
			.sort((a, b) => b.availableTables - a.availableTables)
			.slice(0, 3)
			.forEach((s, i) =>
				suggestions.push(
					makeSuggestion(
						s,
						i === 0 ? "Meilleur créneau" : `Option ${i + 1}`,
					),
				),
			);
	}

	// Si déjeuner + dîner uniquement, ajouter le créneau le plus disponible hors ces deux
	if (suggestions.length === 2) {
		const already = new Set(suggestions.map((s) => s.time));
		const extra = [...slots]
			.sort((a, b) => b.availableTables - a.availableTables)
			.find((s) => !already.has(s.time));
		if (extra) suggestions.push(makeSuggestion(extra, "Plus de disponibilité"));
	}

	const summary =
		slots.length === 1
			? "Un seul créneau disponible ce jour."
			: `${slots.length} créneaux disponibles. Voici mes recommandations pour votre groupe.`;

	return { summary, suggestions };
}

/**
 * POST /assistant/suggest
 * Analyse le planning d'un jour et retourne les meilleures suggestions de créneaux
 * Body: { restaurantId, date, people }
 * Retourne: { summary, suggestions: [{ time, availableTables, totalTables, label, reason }] }
 */
router.post(
	"/suggest",
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
		body("people").optional().isInt({ min: 1, max: 300 }),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const { restaurantId, date, people } = req.body;

			const slots = await getAvailableSlotsForDay({
				restaurantId,
				date: new Date(date),
				stepMinutes: 15,
				includeZero: false,
				guests: people ? parseInt(people) : 0,
			});

			const result = reasonAboutSlots(slots);


			res.json(result);
		} catch (err) {
			console.error("❌ [SUGGEST]", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
