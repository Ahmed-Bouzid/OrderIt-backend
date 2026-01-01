const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { body, validationResult } = require("express-validator");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");

// ⭐ Import socket emitter
const { emitProductEvent } = require("../utils/socketEmitter");

// ⭐ Helper pour accéder à io via req.app
const getIO = (req) => req.app.locals.io;

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

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && restaurantId) {
				emitProductEvent(io, restaurantId, "created", product.toObject());
			}

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
			})
				.populate("allergens")
				.maxTimeMS(10000);
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
			"quantifiable",
			"quantity",
			"lowStockThreshold",
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

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && updated.restaurantId) {
				emitProductEvent(
					io,
					updated.restaurantId,
					"updated",
					updated.toObject()
				);
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

// ───────────────────────────────────────────────────────────────
// 📦 ROUTES GESTION DES STOCKS
// ───────────────────────────────────────────────────────────────

// GET /low-stock/:restaurantId - produits à stock bas
router.get(
	"/low-stock/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			console.log(
				"📦 [BACKEND] Requête low-stock pour restaurantId:",
				req.params.restaurantId
			);

			// Vérifier d'abord tous les produits quantifiables
			const allQuantifiable = await Product.find({
				restaurantId: req.params.restaurantId,
				quantifiable: true,
			})
				.select("name category quantity lowStockThreshold quantifiable")
				.maxTimeMS(10000);

			console.log(
				"📦 [BACKEND] Tous produits quantifiables:",
				allQuantifiable.length
			);
			allQuantifiable.forEach((p) => {
				const isLow = p.quantity <= p.lowStockThreshold;
				console.log(
					`  - ${p.name}: qty=${p.quantity}, threshold=${p.lowStockThreshold}, isLow=${isLow} (${p.quantity} <= ${p.lowStockThreshold})`
				);
			});

			// Utiliser $ifNull pour gérer le cas où lowStockThreshold n'existe pas (valeur par défaut: 5)
			const products = await Product.find({
				restaurantId: req.params.restaurantId,
				quantifiable: true,
				$expr: {
					$lte: ["$quantity", { $ifNull: ["$lowStockThreshold", 5] }],
				},
			})
				.select("name category quantity lowStockThreshold quantifiable")
				.sort({ quantity: 1 })
				.maxTimeMS(10000);

			console.log("📦 [BACKEND] Produits trouvés:", products.length);
			products.forEach((p, idx) => {
				console.log(
					`  ${idx + 1}. ${p.name} - catégorie: "${p.category}" - qty: ${
						p.quantity
					}/${p.lowStockThreshold}`
				);
			});

			// Grouper par catégorie
			const grouped = {
				boisson: [],
				plat: [],
				dessert: [],
				entree: [],
				autre: [],
			};

			products.forEach((p) => {
				const cat = p.category?.toLowerCase() || "autre";
				console.log(`📦 [BACKEND] Groupement: "${p.category}" -> "${cat}"`);
				if (grouped[cat]) {
					grouped[cat].push(p);
				} else {
					grouped.autre.push(p);
				}
			});

			console.log("📦 [BACKEND] Résultat groupé:", {
				boisson: grouped.boisson.length,
				plat: grouped.plat.length,
				dessert: grouped.dessert.length,
				entree: grouped.entree.length,
				autre: grouped.autre.length,
			});

			res.json({ lowStockProducts: grouped, total: products.length });
		} catch (err) {
			console.error("❌ Erreur récupération stocks bas:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// PUT /:id/stock - mettre à jour le stock d'un produit
router.put(
	"/:id/stock",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { quantity, quantifiable, lowStockThreshold } = req.body;

			const updates = {};
			if (typeof quantifiable === "boolean")
				updates.quantifiable = quantifiable;
			if (typeof quantity === "number")
				updates.quantity = Math.max(0, quantity);
			if (typeof lowStockThreshold === "number")
				updates.lowStockThreshold = Math.max(0, lowStockThreshold);

			const updated = await Product.findByIdAndUpdate(req.params.id, updates, {
				new: true,
			});

			if (!updated) {
				return res.status(404).json({ message: "Produit non trouvé." });
			}

			// ⭐ Émettre l'événement WebSocket pour mise à jour temps réel
			const io = getIO(req);
			if (io && updated.restaurantId) {
				emitProductEvent(io, updated.restaurantId, "stock:updated", {
					productId: updated._id,
					name: updated.name,
					category: updated.category,
					quantity: updated.quantity,
					quantifiable: updated.quantifiable,
					lowStockThreshold: updated.lowStockThreshold,
					isLowStock:
						updated.quantifiable &&
						updated.quantity <= updated.lowStockThreshold,
					isOutOfStock: updated.quantifiable && updated.quantity === 0,
				});
			}

			res.json(updated);
		} catch (err) {
			console.error("❌ Erreur mise à jour stock:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// PUT /:id/decrement-stock - décrémenter le stock (après commande)
router.put(
	"/:id/decrement-stock",
	auth,
	validateObjectIds(["id"]),
	async (req, res) => {
		try {
			const { quantity = 1 } = req.body;

			const product = await Product.findById(req.params.id);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé." });
			}

			// Seulement décrémenter si quantifiable
			if (!product.quantifiable || product.quantity === null) {
				return res.json({ message: "Produit non quantifiable", product });
			}

			product.quantity = Math.max(0, product.quantity - quantity);
			await product.save();

			// ⭐ Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && product.restaurantId) {
				emitProductEvent(io, product.restaurantId, "stock:updated", {
					productId: product._id,
					name: product.name,
					category: product.category,
					quantity: product.quantity,
					quantifiable: product.quantifiable,
					lowStockThreshold: product.lowStockThreshold,
					isLowStock: product.quantity <= product.lowStockThreshold,
					isOutOfStock: product.quantity === 0,
				});
			}

			res.json(product);
		} catch (err) {
			console.error("❌ Erreur décrémentation stock:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
