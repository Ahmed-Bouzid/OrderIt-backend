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
			JSON.stringify(req.body, null, 2)
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

			// Vérification du total
			const calculatedTotal = items.reduce(
				(sum, i) => sum + i.price * i.quantity,
				0
			);
			if (total !== calculatedTotal) {
				return res
					.status(400)
					.json({ message: "Le total ne correspond pas aux articles" });
			}

			// Création de la commande
			const order = new Order({
				tableId,
				items,
				total,
				status,
				restaurantId,
				serverId,
				reservationId, // ⭐ AJOUTÉ
				clientId, // ⭐ AJOUTÉ
				clientName, // ⭐ AJOUTÉ
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
	}
);

router.get(
	"/table/:tableId",
	auth,
	validateObjectIds(["tableId"]),
	async (req, res) => {
		try {
			let query = { tableId: req.params.tableId };

			// Si c'est un client, on limite à ses commandes seulement
			if (req.user.role === "client") {
				query.origin = "client";
				query.userId = req.user._id; // si tu as ajouté userId dans l'Order
			}

			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "name");

			res.json(orders);
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement des commandes." });
		}
	}
);

router.get(
	"/server/:serverId",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ serverId: req.params.serverId })
				.populate("tableId", "number")
				.populate("serverId", "name serverId");
			res.json(orders);
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement des commandes." });
		}
	}
);

// PUT /orders/:orderId - Modifier une commande
const validStatuses = ["pending", "in_progress", "completed", "cancelled"];

// PUT /orders/:id — mise à jour partielle d'une commande
router.put(
	"/:id",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const orderId = req.params.id;
			const updateFields = req.body;

			// Si on veut valider uniquement certains champs (ex: status, paid)
			const allowedUpdates = ["status", "paid", "tip"];
			const isValidUpdate = Object.keys(updateFields).every((field) =>
				allowedUpdates.includes(field)
			);
			if (!isValidUpdate) {
				return res.status(400).json({ message: "Mise à jour invalide." });
			}

			// Mise à jour de la commande
			const updatedOrder = await Order.findByIdAndUpdate(
				orderId,
				updateFields,
				{
					new: true,
					runValidators: true,
				}
			);

			if (!updatedOrder) {
				return res.status(404).json({ message: "Commande non trouvée." });
			}

			res.json({ message: "Commande mise à jour.", order: updatedOrder });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur lors de la mise à jour." });
		}
	}
);

// routes/orders.js
router.get("/active", auth, async (req, res) => {
	console.log("OKOKOKOKOKOK");

	try {
		console.log("📡 Route /active appelée");
		console.log("👤 User:", req.user);
		console.log("📨 Headers:", req.headers);

		const { role, tableId } = req.user;

		console.log(`🔍 Recherche pour: role=${role}, tableId=${tableId}`);

		let query = { paid: false };

		if (role === "client") {
			query.tableId = tableId;
			query.origin = "client";
		}

		console.log("🔍 Query MongoDB:", JSON.stringify(query));

		const activeOrders = await Order.find(query)
			.sort({ createdAt: -1 })
			.limit(10);

		console.log("✅ Nombre de commandes trouvées:", activeOrders.length);

		// Log détaillé de chaque commande
		activeOrders.forEach((order, i) => {
			console.log(
				`   ${i + 1}. ID: ${order._id}, paid: ${order.paid}, table: ${
					order.tableId
				}`
			);
		});

		res.json(activeOrders);
	} catch (error) {
		console.error("❌ Erreur /active:", error);
		console.error("❌ Stack:", error.stack);
		res.status(500).json({
			message: "Erreur serveur",
			error: error.message,
		});
	}
});

// routes/orders.js
router.post("/:id/mark-as-paid", async (req, res) => {
	try {
		const orderId = req.params.id;

		// Trouver la commande
		const order = await Order.findById(orderId);
		if (!order) {
			return res.status(404).json({ message: "Commande non trouvée." });
		}

		// Mettre à jour simplement
		order.paid = true;
		order.status = "completed";
		order.paidAt = new Date();

		await order.save();

		res.json({
			success: true,
			message: "Commande marquée comme payée",
			order,
		});
	} catch (err) {
		console.error("Erreur:", err);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

// DELETE /orders/:orderId - Supprimer une commande (optionnel)
router.delete(
	"/:orderId",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			await Order.findByIdAndDelete(req.params.orderId);
			res.json({ message: "Commande supprimée." });
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors de la suppression de la commande." });
		}
	}
);

module.exports = router;
