const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Allergen = require("../models/Allergen");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");

// ────────────────────────────────────────────────────────────────────────────────
// GET /products/:productId/allergens - Liste allergènes d'un produit
// ────────────────────────────────────────────────────────────────────────────────
router.get(
	"/:productId/allergens",
	auth,
	validateObjectIds(["productId"]),
	async (req, res) => {
		try {
			const product = await Product.findById(req.params.productId).populate(
				"allergens"
			);

			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			res.json(product.allergens || []);
		} catch (error) {
			console.error("❌ Erreur GET /products/:productId/allergens:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// POST /products/:productId/allergens - Ajouter allergènes à un produit
// ────────────────────────────────────────────────────────────────────────────────
router.post(
	"/:productId/allergens",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId"]),
	async (req, res) => {
		try {
			const { allergenIds } = req.body;

			if (!Array.isArray(allergenIds)) {
				return res
					.status(400)
					.json({ message: "allergenIds doit être un tableau" });
			}

			const product = await Product.findById(req.params.productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier que tous les allergènes existent
			const allergens = await Allergen.find({ _id: { $in: allergenIds } });
			if (allergens.length !== allergenIds.length) {
				return res
					.status(400)
					.json({ message: "Certains allergènes sont invalides" });
			}

			// Ajouter les allergènes sans doublons
			const existingIds = (product.allergens || []).map((id) => id.toString());
			const newIds = allergenIds.filter(
				(id) => !existingIds.includes(id.toString())
			);

			if (newIds.length > 0) {
				product.allergens = [...(product.allergens || []), ...newIds];
				await product.save();

				// Incrémenter usageCount
				await Allergen.updateMany(
					{ _id: { $in: newIds } },
					{ $inc: { usageCount: 1 } }
				);
			}

			await product.populate("allergens");
			res.json(product.allergens);
		} catch (error) {
			console.error("❌ Erreur POST /products/:productId/allergens:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// DELETE /products/:productId/allergens/:allergenId - Retirer allergène d'un produit
// ────────────────────────────────────────────────────────────────────────────────
router.delete(
	"/:productId/allergens/:allergenId",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId", "allergenId"]),
	async (req, res) => {
		try {
			const { productId, allergenId } = req.params;

			const product = await Product.findById(productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			const initialLength = (product.allergens || []).length;
			product.allergens = (product.allergens || []).filter(
				(id) => id.toString() !== allergenId
			);

			if (product.allergens.length === initialLength) {
				return res
					.status(404)
					.json({ message: "Allergène non associé à ce produit" });
			}

			await product.save();

			// Décrémenter usageCount
			await Allergen.findByIdAndUpdate(allergenId, {
				$inc: { usageCount: -1 },
			});

			await product.populate("allergens");
			res.json(product.allergens);
		} catch (error) {
			console.error(
				"❌ Erreur DELETE /products/:productId/allergens/:allergenId:",
				error
			);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// PUT /products/:productId/allergens - Remplacer tous les allergènes d'un produit
// ────────────────────────────────────────────────────────────────────────────────
router.put(
	"/:productId/allergens",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId"]),
	async (req, res) => {
		try {
			const { allergenIds } = req.body;

			if (!Array.isArray(allergenIds)) {
				return res
					.status(400)
					.json({ message: "allergenIds doit être un tableau" });
			}

			const product = await Product.findById(req.params.productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier que tous les allergènes existent
			if (allergenIds.length > 0) {
				const allergens = await Allergen.find({ _id: { $in: allergenIds } });
				if (allergens.length !== allergenIds.length) {
					return res
						.status(400)
						.json({ message: "Certains allergènes sont invalides" });
				}
			}

			// Mettre à jour usageCount (décrémenter anciens, incrémenter nouveaux)
			const oldIds = (product.allergens || []).map((id) => id.toString());
			const newIds = allergenIds.map((id) => id.toString());

			const toDecrement = oldIds.filter((id) => !newIds.includes(id));
			const toIncrement = newIds.filter((id) => !oldIds.includes(id));

			if (toDecrement.length > 0) {
				await Allergen.updateMany(
					{ _id: { $in: toDecrement } },
					{ $inc: { usageCount: -1 } }
				);
			}

			if (toIncrement.length > 0) {
				await Allergen.updateMany(
					{ _id: { $in: toIncrement } },
					{ $inc: { usageCount: 1 } }
				);
			}

			product.allergens = allergenIds;
			await product.save();
			await product.populate("allergens");

			res.json(product.allergens);
		} catch (error) {
			console.error("❌ Erreur PUT /products/:productId/allergens:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
