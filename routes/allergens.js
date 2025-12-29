const express = require("express");
const router = express.Router();
const Allergen = require("../models/Allergen");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");

// ────────────────────────────────────────────────────────────────────────────────
// GET /allergens - Liste tous les allergènes
// ────────────────────────────────────────────────────────────────────────────────
router.get("/", auth, async (req, res) => {
	try {
		const allergens = await Allergen.find().sort({ name: 1 });
		res.json(allergens);
	} catch (error) {
		console.error("❌ Erreur GET /allergens:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /allergens/:id - Détails d'un allergène
// ────────────────────────────────────────────────────────────────────────────────
router.get("/:id", auth, async (req, res) => {
	try {
		const allergen = await Allergen.findById(req.params.id);
		if (!allergen) {
			return res.status(404).json({ message: "Allergène non trouvé" });
		}
		res.json(allergen);
	} catch (error) {
		console.error("❌ Erreur GET /allergens/:id:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /allergens - Créer un nouvel allergène (admin/manager only)
// ────────────────────────────────────────────────────────────────────────────────
router.post("/", auth, checkRoles(["admin", "manager"]), async (req, res) => {
	try {
		const { name, description, icon } = req.body;

		if (!name || !name.trim()) {
			return res.status(400).json({ message: "Le nom est requis" });
		}

		// Vérifier si l'allergène existe déjà
		const existing = await Allergen.findOne({
			name: name.trim().toLowerCase(),
		});
		if (existing) {
			return res.status(409).json({ message: "Cet allergène existe déjà" });
		}

		const allergen = new Allergen({
			name: name.trim(),
			description: description?.trim() || "",
			icon: icon || "⚠️",
		});

		await allergen.save();
		res.status(201).json(allergen);
	} catch (error) {
		console.error("❌ Erreur POST /allergens:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────────────────────────────────────────
// PUT /allergens/:id - Modifier un allergène (admin/manager only)
// ────────────────────────────────────────────────────────────────────────────────
router.put("/:id", auth, checkRoles(["admin", "manager"]), async (req, res) => {
	try {
		const { name, description, icon } = req.body;

		const allergen = await Allergen.findById(req.params.id);
		if (!allergen) {
			return res.status(404).json({ message: "Allergène non trouvé" });
		}

		if (name) allergen.name = name.trim();
		if (description !== undefined) allergen.description = description.trim();
		if (icon) allergen.icon = icon;

		await allergen.save();
		res.json(allergen);
	} catch (error) {
		console.error("❌ Erreur PUT /allergens/:id:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────────────────────────────────────────
// DELETE /allergens/:id - Supprimer un allergène (admin only)
// ────────────────────────────────────────────────────────────────────────────────
router.delete("/:id", auth, checkRoles(["admin"]), async (req, res) => {
	try {
		const allergen = await Allergen.findByIdAndDelete(req.params.id);
		if (!allergen) {
			return res.status(404).json({ message: "Allergène non trouvé" });
		}
		res.json({ message: "Allergène supprimé", allergen });
	} catch (error) {
		console.error("❌ Erreur DELETE /allergens/:id:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

module.exports = router;
