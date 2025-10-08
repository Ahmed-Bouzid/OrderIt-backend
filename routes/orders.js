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
	auth,
	checkRoles(["server", "admin", "server"]),
	checkUserRestaurantBody("restaurantId"),
	orderValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { items } = req.body;

			// Afficher chaque item dans la console

			const order = new Order(req.body);
			await order.save();
			res.status(201).json(order);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

router.get(
	"/table/:tableId",
	auth,
	validateObjectIds(["tableId"]),
	checkRoles(["server", "admin", "server"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ tableId: req.params.tableId })
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
