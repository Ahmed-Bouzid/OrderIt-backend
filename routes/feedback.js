const express = require("express");
const Feedback = require("../models/Feedback");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const router = express.Router();

// POST /feedback - Créer un nouveau feedback
router.post("/", auth, async (req, res) => {
	try {
		const { category, message, includeLogs, logs } = req.body;

		// Validation
		if (!category || !message) {
			return res.status(400).json({
				message: "La catégorie et le message sont obligatoires.",
			});
		}

		if (message.length < 20 || message.length > 500) {
			return res.status(400).json({
				message: "Le message doit contenir entre 20 et 500 caractères.",
			});
		}

		const validCategories = [
			"Bug technique",
			"Problème d'affichage",
			"Problème de performance",
			"Suggestion d'amélioration",
			"Autre",
		];

		if (!validCategories.includes(category)) {
			return res.status(400).json({
				message: "Catégorie invalide.",
			});
		}

		// Créer le feedback
		const feedback = new Feedback({
			userId: req.user.id,
			userName: req.user.name || "Utilisateur",
			userRole: req.user.role || "unknown",
			restaurantId: req.user.restaurantId || null,
			category,
			message,
			includeLogs: includeLogs || false,
			logs: includeLogs && logs ? logs : null,
			timestamp: new Date(),
		});

		await feedback.save();

		// Log pour suivi
		console.log(`[FEEDBACK] Nouveau feedback reçu de ${req.user.email}`, {
			feedbackId: feedback._id,
			category,
			includeLogs: includeLogs || false,
		});

		res.status(201).json({
			message: "Merci pour votre retour ! Votre feedback a bien été envoyé.",
			feedbackId: feedback._id,
		});
	} catch (error) {
		console.error("[FEEDBACK] Erreur lors de la création du feedback:", error);
		res.status(500).json({
			message: "Impossible d'envoyer le feedback. Réessayez plus tard.",
			error: error.message,
		});
	}
});

// GET /feedback - Liste des feedbacks (admins uniquement)
router.get("/", auth, checkRoles(["admin", "manager"]), async (req, res) => {
	try {
		const {
			status,
			category,
			userId,
			startDate,
			endDate,
			limit = 50,
			page = 1,
		} = req.query;

		const query = {};

		if (status) query.status = status;
		if (category) query.category = category;
		if (userId) query.userId = userId;
		if (startDate || endDate) {
			query.timestamp = {};
			if (startDate) query.timestamp.$gte = new Date(startDate);
			if (endDate) query.timestamp.$lte = new Date(endDate);
		}

		const skip = (page - 1) * limit;
		const feedbacks = await Feedback.find(query)
			.sort({ createdAt: -1 })
			.limit(parseInt(limit))
			.skip(skip)
			.lean();

		const total = await Feedback.countDocuments(query);

		res.json({
			feedbacks,
			pagination: {
				total,
				page: parseInt(page),
				limit: parseInt(limit),
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error(
			"[FEEDBACK] Erreur lors de la récupération des feedbacks:",
			error
		);
		res.status(500).json({
			message: "Erreur lors de la récupération des feedbacks.",
			error: error.message,
		});
	}
});

// PATCH /feedback/:id - Mettre à jour le statut d'un feedback (admins uniquement)
router.patch("/:id", auth, checkRoles(["admin"]), async (req, res) => {
	try {
		const { id } = req.params;
		const { status, resolved, notes } = req.body;

		const update = {};
		if (status) update.status = status;
		if (notes !== undefined) update.notes = notes;
		if (resolved !== undefined) {
			update.resolved = resolved;
			if (resolved) {
				update.resolvedAt = new Date();
				update.resolvedBy = req.user.email;
			}
		}

		const feedback = await Feedback.findByIdAndUpdate(id, update, {
			new: true,
		});

		if (!feedback) {
			return res.status(404).json({ message: "Feedback non trouvé." });
		}

		res.json({
			message: "Feedback mis à jour.",
			feedback,
		});
	} catch (error) {
		console.error(
			"[FEEDBACK] Erreur lors de la mise à jour du feedback:",
			error
		);
		res.status(500).json({
			message: "Erreur lors de la mise à jour du feedback.",
			error: error.message,
		});
	}
});

// DELETE /feedback/:id - Supprimer un feedback (admins uniquement)
router.delete("/:id", auth, checkRoles(["admin"]), async (req, res) => {
	try {
		const { id } = req.params;

		const feedback = await Feedback.findByIdAndDelete(id);

		if (!feedback) {
			return res.status(404).json({ message: "Feedback non trouvé." });
		}

		res.json({ message: "Feedback supprimé avec succès." });
	} catch (error) {
		console.error(
			"[FEEDBACK] Erreur lors de la suppression du feedback:",
			error
		);
		res.status(500).json({
			message: "Erreur lors de la suppression du feedback.",
			error: error.message,
		});
	}
});

module.exports = router;
