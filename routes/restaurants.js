const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const serverValidationRules = require("../middlewares/serverValidationRules");
const restaurantValidationRules = require("../middlewares/restaurantValidationRules");

const checkRoles = require("../middlewares/checkRoles");
const Restaurant = require("../models/Restaurant");
const Product = require("../models/Product");
const Server = require("../models/Server");
const Admin = require("../models/Admin");
const Style = require("../models/Style");
const auth = require("../middlewares/auth");
const productValidationRules = require("../middlewares/productValidationRules");
const router = express.Router();

// Création d’un nouveau restaurant
router.post(
	"/",
	auth,
	checkRoles(["admin"]),
	restaurantValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });
		try {
			const { name, email, password, role } = req.body;

			const existing = await Restaurant.findOne({ email });
			if (existing) {
				return res.status(400).json({ message: "Email déjà utilisé." });
			}

			const passwordHash = await bcrypt.hash(password, 12);

			const newRestaurant = new Restaurant({
				name,
				email,
				passwordHash,
				role: role || "admin",
			});

			await newRestaurant.save();
			res.status(201).json({ message: "Restaurant créé avec succès." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);
// 🏪 GET /restaurants/:id/info - Récupérer les infos publiques d'un restaurant (category, name, Google)
router.get("/:id/info", validateObjectIds(["id"]), async (req, res) => {
	try {
		const restaurant = await Restaurant.findById(req.params.id).select(
			"name category googlePlaceId googleReviewUrl",
		);

		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant non trouvé" });
		}

		res.json({
			name: restaurant.name,
			category: restaurant.category || "restaurant",
			googlePlaceId: restaurant.googlePlaceId || null,
			googleUrl: restaurant.googleReviewUrl || null,
		});
	} catch (err) {
		console.error("Erreur récupération info restaurant:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// 🎨 GET /restaurants/:id/config - Récupérer la configuration complète (style + catégories)
router.get("/:id/config", validateObjectIds(["id"]), async (req, res) => {
	try {
		const restaurant = await Restaurant.findById(req.params.id).select(
			"name category styleKey",
		);

		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant non trouvé" });
		}

		// Récupérer le style appliqué (ou le style par défaut)
		const styleKey = restaurant.styleKey || "premium";
		const style = await Style.findByKey(styleKey);

		// Si le style n'existe pas, utiliser premium par défaut
		let styleConfig = null;
		let styleName = "Style Premium";

		if (style) {
			styleConfig = style.config;
			styleName = style.name;
		} else {
			// Fallback vers premium si le style n'existe pas
			const premiumStyle = await Style.findByKey("premium");
			if (premiumStyle) {
				styleConfig = premiumStyle.config;
				styleName = premiumStyle.name;
			}
		}

		// Récupérer les catégories de produits disponibles
		const categories = await Product.distinct("category", {
			restaurantId: req.params.id,
			archived: false,
			available: true,
		});

		res.json({
			restaurant_id: req.params.id,
			restaurant_name: restaurant.name,
			category: restaurant.category || "restaurant",
			style: {
				key: styleKey,
				name: styleName,
				config: styleConfig,
			},
			categories: categories, // ✅ Retourner juste les noms, le client gérera le mapping
			menuLayout: styleConfig?.menuLayout || "grid",
		});
	} catch (err) {
		console.error("Erreur récupération config restaurant:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});
// Ajout d’un server
router.post(
	"/:id/server",
	auth,
	validateObjectIds(["id"]),
	checkUserRestaurant("id"),
	checkRoles(["admin"]),
	serverValidationRules,
	async (req, res) => {
		try {
			const restaurantId = req.params.id;
			const { serverId, name, email, password } = req.body;

			if (!serverId || !name || !email || !password) {
				return res
					.status(400)
					.json({ message: "Tous les champs sont requis." });
			}

			const exists = await Server.findOne({
				restaurantId,
				$or: [{ serverId }, { email }],
			});
			if (exists) {
				return res
					.status(400)
					.json({ message: "serverId ou email déjà utilisés." });
			}

			const passwordHash = await bcrypt.hash(password, 12);

			const newServer = new Server({
				restaurantId,
				serverId,
				name,
				email,
				passwordHash,
			});

			await newServer.save();

			const restaurant = await Restaurant.findById(restaurantId);
			if (!restaurant.servers) restaurant.servers = [];
			restaurant.servers.push(newServer._id);
			await restaurant.save();

			res
				.status(201)
				.json({ message: "server ajouté avec succès.", server: newServer });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur lors de l'ajout du server." });
		}
	},
);

// Liste de tous les restaurants
router.get("/", auth, checkRoles(["admin"]), async (req, res) => {
	try {
		const restaurants = await Restaurant.find({}, "-passwordHash");
		res.json(restaurants);
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: "Erreur server." });
	}
});

// Liste des servers d’un restaurant
router.get(
	"/:id/servers",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "server", "restaurant"]),
	checkUserRestaurant("id"),
	async (req, res) => {
		try {
			const restaurantId = req.params.id;
			const servers = await Server.find({ restaurantId }).select(
				"-passwordHash",
			);

			// ⭐ Enrichir avec le statut en ligne (WebSocket)
			const onlineStaff = req.app.locals.onlineStaff;
			const staffMap = onlineStaff?.get(restaurantId);
			const onlineUserIds = staffMap ? Array.from(staffMap.keys()) : [];

			// Inclure les admins connectés aussi
			const admins = await Admin.find({ restaurantId }).select(
				"_id name email role serverId",
			);

			const allStaff = [
				...servers.map((s) => ({
					...s.toObject(),
					isOnline: onlineUserIds.includes(s._id.toString()),
				})),
				...admins.map((a) => ({
					...a.toObject(),
					isOnline: onlineUserIds.includes(a._id.toString()),
				})),
			];

			res.json(allStaff);
		} catch (err) {
			console.error(err);
			res.status(500).json({
				message: "Erreur server lors de la récupération des servers.",
			});
		}
	},
);

// Détails d’un restaurant
router.get(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkUserRestaurant("id"),
	checkRoles(["admin", "restaurant"]),
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id).select(
				"-passwordHash",
			);
			if (!restaurant)
				return res.status(404).json({ message: "Restaurant non trouvé." });
			res.json(restaurant);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// Modifier un restaurant
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkUserRestaurant("id"),
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			// 🛡️ Champs autorisés à la modification
			const allowedFields = ["name", "email", "password"];

			// 🧼 On filtre les champs présents dans req.body
			const updates = Object.fromEntries(
				Object.entries(req.body).filter(([key]) => allowedFields.includes(key)),
			);

			// 🔐 Si mot de passe modifié, on le hash puis on supprime l’ancien champ
			if (updates.password) {
				updates.passwordHash = await bcrypt.hash(updates.password, 12);
				delete updates.password;
			}

			// 🏗️ Mise à jour du document
			const updated = await Restaurant.findByIdAndUpdate(
				req.params.id,
				updates,
				{ new: true },
			).select("-passwordHash"); // On ne retourne jamais le hash au client

			// 📭 Vérifie si le restaurant existe
			if (!updated) {
				return res.status(404).json({ message: "Restaurant non trouvé." });
			}

			// ✅ Réponse
			res.json({ message: "Restaurant modifié.", restaurant: updated });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// Supprimer un restaurant
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkUserRestaurant("id"),
	checkRoles(["admin", "developer"]),
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id);
			if (!restaurant)
				return res.status(404).json({ message: "Restaurant non trouvé." });

			// 🗑️ Supprimer tous les produits du restaurant
			const deletedProducts = await Product.deleteMany({
				restaurantId: req.params.id,
			});

			// 🗑️ Supprimer tous les serveurs du restaurant
			const deletedServers = await Server.deleteMany({
				restaurantId: req.params.id,
			});

			// 🗑️ Supprimer le restaurant
			await Restaurant.findByIdAndDelete(req.params.id);

			res.json({
				message: "Restaurant et ses données supprimés.",
				deletedProducts: deletedProducts.deletedCount,
				deletedServers: deletedServers.deletedCount,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// Créer un produit
router.post(
	"/:restaurantId/products",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin"]),
	checkUserRestaurant("restaurantId"),
	productValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const { name, description, price, category, image, available } = req.body;
			const restaurantId = req.params.restaurantId;

			const newProduct = new Product({
				restaurantId,
				name,
				description,
				price,
				category,
				image,
				available,
			});

			await newProduct.save();

			await Restaurant.findByIdAndUpdate(restaurantId, {
				$push: { products: newProduct._id },
			});

			res.status(201).json({ message: "Produit créé.", product: newProduct });
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors de la création du produit." });
		}
	},
);

// Liste des produits d’un restaurant
router.get(
	"/:restaurantId/products",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "restaurant", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const products = await Product.find({
				restaurantId: req.params.restaurantId,
			});
			res.json(products);
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement des produits." });
		}
	},
);

// Modifier un produit
router.put(
	"/products/:productId",
	auth,
	validateObjectIds(["productId"]),
	checkRoles(["admin", "restaurant"]),
	productValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const product = await Product.findById(req.params.productId);
			if (!product)
				return res.status(404).json({ message: "Produit non trouvé." });

			// Vérification d'accès
			if (
				req.user.role !== "admin" &&
				req.user.restaurantId.toString() !== product.restaurantId.toString()
			) {
				return res
					.status(403)
					.json({ message: "Accès interdit à ce produit." });
			}

			// Champs autorisés à modifier
			const allowedFields = [
				"name",
				"price",
				"description",
				"category",
				"image",
				"available",
			];

			// On filtre req.body
			const updates = Object.fromEntries(
				Object.entries(req.body).filter(([key]) => allowedFields.includes(key)),
			);

			// Mise à jour
			const updated = await Product.findByIdAndUpdate(
				req.params.productId,
				updates,
				{ new: true },
			);

			res.json({ message: "Produit modifié.", product: updated });
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors de la modification du produit." });
		}
	},
);

