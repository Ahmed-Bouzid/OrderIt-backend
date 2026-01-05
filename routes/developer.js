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
			.select("_id name email phone address createdAt turnoverTime")
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

module.exports = router;
