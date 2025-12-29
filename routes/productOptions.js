const express = require("express");
const router = express.Router();
const ProductOption = require("../models/ProductOption");
const Product = require("../models/Product");
const { body, validationResult } = require("express-validator");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");

// ⭐ Import socket emitter
const { emitProductEvent } = require("../utils/socketEmitter");

// ────────────────────────────────────────────────────────────────────────────────
// GET /products/:productId/options - Récupérer toutes les options d'un produit
// ────────────────────────────────────────────────────────────────────────────────
router.get(
	"/:productId/options",
	auth,
	validateObjectIds(["productId"]),
	async (req, res) => {
		try {
			const { productId } = req.params;

			// Vérifier que le produit existe
			const product = await Product.findById(productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Récupérer toutes les options du produit
			const options = await ProductOption.find({ productId }).sort({
				createdAt: 1,
			});

			res.status(200).json(options);
		} catch (error) {
			console.error("❌ Erreur GET options:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// POST /products/:productId/options - Créer une option pour un produit
// ────────────────────────────────────────────────────────────────────────────────
router.post(
	"/:productId/options",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId"]),
	[
		body("name").notEmpty().trim().withMessage("Le nom de l'option est requis"),
		body("price")
			.optional()
			.isFloat({ min: 0 })
			.withMessage("Le prix doit être un nombre positif"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { productId } = req.params;
			const { name, price } = req.body;

			// Vérifier que le produit existe
			const product = await Product.findById(productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Créer l'option
			const newOption = await ProductOption.create({
				productId,
				name,
				price: price || 0,
			});

			// Émettre un événement WebSocket
			if (req.app.locals.io) {
				emitProductEvent(req.app.locals.io, product.restaurantId, {
					action: "option_added",
					productId,
					option: newOption,
				});
			}

			res.status(201).json(newOption);
		} catch (error) {
			console.error("❌ Erreur POST option:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// PUT /products/:productId/options/:optionId - Modifier une option
// ────────────────────────────────────────────────────────────────────────────────
router.put(
	"/:productId/options/:optionId",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId", "optionId"]),
	[
		body("name")
			.optional()
			.notEmpty()
			.trim()
			.withMessage("Le nom ne peut pas être vide"),
		body("price")
			.optional()
			.isFloat({ min: 0 })
			.withMessage("Le prix doit être un nombre positif"),
		body("available")
			.optional()
			.isBoolean()
			.withMessage("available doit être un booléen"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { productId, optionId } = req.params;
			const { name, price, available } = req.body;

			// Vérifier que le produit existe
			const product = await Product.findById(productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier que l'option existe et appartient bien au produit
			const option = await ProductOption.findOne({
				_id: optionId,
				productId,
			});
			if (!option) {
				return res.status(404).json({ message: "Option non trouvée" });
			}

			// Mettre à jour l'option
			if (name !== undefined) option.name = name;
			if (price !== undefined) option.price = price;
			if (available !== undefined) option.available = available;

			await option.save();

			// Émettre un événement WebSocket
			if (req.app.locals.io) {
				emitProductEvent(req.app.locals.io, product.restaurantId, {
					action: "option_updated",
					productId,
					option,
				});
			}

			res.status(200).json(option);
		} catch (error) {
			console.error("❌ Erreur PUT option:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ────────────────────────────────────────────────────────────────────────────────
// DELETE /products/:productId/options/:optionId - Supprimer une option
// ────────────────────────────────────────────────────────────────────────────────
router.delete(
	"/:productId/options/:optionId",
	auth,
	checkRoles(["admin", "manager"]),
	validateObjectIds(["productId", "optionId"]),
	async (req, res) => {
		try {
			const { productId, optionId } = req.params;

			// Vérifier que le produit existe
			const product = await Product.findById(productId);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier que l'option existe et appartient bien au produit
			const option = await ProductOption.findOneAndDelete({
				_id: optionId,
				productId,
			});

			if (!option) {
				return res.status(404).json({ message: "Option non trouvée" });
			}

			// Émettre un événement WebSocket
			if (req.app.locals.io) {
				emitProductEvent(req.app.locals.io, product.restaurantId, {
					action: "option_deleted",
					productId,
					optionId,
				});
			}

			res.status(200).json({ message: "Option supprimée avec succès" });
		} catch (error) {
			console.error("❌ Erreur DELETE option:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