// Supprimer un produit
router.delete(
	"/products/:productId",
	auth,
	validateObjectIds(["productId"]),
	checkRoles(["admin", "restaurant"]),
	async (req, res) => {
		try {
			const product = await Product.findById(req.params.productId);
			if (!product)
				return res.status(404).json({ message: "Produit non trouvé." });

			if (
				req.user.role !== "admin" &&
				req.user.restaurantId.toString() !== product.restaurantId.toString()
			) {
				return res
					.status(403)
					.json({ message: "Accès interdit à ce produit." });
			}

			await Product.findByIdAndDelete(req.params.productId);

			// Supprimer aussi du tableau "products" du restaurant
			await Restaurant.findByIdAndUpdate(product.restaurantId, {
				$pull: { products: product._id },
			});

			res.json({ message: "Produit supprimé." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur lors de la suppression." });
		}
	},
);

// 🗑️ Supprimer uniquement les tables d'un restaurant (mode développeur)
router.delete(
	"/:id/tables",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["developer"]),
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id);
			if (!restaurant)
				return res.status(404).json({ message: "Restaurant non trouvé." });

			const Table = require("../models/Table");
			const deletedTables = await Table.deleteMany({
				restaurantId: req.params.id,
			});


			res.json({
				message: "Tables supprimées.",
				deletedTables: deletedTables.deletedCount,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// 🗑️ Supprimer uniquement les serveurs d'un restaurant (mode développeur)
router.delete(
	"/:id/servers",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["developer"]),
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id);
			if (!restaurant)
				return res.status(404).json({ message: "Restaurant non trouvé." });

			const deletedServers = await Server.deleteMany({
				restaurantId: req.params.id,
			});


			res.json({
				message: "Serveurs supprimés.",
				deletedServers: deletedServers.deletedCount,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// 🗑️ Supprimer uniquement les produits d'un restaurant (mode développeur)
router.delete(
	"/:id/products",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["developer"]),
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id);
			if (!restaurant)
				return res.status(404).json({ message: "Restaurant non trouvé." });

			const deletedProducts = await Product.deleteMany({
				restaurantId: req.params.id,
			});

			// Nettoyer le tableau products du restaurant
			await Restaurant.findByIdAndUpdate(req.params.id, {
				$set: { products: [] },
			});


			res.json({
				message: "Produits supprimés.",
				deletedProducts: deletedProducts.deletedCount,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

module.exports = router;
