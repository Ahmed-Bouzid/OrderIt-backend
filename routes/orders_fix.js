const validateObjectIds = require("../middlewares/validateObjectId");
const mongoose = require("mongoose");
const auth = require("../middlewares/auth");
const express = require("express");
const router = express.Router();
const checkRoles = require("../middlewares/checkRoles");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurant");
const orderValidationRules = require("../middlewares/orderValidationRules");
const Table = require("../models/Table");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { validationResult } = require("express-validator");

router.post(
	"/",
	auth, // middleware qui décode le JWT et met req.user
	async (req, res) => {
		console.log(
			"📥 POST /orders - Body reçu:",
			JSON.stringify(req.body, null, 2),
		);
		console.log("📥 POST /orders - User:", req.user);
		const { role, tableId: clientTableId } = req.user; // token limité pour client ou token serveur/admin
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			let {
				tableId,
				items,
				total,
				status,
				restaurantId,
				serverId,
				reservationId, // ⭐ AJOUTER
				clientId, // ⭐ AJOUTER
				clientName, // ⭐ AJOUTER
				clientPhone, // 📱 AJOUTER
			} = req.body;

			// 🌟 Si c'est un client, on lui impose la table du token
			if (role === "client") {
				tableId = clientTableId;
				serverId = null; // pas de serveur pour les commandes clients
				status = "in_progress"; // statut initial pour les clients
			} else if (!["server", "admin"].includes(role)) {
				return res.status(403).json({ message: "Rôle non autorisé" });
			}

			// Vérification items
			if (!items || !Array.isArray(items) || items.length === 0) {
				return res.status(400).json({ message: "Aucun produit sélectionné" });
			}

			// 🔍 Enrichir les items avec les données produit (catégorie)
			const enrichedItems = await Promise.all(
				items.map(async (item) => {
					if (item.productId) {
						const product = await Product.findById(item.productId).select(
							"category",
						);
						if (product && product.category) {
							// Convertir en minuscule pour correspondre à l'enum Order
							const category = product.category.toLowerCase();
							return { ...item, category };
						}
					}
					return item; // Si pas de productId ou produit introuvable, on garde l'item tel quel
				}),
			);

			console.log("🔍 Items enrichis avec catégories:", enrichedItems);

			// Vérification du total
			const calculatedTotal = enrichedItems.reduce(
				(sum, i) => sum + i.price * i.quantity,
				0,
			);
			if (total !== calculatedTotal) {
				return res
					.status(400)
					.json({ message: "Le total ne correspond pas aux articles" });
			}

			// Création de la commande
			const order = new Order({
				tableId,
				items: enrichedItems,
				total,
				status,
				restaurantId,
				serverId,
				reservationId, // ⭐ AJOUTÉ
				clientId, // ⭐ AJOUTÉ
				clientName, // ⭐ AJOUTÉ
				clientPhone, // 📱 AJOUTÉ
				origin: role === "client" ? "client" : "server",
			});

			await order.save();

			// 🔔 Réponse
			res.status(201).json(order);
		} catch (err) {
			console.error("Erreur création commande :", err); // log complet côté serveur
			res.status(500).json({
				message: err.message, // renvoie le vrai message d'erreur
				stack: err.stack, // optionnel : détail complet pour le dev
			});
		}
	},
);

// Suite du fichier orders.js...
module.exports = router;
