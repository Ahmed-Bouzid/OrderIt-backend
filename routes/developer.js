const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkDeveloper = require("../middlewares/checkDeveloper");
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");
const Reservation = require("../models/Reservation");
const Product = require("../models/Product");
const Server = require("../models/Server");

/**
 * GET /developer/restaurants
 * Liste tous les restaurants du système (réservé au développeur)
 */
router.get("/restaurants", auth, checkDeveloper, async (req, res) => {
	try {
		const restaurants = await Restaurant.find()
			.select(
				"_id name email phone address createdAt turnoverTime active subscriptionPlan"
			)
			.lean();

		// Enrichir avec des stats
		const enrichedRestaurants = await Promise.all(
			restaurants.map(async (resto) => {
				const [tableCount, reservationCount, productCount, serverCount] =
					await Promise.all([
						Table.countDocuments({ restaurantId: resto._id }),
						Reservation.countDocuments({ restaurantId: resto._id }),
						Product.countDocuments({ restaurantId: resto._id }),
						Server.countDocuments({ restaurantId: resto._id }),
					]);

				return {
					...resto,
					stats: {
						tables: tableCount,
						reservations: reservationCount,
						products: productCount,
						servers: serverCount,
					},
				};
			})
		);

		res.json({
			status: "success",
			count: enrichedRestaurants.length,
			restaurants: enrichedRestaurants,
		});
	} catch (error) {
		console.error("❌ Erreur récupération restaurants:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

/**
 * GET /developer/restaurant/:id
 * Récupère les détails complets d'un restaurant
 */
router.get("/restaurant/:id", auth, checkDeveloper, async (req, res) => {
	try {
		const { id } = req.params;

		const restaurant = await Restaurant.findById(id).lean();
		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant non trouvé" });
		}

		// Charger toutes les données associées
		const [tables, reservations, products, servers] = await Promise.all([
			Table.find({ restaurantId: id }).lean(),
			Reservation.find({ restaurantId: id })
				.sort({ reservationDate: -1, reservationTime: -1 })
				.limit(100)
				.lean(),
			Product.find({ restaurantId: id }).populate("options").lean(),
			Server.find({ restaurantId: id }).select("-passwordHash").lean(),
		]);

		res.json({
			status: "success",
			restaurant: {
				...restaurant,
				tables,
				reservations,
				products,
				servers,
			},
		});
	} catch (error) {
		console.error("❌ Erreur récupération restaurant:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

/**
 * POST /developer/switch-restaurant
 * Change le restaurant actif pour le développeur
 * Body: { restaurantId: "..." }
 */
router.post("/switch-restaurant", auth, checkDeveloper, async (req, res) => {
	try {
		const { restaurantId } = req.body;

		if (!restaurantId) {
			return res.status(400).json({ message: "restaurantId requis" });
		}

		const restaurant = await Restaurant.findById(restaurantId);
		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant non trouvé" });
		}

		// Retourner le restaurant sélectionné
		res.json({
			status: "success",
			message: `Changement vers ${restaurant.name}`,
			restaurant: {
				_id: restaurant._id,
				name: restaurant.name,
				email: restaurant.email,
				phone: restaurant.phone,
				address: restaurant.address,
				turnoverTime: restaurant.turnoverTime,
			},
		});
	} catch (error) {
		console.error("❌ Erreur switch restaurant:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

/**
 * POST /developer/import-menu
 * Importe un menu complet pour un restaurant (réservé au développeur)
 * Body: { restaurant_id, menu: [{ category, items: [{ name, price, description }] }] }
 */
router.post("/import-menu", auth, checkDeveloper, async (req, res) => {
	try {
		const { restaurant_id, menu } = req.body;

		// Validation
		if (!restaurant_id) {
			return res.status(400).json({
				status: "error",
				message: "restaurant_id est requis",
			});
		}

		if (!menu || !Array.isArray(menu) || menu.length === 0) {
			return res.status(400).json({
				status: "error",
				message: "menu doit être un tableau non vide",
			});
		}

		// Vérifier que le restaurant existe
		const restaurant = await Restaurant.findById(restaurant_id);
		if (!restaurant) {
			return res.status(404).json({
				status: "error",
				message: "Restaurant introuvable",
			});
		}

		console.log(
			`📸 Import menu pour ${restaurant.name} (${restaurant_id}) - ${menu.length} catégories`
		);

		// Fonction pour normaliser les catégories (éviter les doublons)
		const normalizeCategory = (categoryName) => {
			return categoryName
				.trim()
				.toLowerCase()
				.replace(/^(les?|la|l'|le)\s+/i, "") // Enlever articles
				.replace(/[^a-z0-9àâäéèêëïîôùûç]/g, "") // Garder alphanum + accents
				.trim();
		};

		// Récupérer les catégories existantes pour détecter les doublons
		const existingCategories = await Product.distinct("category", {
			restaurantId: restaurant_id,
			archived: false,
		});

		// Map pour normalisation : normalized -> nom original préféré
		const categoryMap = new Map();
		existingCategories.forEach((cat) => {
			const normalized = normalizeCategory(cat);
			if (!categoryMap.has(normalized)) {
				categoryMap.set(normalized, cat);
			}
		});

		// Traiter les nouvelles catégories du JSON
		const newCategories = new Set();
		menu.forEach((categoryData) => {
			const normalized = normalizeCategory(categoryData.category);
			if (!categoryMap.has(normalized)) {
				// Nouvelle catégorie détectée
				categoryMap.set(normalized, categoryData.category);
				newCategories.add(categoryData.category);
			}
		});

		console.log(
			`📂 ${existingCategories.length} catégories existantes, ${newCategories.size} nouvelles`
		);
		if (newCategories.size > 0) {
			console.log("🆕 Nouvelles catégories:", [...newCategories].join(", "));
		}

		// Archiver l'ancien menu (soft delete)
		const archivedCount = await Product.updateMany(
			{ restaurantId: restaurant_id },
			{ $set: { archived: true, available: false } }
		);

		console.log(`🗄️ ${archivedCount.modifiedCount} produits archivés`);

		// Importer le nouveau menu
		let totalImported = 0;
		const importErrors = [];

		for (const categoryData of menu) {
			const { category, items } = categoryData;

			if (!category || !Array.isArray(items)) {
				importErrors.push({
					category: category || "unknown",
					error: "Format invalide",
				});
				continue;
			}

			// Utiliser le nom de catégorie normalisé (préférer l'existant si doublon)
			const normalized = normalizeCategory(category);
			const finalCategoryName = categoryMap.get(normalized) || category.trim();

			for (const item of items) {
				try {
					const { name, price, description } = item;

					if (!name || typeof price !== "number") {
						importErrors.push({
							item: name || "unknown",
							error: "Nom ou prix manquant",
						});
						continue;
					}

					await Product.create({
						restaurantId: restaurant_id,
						name: name.trim(),
						description: description?.trim() || "",
						price: price,
						category: finalCategoryName,
						available: true,
						archived: false,
					});

					totalImported++;
				} catch (error) {
					console.error(`❌ Erreur import item ${item.name}:`, error);
					importErrors.push({
						item: item.name,
						error: error.message,
					});
				}
			}
		}

		console.log(`✅ ${totalImported} produits importés avec succès`);

		res.json({
			status: "success",
			message: "Menu importé avec succès",
			restaurant_id: restaurant_id,
			restaurant_name: restaurant.name,
			items_imported: totalImported,
			items_archived: archivedCount.modifiedCount,
			categories_created: newCategories.size,
			new_categories: [...newCategories],
			errors: importErrors.length > 0 ? importErrors : undefined,
		});
	} catch (error) {
		console.error("❌ Erreur import menu:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur lors de l'import",
			error: error.message,
		});
	}
});

/**
 * POST /developer/create-restaurant
 * Crée un nouveau restaurant avec un admin associé (réservé au développeur)
 * Body: { name, email, password, phone, address, turnoverTime }
 */
router.post("/create-restaurant", auth, checkDeveloper, async (req, res) => {
	try {
		const { name, email, password, phone, address, turnoverTime } = req.body;

		// Validation
		if (!name || !email || !password) {
			return res.status(400).json({
				status: "error",
				message: "name, email et password sont requis",
			});
		}

		// Vérifier si l'email existe déjà
		const existingRestaurant = await Restaurant.findOne({ email });
		if (existingRestaurant) {
			return res.status(409).json({
				status: "error",
				message: "Un restaurant avec cet email existe déjà",
			});
		}

		// Hash du mot de passe
		const bcrypt = require("bcrypt");
		const passwordHash = await bcrypt.hash(password, 10);

		// Créer le restaurant
		const restaurant = await Restaurant.create({
			name: name.trim(),
			email: email.trim().toLowerCase(),
			passwordHash,
			phone: phone?.trim() || "",
			address: address?.trim() || "",
			turnoverTime: turnoverTime || 120,
			active: true,
		});

		console.log(`✅ Restaurant créé: ${restaurant.name} (${restaurant._id})`);

		// Créer un admin pour ce restaurant
		const Admin = require("../models/Admin");

		const admin = await Admin.create({
			serverId: `ADMIN_${restaurant._id.toString().slice(-6).toUpperCase()}`,
			name: `Admin ${name}`,
			email: email,
			passwordHash: passwordHash, // Même mot de passe que le restaurant
			role: "admin",
			restaurantId: restaurant._id,
		});

		console.log(`✅ Admin créé: ${admin.name} (${admin._id})`);

		res.status(201).json({
			status: "success",
			message: "Restaurant et admin créés avec succès",
			restaurant: {
				_id: restaurant._id,
				name: restaurant.name,
				email: restaurant.email,
				phone: restaurant.phone,
				address: restaurant.address,
				turnoverTime: restaurant.turnoverTime,
				active: restaurant.active,
			},
			admin: {
				_id: admin._id,
				serverId: admin.serverId,
				name: admin.name,
				email: admin.email,
				role: admin.role,
			},
		});
	} catch (error) {
		console.error("❌ Erreur création restaurant:", error);

		// Gérer les erreurs de duplication MongoDB
		if (error.code === 11000) {
			const field = Object.keys(error.keyValue || {})[0];
			const value = error.keyValue?.[field];
			return res.status(409).json({
				status: "error",
				message: `Ce ${field} (${value}) est déjà utilisé par un autre restaurant`,
			});
		}

		// Gérer les erreurs de validation du modèle Admin
		if (error.status === 403) {
			return res.status(403).json({
				status: "error",
				message: error.message,
			});
		}

		res.status(500).json({
			status: "error",
			message: "Erreur serveur lors de la création",
			error: error.message,
		});
	}
});

/**
 * PATCH /developer/toggle-restaurant/:id
 * Active ou désactive un restaurant (réservé au développeur)
 */
router.patch(
	"/toggle-restaurant/:id",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { id } = req.params;

			const restaurant = await Restaurant.findById(id);
			if (!restaurant) {
				return res.status(404).json({
					status: "error",
					message: "Restaurant introuvable",
				});
			}

			// Toggle le statut
			restaurant.active = !restaurant.active;
			await restaurant.save();

			console.log(
				`🔄 Restaurant ${restaurant.name} ${
					restaurant.active ? "activé" : "désactivé"
				}`
			);

			res.json({
				status: "success",
				message: `Restaurant ${
					restaurant.active ? "activé" : "désactivé"
				} avec succès`,
				restaurant: {
					_id: restaurant._id,
					name: restaurant.name,
					active: restaurant.active,
				},
			});
		} catch (error) {
			console.error("❌ Erreur toggle restaurant:", error);
			res.status(500).json({
				status: "error",
				message: "Erreur serveur",
				error: error.message,
			});
		}
	}
);

module.exports = router;
