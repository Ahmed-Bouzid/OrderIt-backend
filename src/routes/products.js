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
	body("addOns").optional().isBoolean().withMessage("addOns doit être un booléen"),
	body("hasAddOns").optional().isBoolean().withMessage("hasAddOns doit être un booléen"),
	body("allowedAddOns")
		.optional()
		.isArray()
		.withMessage("allowedAddOns doit être un tableau"),
	body("allowedAddOns.*")
		.if(() => body("allowedAddOns").exists())
		.custom((value) => {
			if (!value || typeof value !== "string" || value.length !== 24) {
				throw new Error("allowedAddOns doit contenir des ObjectIds valides");
			}
			return true;
		}),
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
	checkRoles(["admin", "developer", "server", "client"]),
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
			"baseQuantity",
			"quantity",
			"lowStockThreshold",
			"addOns",
			"hasAddOns",
			"allowedAddOns",
			"isFormule",
			"formuleSteps",
		];
		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);
		console.log(`[PRODUCT PUT] isFormule=${updates.isFormule} formuleSteps=${JSON.stringify(updates.formuleSteps)}`);

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

// GET /all-stock/:restaurantId - TOUS les produits quantifiables, séparés ok/low
router.get(
	"/all-stock/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const products = await Product.find({
				restaurantId: req.params.restaurantId,
				quantifiable: true,
			})
				.select("name category quantity lowStockThreshold quantifiable")
				.sort({ quantity: 1 })
				.maxTimeMS(10000);

			const ok = [];
			const low = [];

			products.forEach((p) => {
				const threshold = p.lowStockThreshold ?? 5;
				if (p.quantity <= threshold) {
					low.push(p);
				} else {
					ok.push(p);
				}
			});

			res.json({ ok, low, total: products.length });
		} catch (err) {
			console.error("❌ Erreur récupération all-stock:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// GET /low-stock/:restaurantId - produits à stock bas
router.get(
	"/low-stock/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {

			// Vérifier d'abord tous les produits quantifiables
			const allQuantifiable = await Product.find({
				restaurantId: req.params.restaurantId,
				quantifiable: true,
			})
				.select("name category quantity lowStockThreshold quantifiable")
				.maxTimeMS(10000);

			allQuantifiable.forEach((p) => {
				const isLow = p.quantity <= p.lowStockThreshold;
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

			products.forEach((p, idx) => {
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
				if (grouped[cat]) {
					grouped[cat].push(p);
				} else {
					grouped.autre.push(p);
				}
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

// GET /addons/:restaurantId - récupérer les add-ons disponibles
router.get(
	"/addons/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkUserRestaurant,
	async (req, res) => {
		try {
			const { restaurantId } = req.params;

			const addOns = await Product.findAddOns(restaurantId);

			res.json(addOns);
		} catch (err) {
			console.error("❌ Erreur récupération add-ons:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ⭐ POST /:id/options - Ajouter une option/supplément à un produit
router.post(
	"/:id/options",
	auth,
	checkRoles(["admin"]),
	validateObjectIds(["id"]),
	[
		body("name").notEmpty().withMessage("Nom de l'option requis"),
		body("price").isFloat({ min: 0 }).withMessage("Prix invalide"),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const { id } = req.params;
			const { name, price } = req.body;

			const product = await Product.findById(id);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier l'appartenance au restaurant de l'utilisateur
			if (product.restaurantId.toString() !== req.user.restaurantId.toString()) {
				return res.status(403).json({ message: "Accès refusé" });
			}

			// Trouver ou créer le groupe "Suppléments"
			let supplementsGroup = product.options.find(
				(opt) => opt.id === "supplements"
			);

			const newChoice = {
				id: `choice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				name: name.trim(),
				priceAdjustment: parseFloat(price),
				available: true,
			};

			if (!supplementsGroup) {
				// Créer le groupe Suppléments
				supplementsGroup = {
					id: "supplements",
					name: "Suppléments",
					description: "Options supplémentaires",
					required: false,
					multiSelect: true,
					available: true,
					choices: [newChoice],
				};
				product.options.push(supplementsGroup);
			} else {
				// Ajouter au groupe existant
				supplementsGroup.choices.push(newChoice);
			}

			await product.save();

			// Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && product.restaurantId) {
				emitProductEvent(io, product.restaurantId, "updated", product.toObject());
			}

			// Retourner l'option ajoutée dans un format simple pour le frontend
			res.status(201).json({
				_id: newChoice.id,
				name: newChoice.name,
				price: newChoice.priceAdjustment,
			});
		} catch (err) {
			console.error("❌ Erreur ajout option:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ⭐ GET /:id/options - Lister les options d'un produit
router.get(
	"/:id/options",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server"]),
	async (req, res) => {
		try {
			const { id } = req.params;

			const product = await Product.findById(id);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier l'appartenance au restaurant de l'utilisateur
			if (product.restaurantId.toString() !== req.user.restaurantId.toString()) {
				return res.status(403).json({ message: "Accès refusé" });
			}

			// Extraire les choices du groupe Suppléments
			const supplementsGroup = product.options.find(
				(opt) => opt.id === "supplements"
			);

			if (!supplementsGroup || !supplementsGroup.choices) {
				return res.json([]);
			}

			// Formatter pour le frontend
			const formattedOptions = supplementsGroup.choices.map((choice) => ({
				_id: choice.id,
				name: choice.name,
				price: choice.priceAdjustment,
				available: choice.available,
			}));

			res.json(formattedOptions);
		} catch (err) {
			console.error("❌ Erreur récupération options:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// ⭐ DELETE /:id/options/:optionId - Supprimer une option
router.delete(
	"/:id/options/:optionId",
	auth,
	checkRoles(["admin"]),
	validateObjectIds(["id"]),
	async (req, res) => {
		try {
			const { id, optionId } = req.params;

			const product = await Product.findById(id);
			if (!product) {
				return res.status(404).json({ message: "Produit non trouvé" });
			}

			// Vérifier l'appartenance au restaurant de l'utilisateur
			if (product.restaurantId.toString() !== req.user.restaurantId.toString()) {
				return res.status(403).json({ message: "Accès refusé" });
			}

			// Trouver le groupe Suppléments
			const supplementsGroup = product.options.find(
				(opt) => opt.id === "supplements"
			);

			if (!supplementsGroup) {
				return res.status(404).json({ message: "Option non trouvée" });
			}

			// Supprimer le choice
			const initialLength = supplementsGroup.choices.length;
			supplementsGroup.choices = supplementsGroup.choices.filter(
				(choice) => choice.id !== optionId
			);

			if (supplementsGroup.choices.length === initialLength) {
				return res.status(404).json({ message: "Option non trouvée" });
			}

			// Si plus de choices, supprimer le groupe entier
			if (supplementsGroup.choices.length === 0) {
				product.options = product.options.filter(
					(opt) => opt.id !== "supplements"
				);
			}

			await product.save();

			// Émettre l'événement WebSocket
			const io = getIO(req);
			if (io && product.restaurantId) {
				emitProductEvent(io, product.restaurantId, "updated", product.toObject());
			}

			res.json({ message: "Option supprimée avec succès" });
		} catch (err) {
			console.error("❌ Erreur suppression option:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
