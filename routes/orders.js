const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Table = require("../models/Table");
const Product = require("../models/Product");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");

const checkRoles = require("../middlewares/checkRoles");
const mongoose = require("mongoose");

const auth = require("../middlewares/auth");

// POST /orders — Création d'une commande (serveur ou admin)
router.post(
	"/",
	auth,
	checkRoles(["serveur", "admin"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const { tableId, items, total, status, restaurantId } = req.body;

			if (!tableId) {
				return res.status(400).json({ message: "tableId est requis." });
			}
			if (!items || items.length === 0) {
				return res.status(400).json({ message: "Produit(s) requis." });
			}
			if (typeof total !== "number" || total <= 0) {
				return res
					.status(400)
					.json({ message: "total doit être un nombre positif." });
			}

			const table = await Table.findOne({
				_id: new mongoose.Types.ObjectId(tableId),
				restaurantId: new mongoose.Types.ObjectId(restaurantId),
			});

			if (!table) {
				return res
					.status(400)
					.json({ message: "Table invalide ou non trouvée." });
			}

			let computedTotal = 0;
			for (const item of items) {
				if (
					!item.productId ||
					typeof item.quantity !== "number" ||
					item.quantity <= 0
				) {
					return res.status(400).json({
						message:
							"Chaque produit doit avoir un productId valide et une quantité positive.",
					});
				}

				const product = await Product.findOne({
					_id: new mongoose.Types.ObjectId(item.productId),
					restaurantId: new mongoose.Types.ObjectId(restaurantId),
				});

				if (!product) {
					return res.status(400).json({
						message: `Produit invalide : ${item.productId}`,
					});
				}

				computedTotal += product.price * item.quantity;
			}

			if (Math.abs(computedTotal - total) > 0.01) {
				return res.status(400).json({
					message: `Total incorrect. Montant attendu : ${computedTotal.toFixed(
						2
					)}.`,
				});
			}

			const validStatuses = [
				"pending",
				"in_progress",
				"completed",
				"cancelled",
			];
			let orderStatus = "in_progress";
			if (status && validStatuses.includes(status)) {
				orderStatus = status;
			} else if (status) {
				return res.status(400).json({
					message: `Status invalide. Valeurs autorisées : ${validStatuses.join(
						", "
					)}`,
				});
			}
			console.log("Requête reçue:", req.body);

			const newOrder = new Order({
				tableId,
				items,
				total,
				status: orderStatus,
				restaurantId,
				serverId: req.user.id,
			});

			await newOrder.save();

			res.status(201).json({
				message: "Commande créée avec succès.",
				order: newOrder,
			});
		} catch (err) {
			console.error("💥 Erreur serveur:", err);
			res.status(500).json({ message: "Erreur serveur." });
		}
	}
);

// GET /orders/:restaurantId - Liste commandes d’un restaurant
router.get(
	"/:restaurantId",
	auth,
	validateObjectIds(["orderId"]),
	checkUserRestaurant("restaurantId"),
	checkRoles(["serveur", "admin"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ restaurantId: req.params.restaurantId })
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

// GET /orders/details/:orderId - Détail d’une commande
router.get(
	"/details/:orderId",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["serveur", "admin"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.orderId)
				.populate("tableId", "number")
				.populate("serverId", "name serverId");
			if (!order)
				return res.status(404).json({ message: "Commande non trouvée." });
			res.json(order);
		} catch (err) {
			console.error(err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement de la commande." });
		}
	}
);

router.get(
	"/table/:tableId",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["serveur", "admin"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ tableId: req.params.tableId })
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

router.get(
	"/server/:serverId",
	auth,
	validateObjectIds(["orderId"]),
	checkRoles(["serveur", "admin"]),
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
	checkRoles(["serveur", "admin"]),
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
