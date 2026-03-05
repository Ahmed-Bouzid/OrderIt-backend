const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkDeveloper = require("../middlewares/checkDeveloper");
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");
const Reservation = require("../models/Reservation");
const Product = require("../models/Product");
const Server = require("../models/Server");
const Style = require("../models/Style");

/**
 * GET /developer/restaurants
 * Liste tous les restaurants du système (réservé au développeur)
 */
router.get("/restaurants", auth, checkDeveloper, async (req, res) => {
	try {
		const restaurants = await Restaurant.find()
			.select(
				"_id name email phone address createdAt turnoverTime active subscriptionPlan styleKey category featureOverrides",
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
			}),
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
			`📸 Import menu pour ${restaurant.name} (${restaurant_id}) - ${menu.length} catégories`,
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
			`📂 ${existingCategories.length} catégories existantes, ${newCategories.size} nouvelles`,
		);
		if (newCategories.size > 0) {
			console.log("🆕 Nouvelles catégories:", [...newCategories].join(", "));
		}

		// Archiver l'ancien menu (soft delete)
		const archivedCount = await Product.updateMany(
			{ restaurantId: restaurant_id },
			{ $set: { archived: true, available: false } },
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
					const { name, price, description, options } = item;

					if (!name || typeof price !== "number") {
						importErrors.push({
							item: name || "unknown",
							error: "Nom ou prix manquant",
						});
						continue;
					}

					// Transformer options si présentes
					let processedOptions = [];
					if (Array.isArray(options) && options.length > 0) {
						processedOptions = options.map((option, idx) => ({
							id: option.id || `opt-${idx}`,
							name: option.name || "",
							description: option.description || "",
							required: option.required ?? true, // Les options du menu sont obligatoires par défaut
							multiSelect: option.multiSelect ?? false,
							available: option.available ?? true,
							choices: Array.isArray(option.choices)
								? option.choices.map((choice, cidx) => ({
										id: choice.id || `choice-${cidx}`,
										name: choice.name || "",
										description: choice.description || "",
										priceAdjustment:
											choice.priceAdjustment || choice.price || 0,
										available: choice.available ?? true,
									}))
								: [],
						}));
					}

					await Product.create({
						restaurantId: restaurant_id,
						name: name.trim(),
						description: description?.trim() || "",
						price: price,
						category: finalCategoryName,
						available: true,
						archived: false,
						options: processedOptions,
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
		const passwordHash = await bcrypt.hash(password, 12);

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
				}`,
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
	},
);

/**
 * DELETE /developer/restaurants/:id/tables
 * Supprime toutes les tables d'un restaurant
 */
router.delete(
	"/restaurants/:id/tables",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { id } = req.params;

			const restaurant = await Restaurant.findById(id);
			if (!restaurant) {
				return res.status(404).json({
					status: "error",
					message: "Restaurant non trouvé",
				});
			}

			const result = await Table.deleteMany({ restaurantId: id });

			console.log(
				`🗑️ Developer: Suppression de ${result.deletedCount} tables du restaurant ${restaurant.name}`,
			);

			res.json({
				status: "success",
				message: `${result.deletedCount} table(s) supprimée(s)`,
				deletedCount: result.deletedCount,
				restaurant: restaurant.name,
			});
		} catch (error) {
			console.error("❌ Erreur suppression tables:", error);
			res.status(500).json({
				status: "error",
				message: "Erreur serveur",
				error: error.message,
			});
		}
	},
);

/**
 * DELETE /developer/restaurants/:id/employees
 * Supprime tous les employés (serveurs) d'un restaurant
 */
router.delete(
	"/restaurants/:id/employees",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { id } = req.params;

			const restaurant = await Restaurant.findById(id);
			if (!restaurant) {
				return res.status(404).json({
					status: "error",
					message: "Restaurant non trouvé",
				});
			}

			const result = await Server.deleteMany({ restaurantId: id });

			console.log(
				`🗑️ Developer: Suppression de ${result.deletedCount} employés du restaurant ${restaurant.name}`,
			);

			res.json({
				status: "success",
				message: `${result.deletedCount} employé(s) supprimé(s)`,
				deletedCount: result.deletedCount,
				restaurant: restaurant.name,
			});
		} catch (error) {
			console.error("❌ Erreur suppression employés:", error);
			res.status(500).json({
				status: "error",
				message: "Erreur serveur",
				error: error.message,
			});
		}
	},
);

/**
 * DELETE /developer/restaurants/:id/products
 * Supprime tous les produits d'un restaurant
 */
router.delete(
	"/restaurants/:id/products",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { id } = req.params;

			const restaurant = await Restaurant.findById(id);
			if (!restaurant) {
				return res.status(404).json({
					status: "error",
					message: "Restaurant non trouvé",
				});
			}

			const result = await Product.deleteMany({ restaurantId: id });

			console.log(
				`🗑️ Developer: Suppression de ${result.deletedCount} produits du restaurant ${restaurant.name}`,
			);

			res.json({
				status: "success",
				message: `${result.deletedCount} produit(s) supprimé(s)`,
				deletedCount: result.deletedCount,
				restaurant: restaurant.name,
			});
		} catch (error) {
			console.error("❌ Erreur suppression produits:", error);
			res.status(500).json({
				status: "error",
				message: "Erreur serveur",
				error: error.message,
			});
		}
	},
);

/**
 * DELETE /developer/restaurants/:id
 * Supprime complètement un restaurant et toutes ses données associées
 */
router.delete("/restaurants/:id", auth, checkDeveloper, async (req, res) => {
	try {
		const { id } = req.params;

		const restaurant = await Restaurant.findById(id);
		if (!restaurant) {
			return res.status(404).json({
				status: "error",
				message: "Restaurant non trouvé",
			});
		}

		const restaurantName = restaurant.name;

		// Supprimer toutes les données associées en parallèle
		const [tables, servers, products, reservations] = await Promise.all([
			Table.deleteMany({ restaurantId: id }),
			Server.deleteMany({ restaurantId: id }),
			Product.deleteMany({ restaurantId: id }),
			Reservation.deleteMany({ restaurantId: id }),
		]);

		// Supprimer le restaurant lui-même
		await Restaurant.findByIdAndDelete(id);

		console.log(`🗑️ Developer: Restaurant ${restaurantName} complètement supprimé
  - ${tables.deletedCount} tables
  - ${servers.deletedCount} employés
  - ${products.deletedCount} produits
  - ${reservations.deletedCount} réservations`);

		res.json({
			status: "success",
			message: `Restaurant ${restaurantName} supprimé avec succès`,
			deleted: {
				restaurant: restaurantName,
				tables: tables.deletedCount,
				employees: servers.deletedCount,
				products: products.deletedCount,
				reservations: reservations.deletedCount,
			},
		});
	} catch (error) {
		console.error("❌ Erreur suppression restaurant:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

// ════════════════════════════════════════════════════════════════════════════════
// 🎨 GESTION DES STYLES (Solution 1 - Configuration JSON dynamique)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /developer/styles
 * Liste tous les styles disponibles (réservé au développeur)
 */
router.get("/styles", auth, checkDeveloper, async (req, res) => {
	try {
		const styles = await Style.findActive();

		res.json({
			status: "success",
			count: styles.length,
			styles: styles.map((style) => ({
				id: style._id,
				name: style.name,
				key: style.key,
				description: style.description,
				suitableFor: style.suitableFor,
				config: style.config,
				isSystem: style.isSystem,
				active: style.active,
				createdAt: style.createdAt,
				updatedAt: style.updatedAt,
			})),
		});
	} catch (error) {
		console.error("❌ Erreur GET /developer/styles:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

/**
 * GET /developer/styles/:key
 * Récupère un style spécifique par sa clé
 */
router.get("/styles/:key", auth, checkDeveloper, async (req, res) => {
	try {
		const { key } = req.params;
		const style = await Style.findByKey(key);

		if (!style) {
			return res.status(404).json({
				status: "error",
				message: `Style '${key}' introuvable`,
			});
		}

		res.json({
			status: "success",
			style: {
				id: style._id,
				name: style.name,
				key: style.key,
				description: style.description,
				suitableFor: style.suitableFor,
				config: style.config,
				isSystem: style.isSystem,
				active: style.active,
				createdAt: style.createdAt,
				updatedAt: style.updatedAt,
			},
		});
	} catch (error) {
		console.error("❌ Erreur GET /developer/styles/:key:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

/**
 * POST /developer/styles
 * Crée un nouveau style personnalisé (réservé au développeur)
 * Body: { name, key, description, config, suitableFor }
 */
router.post("/styles", auth, checkDeveloper, async (req, res) => {
	try {
		const { name, key, description, config, suitableFor } = req.body;

		// Validation
		if (!name || !key || !description || !config) {
			return res.status(400).json({
				status: "error",
				message: "name, key, description et config sont requis",
			});
		}

		// Vérifier si la clé existe déjà
		const existingStyle = await Style.findOne({
			key: key.toLowerCase().trim(),
		});
		if (existingStyle) {
			return res.status(409).json({
				status: "error",
				message: `Un style avec la clé '${key}' existe déjà`,
			});
		}

		// Créer le style
		const style = await Style.create({
			name: name.trim(),
			key: key.toLowerCase().trim(),
			description: description.trim(),
			config: config,
			suitableFor: suitableFor || [],
			isSystem: false, // Style personnalisé
			active: true,
		});

		console.log(`✨ Style créé: ${style.name} (${style.key})`);

		res.status(201).json({
			status: "success",
			message: "Style créé avec succès",
			style: {
				id: style._id,
				name: style.name,
				key: style.key,
				description: style.description,
				suitableFor: style.suitableFor,
				config: style.config,
				isSystem: style.isSystem,
			},
		});
	} catch (error) {
		console.error("❌ Erreur POST /developer/styles:", error);

		// Gérer les erreurs de duplication MongoDB
		if (error.code === 11000) {
			return res.status(409).json({
				status: "error",
				message: "Un style avec cette clé existe déjà",
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
 * PUT /developer/styles/:key
 * Met à jour un style existant (réservé au développeur)
 * Les styles système (isSystem: true) ne peuvent pas être modifiés
 */
router.put("/styles/:key", auth, checkDeveloper, async (req, res) => {
	try {
		const { key } = req.params;
		const { name, description, config, suitableFor, active } = req.body;

		const style = await Style.findOne({ key: key.toLowerCase() });

		if (!style) {
			return res.status(404).json({
				status: "error",
				message: `Style '${key}' introuvable`,
			});
		}

		// Interdire la modification des styles système
		if (style.isSystem) {
			return res.status(403).json({
				status: "error",
				message:
					"Les styles système ne peuvent pas être modifiés. Créez un nouveau style personnalisé.",
			});
		}

		// Mettre à jour les champs fournis
		if (name) style.name = name.trim();
		if (description) style.description = description.trim();
		if (config) style.config = config;
		if (suitableFor !== undefined) style.suitableFor = suitableFor;
		if (active !== undefined) style.active = active;

		await style.save();

		console.log(`🔄 Style mis à jour: ${style.name} (${style.key})`);

		res.json({
			status: "success",
			message: "Style mis à jour avec succès",
			style: {
				id: style._id,
				name: style.name,
				key: style.key,
				description: style.description,
				suitableFor: style.suitableFor,
				config: style.config,
				isSystem: style.isSystem,
				active: style.active,
			},
		});
	} catch (error) {
		console.error("❌ Erreur PUT /developer/styles/:key:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

/**
 * DELETE /developer/styles/:key
 * Supprime un style personnalisé (réservé au développeur)
 * Les styles système ne peuvent pas être supprimés
 */
router.delete("/styles/:key", auth, checkDeveloper, async (req, res) => {
	try {
		const { key } = req.params;

		const style = await Style.findOne({ key: key.toLowerCase() });

		if (!style) {
			return res.status(404).json({
				status: "error",
				message: `Style '${key}' introuvable`,
			});
		}

		// Interdire la suppression des styles système
		if (style.isSystem) {
			return res.status(403).json({
				status: "error",
				message: "Les styles système ne peuvent pas être supprimés",
			});
		}

		// Vérifier si des restaurants utilisent ce style
		const restaurantsUsingStyle = await Restaurant.countDocuments({
			styleKey: key,
		});

		if (restaurantsUsingStyle > 0) {
			return res.status(409).json({
				status: "error",
				message: `${restaurantsUsingStyle} restaurant(s) utilisent encore ce style. Changez leur style avant de le supprimer.`,
				restaurantsCount: restaurantsUsingStyle,
			});
		}

		await Style.findByIdAndDelete(style._id);

		console.log(`🗑️ Style supprimé: ${style.name} (${style.key})`);

		res.json({
			status: "success",
			message: `Style '${style.name}' supprimé avec succès`,
		});
	} catch (error) {
		console.error("❌ Erreur DELETE /developer/styles/:key:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

/**
 * POST /developer/apply-style
 * Applique un style à un restaurant (réservé au développeur)
 * Body: { restaurant_id, style_key }
 */
router.post("/apply-style", auth, checkDeveloper, async (req, res) => {
	try {
		const { restaurant_id, style_key } = req.body;

		// Validation
		if (!restaurant_id || !style_key) {
			return res.status(400).json({
				status: "error",
				message: "restaurant_id et style_key sont requis",
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

		// Vérifier que le style existe
		const style = await Style.findByKey(style_key);
		if (!style) {
			return res.status(404).json({
				status: "error",
				message: `Style '${style_key}' introuvable`,
			});
		}

		// Appliquer le style au restaurant
		restaurant.styleKey = style.key;
		await restaurant.save();

		console.log(
			`🎨 Style '${style.name}' appliqué au restaurant ${restaurant.name}`,
		);

		// ⭐ NOUVEAU : Émettre un événement WebSocket pour notifier tous les clients connectés
		const { emitStyleAppliedEvent } = require("../utils/socketEmitter");
		const io = req.app.locals.io;
		if (io) {
			emitStyleAppliedEvent(
				io,
				restaurant._id.toString(),
				style.key,
				style.config,
				req.user.id, // ID du développeur qui a appliqué le style
			);
		} else {
			console.warn("⚠️ Instance Socket.io non disponible, événement non émis");
		}

		res.json({
			status: "success",
			message: `Style '${style.name}' appliqué au restaurant '${restaurant.name}'`,
			restaurant: {
				id: restaurant._id,
				name: restaurant.name,
				styleKey: restaurant.styleKey,
			},
			style: {
				id: style._id,
				name: style.name,
				key: style.key,
				description: style.description,
			},
		});
	} catch (error) {
		console.error("❌ Erreur POST /developer/apply-style:", error);
		res.status(500).json({
			status: "error",
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

/**
 * GET /developer/restaurants/:id/feature-overrides
 * Récupère les overrides de fonctionnalités d'un restaurant
 */
router.get(
	"/restaurants/:id/feature-overrides",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const restaurant = await Restaurant.findById(req.params.id).select(
				"featureOverrides category name",
			);
			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}
			// Convertit la Map Mongoose en objet JS plain
			const overrides = Object.fromEntries(
				restaurant.featureOverrides || new Map(),
			);
			res.json({
				status: "success",
				restaurantId: restaurant._id,
				name: restaurant.name,
				category: restaurant.category,
				featureOverrides: overrides,
			});
		} catch (error) {
			console.error("❌ Erreur GET feature-overrides:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

/**
 * PUT /developer/restaurants/:id/category
 * Met à jour la catégorie (format) d'un restaurant.
 * Body: { category: "restaurant" | "foodtruck" | "fast-food" | "cafe" | "boulangerie" | "bar" }
 */
router.put(
	"/restaurants/:id/category",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { category } = req.body;
			const validCategories = [
				"restaurant",
				"foodtruck",
				"fast-food",
				"cafe",
				"boulangerie",
				"bar",
			];
			if (!category || !validCategories.includes(category)) {
				return res.status(400).json({
					message: `Catégorie invalide. Valeurs acceptées : ${validCategories.join(", ")}`,
				});
			}

			const restaurant = await Restaurant.findByIdAndUpdate(
				req.params.id,
				{ category },
				{ new: true },
			);
			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}

			console.log(
				`✅ [DEVELOPER] Catégorie mise à jour pour ${restaurant.name}: ${category}`,
			);

			res.json({
				status: "success",
				restaurantId: restaurant._id,
				name: restaurant.name,
				category: restaurant.category,
			});
		} catch (error) {
			console.error("❌ Erreur PUT category:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

/**
 * PUT /developer/restaurants/:id/feature-overrides
 * Met à jour les overrides de fonctionnalités d'un restaurant.
 * Body: { overrides: { [featureKey]: boolean } }
 * Ex : { overrides: { "chat_client": false, "gestion_stocks": true } }
 */
router.put(
	"/restaurants/:id/feature-overrides",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { overrides } = req.body;
			if (!overrides || typeof overrides !== "object") {
				return res
					.status(400)
					.json({ message: "Le champ `overrides` (objet) est requis" });
			}

			const restaurant = await Restaurant.findById(req.params.id);
			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}

			// Réinitialiser et reconstruire la Map
			restaurant.featureOverrides = new Map(Object.entries(overrides));
			await restaurant.save();

			console.log(
				`✅ [DEVELOPER] featureOverrides mis à jour pour ${restaurant.name}:`,
				overrides,
			);

			res.json({
				status: "success",
				restaurantId: restaurant._id,
				name: restaurant.name,
				category: restaurant.category,
				featureOverrides: overrides,
			});
		} catch (error) {
			console.error("❌ Erreur PUT feature-overrides:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
