const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { body, validationResult } = require("express-validator");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");

// Validation rules pour créer un produit
const productValidationRules = [
	body("restaurantId").notEmpty().withMessage("restaurantId requis"),
	body("name").notEmpty().withMessage("Nom requis"),
	body("price").isFloat({ min: 0 }).withMessage("Prix invalide"),
	body("category").notEmpty().withMessage("Catégorie requise"),
];

// Validation rules pour modifier un produit
const productUpdateValidationRules = [
	body("name").optional().notEmpty().withMessage("Nom invalide"),
	body("price").optional().isFloat({ min: 0 }).withMessage("Prix invalide"),
	body("category").optional().notEmpty().withMessage("Catégorie invalide"),
	body("available")
		.optional()
		.isBoolean()
		.withMessage("available doit être un booléen"),
	body("image").optional().isString(),
];

// POST / - création produit (admin)
router.post(
	"/",
	auth,
	checkRoles(["admin"]),
	checkUserRestaurantBody("restaurantId"),
	productValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const { restaurantId, name, description, price, category, image } =
				req.body;

			const product = new Product({
				restaurantId,
				name,
				description,
				price,
				category,
				image,
			});
			await product.save();
			res.status(201).json(product);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// GET /restaurant/:restaurantId - lister produits
router.get(
	"/restaurant/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server", "server", "client"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const products = await Product.find({
				restaurantId: req.params.restaurantId,
			}).maxTimeMS(10000);
			if (!products.length) {
				return res.status(404).json({ message: "Aucun produit trouvé." });
			}
			res.json(products);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// PUT /:id - modifier produit (admin)
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	productUpdateValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const allowedFields = [
			"name",
			"description",
			"price",
			"category",
			"image",
			"available",
		];
		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);

		try {
			const updated = await Product.findByIdAndUpdate(req.params.id, updates, {
				new: true,
			});
			if (!updated) {
				return res.status(404).json({ message: "Produit non trouvé." });
			}
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// DELETE /:id - supprimer produit (admin)
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const deleted = await Product.findByIdAndDelete(req.params.id);
			if (!deleted) {
				return res.status(404).json({ message: "Produit non trouvé." });
			}
			res.json({ message: "Produit supprimé." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

module.exports = router;
