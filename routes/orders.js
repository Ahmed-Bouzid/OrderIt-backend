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

			// 🔍 Si reservationId fourni et pas de serverId, récupérer depuis la réservation
			if (reservationId && !serverId) {
				const Reservation = require("../models/Reservation");
				const reservation =
					await Reservation.findById(reservationId).select("serverId");
				if (reservation && reservation.serverId) {
					serverId = reservation.serverId;
					console.log("✅ ServerId récupéré depuis réservation:", serverId);
				}
			}

			// Vérification items
			if (!items || !Array.isArray(items) || items.length === 0) {
				return res.status(400).json({ message: "Aucun produit sélectionné" });
			}

			// 🔍 Enrichir les items avec les données produit (catégorie normalisée)
			const enrichedItems = await Promise.all(
				items.map(async (item) => {
					if (item.productId) {
						const product = await Product.findById(item.productId).select(
							"category",
						);
						if (product && product.category) {
							// Normaliser la catégorie pour éviter les erreurs de validation
							let category = product.category.toLowerCase().trim();

							// Mapper les variations communes vers des catégories standards
							const categoryMapping = {
								nouveautés: "nouveautes",
								"nouveautes tiramisu": "nouveautes",
								"nouveautés tiramisu": "nouveautes",
								entrée: "entree",
								entrées: "entree",
								boissons: "boisson",
								desserts: "dessert",
								plats: "plat",
								principal: "plat",
								main: "plat",
							};

							// Appliquer le mapping si trouvé
							if (categoryMapping[category]) {
								category = categoryMapping[category];
							}

							console.log(
								`🔄 Catégorie normalisée: ${product.category} → ${category}`,
							);
							return { ...item, category };
						}
					}
					// Si pas de productId ou produit introuvable, utiliser "autre" par défaut
					return {
						...item,
						category: item.category?.toLowerCase()?.trim() || "autre",
					};
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

			// ⭐ Émettre événement WebSocket pour notifier le frontend
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					order.restaurantId.toString(),
					"created",
					order.toObject(),
				);
				console.log(
					`📡 WebSocket: Nouvelle commande ${order._id} émise vers restaurant ${order.restaurantId}`,
				);
			}

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

// GET /api/orders - Récupérer les commandes avec filtres (restaurantId, status, origin)
router.get("/", auth, checkRoles(["server", "admin"]), async (req, res) => {
	try {
		const { restaurantId, status, origin } = req.query;
		console.log(`📦 [GET /orders] Paramètres reçus:`, { restaurantId, status, origin });
		
		const query = {};

		if (restaurantId) {
			query.restaurantId = restaurantId;
		}

		if (status) {
			// status peut être "confirmed,in_progress,ready"
			const statusArray = status.split(",");
			query.orderStatus = { $in: statusArray };
		}

		// ⭐ Nouveau filtre par origine (pour Express Orders)
		if (origin) {
			query.origin = origin;
			
			// ⭐ Pour Express Orders: afficher seulement les commandes non préparées
			// (uniquement pour origin="client", pas pour "server" ou "admin")
			// ⚠️ IMPORTANT: Inclure aussi les commandes qui n'ont pas encore le champ isMade
			if (origin === "client") {
				query.$or = [
					{ isMade: false },
					{ isMade: { $exists: false } }
				];
			}
		}

		console.log(`📦 [GET /orders] Query MongoDB:`, JSON.stringify(query));

		let orders = await Order.find(query)
			.populate("tableId", "number")
			.populate("serverId", "name serverId")
			.populate("restaurantId", "name")
			.populate("reservationId", "status") // ⭐ Populate pour info supplémentaire
			.sort({ createdAt: -1 }); // Du plus récent au plus ancien (pour Express Orders)

		console.log(`📦 [GET /orders] Commandes trouvées: ${orders.length}`);
		
		// Log des détails de chaque commande
		orders.forEach((order, index) => {
			const resaStatus = order.reservationId?.status || "AUCUNE RESA";
			const orderStatus = order.orderStatus;
			console.log(`   [${index + 1}] Order ${order._id} | orderStatus: ${orderStatus} | reservationStatus: ${resaStatus} | origin: ${order.origin}`);
		});

		console.log(`✅ [GET /orders] Envoi de ${orders.length} commandes au frontend`);
		res.json({ orders });
	} catch (err) {
		console.error("❌ [GET /orders] Erreur:", err);
		res
			.status(500)
			.json({ message: "Erreur lors du chargement des commandes." });
	}
});

// ⭐⭐ PATCH /api/orders/:id/mark-made - Marquer une commande comme préparée (foodtrucks)
router.patch(
	"/:id/mark-made",
	auth,
	checkRoles(["server", "admin"]),
	validateObjectIds(["id"]),
	async (req, res) => {
		try {
			const orderId = req.params.id;
			const { isMade } = req.body;

			if (typeof isMade !== "boolean") {
				return res.status(400).json({
					message: "isMade doit être un booléen",
				});
			}

			const order = await Order.findById(orderId);
			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			order.isMade = isMade;
			await order.save();

			console.log(`✅ [MARK MADE] Commande ${orderId} marquée isMade=${isMade}`);

			// ⚡ Émettre l'événement WebSocket
			const io = req.app.get("io");
			if (io) {
				io.to(`restaurant:${order.restaurantId}`).emit("order:updated", {
					orderId: order._id,
					isMade: order.isMade,
					orderStatus: order.orderStatus,
				});
			}

			res.json({
				success: true,
				order: {
					_id: order._id,
					isMade: order.isMade,
				},
			});
		} catch (err) {
			console.error("❌ [MARK MADE] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// ⭐⭐ PATCH /api/orders/bulk-mark-made - Marquer plusieurs commandes comme préparées (foodtrucks)
router.patch(
	"/bulk-mark-made",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { orderIds, isMade } = req.body;

			if (!Array.isArray(orderIds) || orderIds.length === 0) {
				return res.status(400).json({
					message: "orderIds doit être un tableau non vide",
				});
			}

			if (typeof isMade !== "boolean") {
				return res.status(400).json({
					message: "isMade doit être un booléen",
				});
			}

			// Valider tous les IDs
			const validIds = orderIds.every((id) => mongoose.Types.ObjectId.isValid(id));
			if (!validIds) {
				return res.status(400).json({
					message: "Un ou plusieurs IDs sont invalides",
				});
			}

			// Mettre à jour toutes les commandes
			const result = await Order.updateMany(
				{ _id: { $in: orderIds } },
				{ $set: { isMade } },
			);

			console.log(`✅ [BULK MARK MADE] ${result.modifiedCount} commandes marquées isMade=${isMade}`);

			// ⚡ Émettre l'événement WebSocket pour chaque commande
			const orders = await Order.find({ _id: { $in: orderIds } }).select("_id restaurantId isMade orderStatus");
			const io = req.app.get("io");
			if (io && orders.length > 0) {
				const restaurantId = orders[0].restaurantId;
				orders.forEach(order => {
					io.to(`restaurant:${restaurantId}`).emit("order:updated", {
						orderId: order._id,
						isMade: order.isMade,
						orderStatus: order.orderStatus,
					});
				});
			}

			res.json({
				success: true,
				modifiedCount: result.modifiedCount,
			});
		} catch (err) {
			console.error("❌ [BULK MARK MADE] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// ⭐ PATCH /api/orders/:id/urgency - Basculer l'urgence d'une commande (Express Orders)
router.patch(
	"/:id/urgency",
	auth,
	checkRoles(["server", "admin"]),
	validateObjectIds(["id"]),
	async (req, res) => {
		try {
			const { isUrgent } = req.body;
			const orderId = req.params.id;

			if (typeof isUrgent !== "boolean") {
				return res.status(400).json({
					message: "isUrgent doit être un booléen",
				});
			}

			const order = await Order.findById(orderId)
				.populate("tableId", "number")
				.populate("serverId", "name serverId")
				.populate("restaurantId", "name");

			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			// Mettre à jour l'urgence
			order.isUrgent = isUrgent;
			await order.save();

			// ⚡ Émettre via WebSocket
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					order.restaurantId.toString(),
					"statusUpdated",
					order.toObject(),
				);
				console.log(
					`📡 WebSocket: Urgence commande ${order._id} → ${isUrgent}`,
				);
			}

			res.json(order);
		} catch (err) {
			console.error("❌ Erreur PATCH urgency:", err);
			res.status(500).json({
				message: "Erreur lors de la mise à jour de l'urgence",
			});
		}
	},
);

// ⭐ PATCH /api/orders/:id/dismiss - Marquer une commande comme terminée (Express Orders)
router.patch(
	"/:id/dismiss",
	auth,
	checkRoles(["server", "admin"]),
	validateObjectIds(["id"]),
	async (req, res) => {
		try {
			const orderId = req.params.id;

			const order = await Order.findById(orderId);
			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			// ✅ Marquer comme terminée avec date de complétion
			order.orderStatus = "completed";
			order.completedAt = new Date();
			await order.save();

			console.log(
				`✅ Commande ${order._id} marquée comme terminée (dismissed)`,
			);

			// ⚡ Émettre via WebSocket pour masquer côté frontend
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(io, order.restaurantId.toString(), "dismissed", {
					_id: order._id,
				});
				console.log(
					`📡 WebSocket: Commande ${order._id} retirée de l'affichage`,
				);
			}

			res.json({
				message: "Commande marquée comme terminée",
				orderStatus: order.orderStatus,
			});
		} catch (err) {
			console.error("❌ Erreur PATCH dismiss:", err);
			res.status(500).json({
				message: "Erreur lors du masquage",
			});
		}
	},
);

router.get(
	"/table/:tableId",
	auth,
	validateObjectIds(["tableId"]),
	async (req, res) => {
		try {
			let query = {
				tableId: req.params.tableId,
				paid: { $ne: true }, // ⭐ EXCLURE les commandes déjà payées
			};

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
	},
);

// ⭐ NOUVELLE ROUTE : Récupérer les commandes d'une réservation spécifique
router.get(
	"/reservation/:reservationId",
	auth,
	validateObjectIds(["reservationId"]),
	async (req, res) => {
		try {
			console.log(
				"[DEBUG] GET /reservation/:reservationId",
				req.params.reservationId,
			);
			// Log user info
			if (req.user) {
				console.log("[DEBUG] User:", req.user);
			} else {
				console.log("[DEBUG] Pas de req.user");
			}
			// Log query
			const query = {
				reservationId: req.params.reservationId,
				paid: { $ne: true },
			};
			console.log("[DEBUG] Query utilisée:", query);
			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "firstName lastName");

			console.log(`[DEBUG] Nb commandes trouvées: ${orders.length}`);
			if (orders.length === 0) {
				console.log("[DEBUG] Aucune commande trouvée pour cette réservation.");
			} else {
				orders.forEach((order, idx) => {
					console.log(`[DEBUG] Order[${idx}]:`, {
						_id: order._id,
						tableId: order.tableId,
						reservationId: order.reservationId,
						status: order.status,
						paid: order.paid,
						items: order.items?.length,
					});
				});
			}
			res.json(orders);
		} catch (err) {
			console.error("❌ Erreur récupération commandes par réservation:", err);
			res
				.status(500)
				.json({ message: "Erreur lors du chargement des commandes." });
		}
	},
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
	},
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
				allowedUpdates.includes(field),
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
				},
			);

			if (!updatedOrder) {
				return res.status(404).json({ message: "Commande non trouvée." });
			}

			res.json({ message: "Commande mise à jour.", order: updatedOrder });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur lors de la mise à jour." });
		}
	},
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
				}`,
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

// PUT /orders/:orderId/items/:itemId/status - Mettre à jour le statut d'un item
router.put(
	"/:orderId/items/:itemId/status",
	auth,
	checkRoles(["server", "admin"]),
	validateObjectIds(["orderId"]),
	async (req, res) => {
		try {
			const { orderId, itemId } = req.params;
			const { status } = req.body;

			// Validation du statut
			const validStatuses = [
				"confirmed",
				"preparing",
				"ready",
				"served",
				"cancelled",
			];
			if (!status || !validStatuses.includes(status)) {
				return res.status(400).json({
					message: `Statut invalide. Valeurs acceptées: ${validStatuses.join(
						", ",
					)}`,
				});
			}

			// Trouver la commande
			const order = await Order.findById(orderId);
			if (!order) {
				return res.status(404).json({ message: "Commande non trouvée." });
			}

			// Trouver l'item dans la commande
			const item = order.items.id(itemId);
			if (!item) {
				return res
					.status(404)
					.json({ message: "Item non trouvé dans la commande." });
			}

			// Mettre à jour le statut et les timestamps
			const oldStatus = item.itemStatus;
			item.itemStatus = status;

			// Démarrer le timer si passage en préparation
			if (status === "preparing" && !item.startTime) {
				item.startTime = new Date();
				console.log(`⏱️  Timer démarré pour item ${itemId}: ${item.name}`);
			}

			// Arrêter le timer si passage en servi
			if (status === "served" && item.startTime && !item.endTime) {
				item.endTime = new Date();
				const duration = Math.floor((item.endTime - item.startTime) / 1000);
				console.log(`✅ Item ${itemId} servi après ${duration}s`);
			}

			// Sauvegarder la commande
			await order.save();

			console.log(`🔄 Item ${itemId} mis à jour: ${oldStatus} → ${status}`);

			res.json({
				success: true,
				message: "Statut de l'item mis à jour.",
				order,
				item: {
					_id: item._id,
					name: item.name,
					itemStatus: item.itemStatus,
					startTime: item.startTime,
					endTime: item.endTime,
				},
			});
		} catch (err) {
			console.error("❌ Erreur mise à jour statut item:", err);
			res.status(500).json({
				message: "Erreur lors de la mise à jour du statut de l'item.",
				error: err.message,
			});
		}
	},
);

// PUT /orders/reservation/:reservationId/finalize-items - Mettre à jour tous les items non finalisés
// Utilisé quand une réservation est fermée (payée) ou annulée
router.put(
	"/reservation/:reservationId/finalize-items",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { reservationId } = req.params;
			const { status } = req.body; // "served" ou "cancelled"

			if (!["served", "cancelled"].includes(status)) {
				return res.status(400).json({
					message: "Statut invalide. Doit être 'served' ou 'cancelled'.",
				});
			}

			// Trouver toutes les commandes de la réservation
			const orders = await Order.find({ reservationId });

			if (!orders.length) {
				return res.json({
					success: true,
					message: "Aucune commande trouvée pour cette réservation.",
					updatedCount: 0,
				});
			}

			let totalUpdated = 0;

			// Mettre à jour les items qui ne sont pas déjà "served" ou "cancelled"
			for (const order of orders) {
				let orderModified = false;

				for (const item of order.items) {
					if (item.itemStatus !== "served" && item.itemStatus !== "cancelled") {
						item.itemStatus = status;

						// Si passage en servi, arrêter le timer
						if (status === "served" && item.startTime && !item.endTime) {
							item.endTime = new Date();
						}

						orderModified = true;
						totalUpdated++;
					}
				}

				if (orderModified) {
					await order.save();
				}
			}

			console.log(
				`✅ [FINALIZE] ${totalUpdated} items mis à jour en "${status}" pour réservation ${reservationId}`,
			);

			res.json({
				success: true,
				message: `${totalUpdated} item(s) mis à jour en "${status}".`,
				updatedCount: totalUpdated,
			});
		} catch (err) {
			console.error("❌ Erreur finalize-items:", err);
			res.status(500).json({
				message: "Erreur lors de la mise à jour des items.",
				error: err.message,
			});
		}
	},
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
	},
);

module.exports = router;
