const validateObjectIds = require("../middlewares/validateObjectId");
const mongoose = require("mongoose");
const auth = require("../middlewares/auth");
const { requireClientDeviceBinding } = require("../middlewares/auth");
const express = require("express");
const router = express.Router();
const checkRoles = require("../middlewares/checkRoles");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurant");
const orderValidationRules = require("../middlewares/orderValidationRules");
const Table = require("../models/Table");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
const {
	cancelOpenStripePaymentsForOrder,
} = require("../utils/cancelOpenStripePayments");
const { validationResult } = require("express-validator");
const { getAuditUser, addAudit } = require("../utils/auditHelper");

router.post(
	"/",
	auth, // middleware qui décode le JWT et met req.user
	requireClientDeviceBinding,
	async (req, res) => {
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
				source = "server", // 🏪 Mode source (server|counter)
				tableSessionId, // 🏪 Session table counter (optionnel)
			} = req.body;

			// 🌟 Si c'est un client, on lui impose les champs du token (source de vérité)
			if (role === "client") {
				tableId = clientTableId;
				restaurantId = req.user.restaurantId; // ⭐ override body — un client ne peut pas forger son restaurant
				clientId = req.user.clientId;          // ⭐ override body — un client ne peut pas forger son identité
				serverId = null;
				status = "in_progress";

				// ⭐ Valider que reservationId appartient bien au restaurant/table du token
				if (reservationId) {
					const reservationCheck = await Reservation.findById(reservationId).select("restaurantId tableId");
					if (!reservationCheck) {
						return res.status(404).json({ message: "Réservation introuvable" });
					}
					if (reservationCheck.restaurantId && reservationCheck.restaurantId.toString() !== req.user.restaurantId.toString()) {
						console.warn(`[SECURITY] orders POST: reservationId hors restaurant (user=${req.user.clientId})`);
						return res.status(403).json({ message: "Réservation non autorisée" });
					}
					if (req.user.tableId && reservationCheck.tableId && reservationCheck.tableId.toString() !== req.user.tableId.toString()) {
						console.warn(`[SECURITY] orders POST: reservationId hors table (user=${req.user.clientId})`);
						return res.status(403).json({ message: "Réservation non autorisée pour cette table" });
					}
				}
			} else if (!["server", "admin"].includes(role)) {
				return res.status(403).json({ message: "Rôle non autorisé" });
			}

			// 🔍 Si reservationId fourni et pas de serverId, récupérer depuis la réservation
			if (reservationId && !serverId) {
				const reservation =
					await Reservation.findById(reservationId).select("serverId");
				if (reservation && reservation.serverId) {
					serverId = reservation.serverId;
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

			// Vérification du total (floating-point safe : tolérance 1 centime)
			const calculatedTotal = enrichedItems.reduce(
				(sum, i) => sum + i.price * i.quantity,
				0,
			);
			if (Math.abs((total ?? 0) - calculatedTotal) > 0.01) {
				return res
					.status(400)
					.json({
						message: `Total invalide : reçu ${total}, calculé ${calculatedTotal.toFixed(2)}`,
					});
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
				source, // 🏪 Mode source (server|counter)
				tableSessionId, // 🏪 Session table counter (optionnel)
			});

			await order.save();

			// 🔍 Log de diagnostic pour le mode comptoir
			if (source === "counter") {
			console.log(`[Orders POST] Counter order created: orderId=${order._id} tableSessionId=${tableSessionId || 'MISSING'} table=${tableId} total=${total.toFixed(2)}€ serverId=${serverId || 'MISSING'}`);
			const cancelResult = await cancelOpenStripePaymentsForOrder(
				order._id,
				"order_mark_as_paid",
			);
			if (cancelResult.errors.length > 0) {
				console.warn("⚠️ [MARK_AS_PAID] Annulation intents incomplète", {
					orderId: order._id.toString(),
					errors: cancelResult.errors,
				});
			}

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
		const { restaurantId, status, origin, tableSessionId, tableId, source, since } = req.query;

		const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id) && String(id).length === 24;

		const query = {};

		if (tableSessionId) {
			if (!isValidObjectId(tableSessionId)) {
				return res.status(400).json({ message: "tableSessionId invalide" });
			}
			query.tableSessionId = tableSessionId;
		}

		if (restaurantId) {
			if (!isValidObjectId(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide" });
			}
			query.restaurantId = restaurantId;
		}

		if (tableId) {
			if (!isValidObjectId(tableId)) {
				return res.status(400).json({ message: "tableId invalide" });
			}
			query.tableId = tableId;
		}

		console.log("[GET /orders] query:", JSON.stringify(query));

		// 🔍 Log spécial pour debugging comptoir
		if (tableSessionId) {
			console.log(`[GET /orders] 🔍 DEBUG COMPTOIR: Recherche orders pour session=${tableSessionId}`);
			// Compter tous les orders de cette table (sans filtre sessionId) pour comparer
			const allTableOrders = await Order.find({ 
				tableId: query.tableId,
				source: "counter"
			}).select('_id tableSessionId totalAmount orderStatus createdAt').lean();
			console.log(`[GET /orders] 🔍 TOTAL orders table ${query.tableId} source=counter: ${allTableOrders.length}`);
			allTableOrders.forEach((o, i) => {
				console.log(`  ${i+1}. ${o._id} session=${o.tableSessionId || 'MISSING'} total=${o.totalAmount}€ status=${o.orderStatus} created=${new Date(o.createdAt).toLocaleString('fr-FR')}`);
			});
		}

		if (source) {
			query.source = source;
		}

		if (since) {
			const sinceDate = new Date(since);
			if (!isNaN(sinceDate.getTime())) {
				query.createdAt = { $gte: sinceDate };
			}
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
				query.$or = [{ isMade: false }, { isMade: { $exists: false } }];
			}
		}

		let orders = await Order.find(query)
			.populate("tableId", "number")
			.populate("serverId", "name serverId")
			.populate("restaurantId", "name")
			.populate("reservationId", "status") // ⭐ Populate pour info supplémentaire
			.sort({ createdAt: -1 }); // Du plus récent au plus ancien (pour Express Orders)

		// Log des détails de chaque commande
		orders.forEach((order, index) => {
			const resaStatus = order.reservationId?.status || "AUCUNE RESA";
			const orderStatus = order.orderStatus;
			// 🔍 Log serverId pour mode counter
			if (order.source === "counter") {
				console.log(`[GET /orders] Counter order: id=${order._id} serverId=${order.serverId?._id || 'NULL'} serverName=${order.serverId?.name || 'NULL'}`);
			}
		});

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
			const validIds = orderIds.every((id) =>
				mongoose.Types.ObjectId.isValid(id),
			);
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

			// ⚡ Émettre l'événement WebSocket pour chaque commande
			const orders = await Order.find({ _id: { $in: orderIds } }).select(
				"_id restaurantId isMade orderStatus",
			);
			const io = req.app.get("io");
			if (io && orders.length > 0) {
				const restaurantId = orders[0].restaurantId;
				orders.forEach((order) => {
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

			// ⚡ Émettre via WebSocket pour masquer côté frontend
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(io, order.restaurantId.toString(), "dismissed", {
					_id: order._id,
				});
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
				query.userId = req.user.id; // ✅ auth middleware définit req.user.id, pas _id
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
			const query = {
				reservationId: req.params.reservationId,
				paid: { $ne: true },
				orderStatus: { $ne: "cancelled" },
			};
			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "firstName lastName");

			if (orders.length === 0) {
			} else {
				orders.forEach((order, idx) => {});
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

			const io = req.app.locals.io;
			if (io && updatedOrder.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					updatedOrder.restaurantId.toString(),
					"updated",
					updatedOrder.toObject(),
				);
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
	try {
		const { role, tableId } = req.user;

		let query = { paid: false };

		if (role === "client") {
			query.tableId = tableId;
			query.origin = "client";
		}

		const activeOrders = await Order.find(query)
			.sort({ createdAt: -1 })
			.limit(10);

		// Log détaillé de chaque commande
		activeOrders.forEach((order, i) => {});

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
router.post(
	"/:id/mark-as-paid",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const orderId = req.params.id;

			// Trouver la commande
			const order = await Order.findById(orderId);
			if (!order) {
				return res.status(404).json({ message: "Commande non trouvée." });
			}

			// Mettre à jour simplement
			order.paid = true;
			order.orderStatus = "completed";
			order.paymentStatus = "paid";
			order.paidAt = new Date();

			await order.save();

			const cancelResult = await cancelOpenStripePaymentsForOrder(
				order._id,
				"order_mark_as_paid",
			);
			if (cancelResult.errors.length > 0) {
				console.warn("⚠️ [MARK_AS_PAID] Annulation intents incomplète", {
					orderId: order._id.toString(),
					errors: cancelResult.errors,
				});
			}

			// ⚡ Émettre WebSocket pour notifier le frontend
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					order.restaurantId.toString(),
					"updated",
					order.toObject(),
				);
			}

			res.json({
				success: true,
				message: "Commande marquée comme payée",
				canceledStripeIntents: cancelResult.canceled,
				order,
			});
		} catch (err) {
			console.error("Erreur:", err);
			res.status(500).json({
				success: false,
				message: "Erreur serveur",
			});
		}
	},
);

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
			}

			// Arrêter le timer si passage en servi
			if (status === "served" && item.startTime && !item.endTime) {
				item.endTime = new Date();
				const duration = Math.floor((item.endTime - item.startTime) / 1000);
			}

			// Sauvegarder la commande
			await order.save();

			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(io, order.restaurantId.toString(), "updated", {
					...order.toObject(),
					updatedItem: {
						_id: item._id,
						itemStatus: item.itemStatus,
					},
				});
			}

			// 📝 Audit : enregistrer le changement de statut dans la réservation
			if (order.reservationId && (status === "served" || status === "cancelled")) {
				try {
					const reservation = await Reservation.findById(order.reservationId);
					if (reservation) {
						const auditUser = await getAuditUser(req);
						const statusLabel = status === "served" ? "Servi" : "Annulé";
						await addAudit(reservation, "dish_status_changed", auditUser, {
							oldValue: oldStatus,
							dishStatus: statusLabel,
							newValue: `${item.name} → ${statusLabel}`,
						});
						await reservation.save();
					}
				} catch (auditErr) {
					console.error("⚠️ Erreur audit dish_status_changed:", auditErr.message);
				}
			}

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

// BLOC3/C2 — PATCH /orders/:id/cancel - Annuler une commande (serveur/admin)
router.patch(
	"/:id/cancel",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.id);
			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			// Vérifier scope restaurant
			if (
				req.user.restaurantId &&
				order.restaurantId &&
				order.restaurantId.toString() !== req.user.restaurantId.toString()
			) {
				return res.status(403).json({ message: "Commande hors de votre restaurant" });
			}

			if (order.orderStatus === "cancelled") {
				return res.status(400).json({ message: "Commande déjà annulée" });
			}
			if (order.paid || order.paymentStatus === "paid") {
				return res.status(400).json({ message: "Commande déjà payée, annulation impossible" });
			}

			order.orderStatus = "cancelled";
			order.cancelledAt = new Date();
			await order.save();

			// Émettre WebSocket
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(io, order.restaurantId.toString(), "cancelled", order.toObject());
			}

			console.log(
				`[ORDER CANCEL] Commande ${order._id} annulée par ${req.user.role} ${req.user.userId || req.user.serverId}`,
			);

			res.json({ success: true, message: "Commande annulée", order });
		} catch (err) {
			console.error("❌ [ORDER CANCEL] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
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

/**
 * DELETE /orders/:orderId/items/:itemId
 * CAS 15 — Annulation urgente d'un item (client part avant réception)
 */
router.delete(
	"/:orderId/items/:itemId",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { orderId, itemId } = req.params;
			const { reason } = req.body;

			if (!mongoose.Types.ObjectId.isValid(orderId)) {
				return res.status(400).json({ message: "ID commande invalide" });
			}

			const order = await Order.findById(orderId);
			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			const itemIndex = order.items.findIndex(
				(item) => item._id.toString() === itemId
			);

			if (itemIndex === -1) {
				return res.status(404).json({ message: "Item introuvable" });
			}

			// Marquer item comme cancelled
			order.items[itemIndex].itemStatus = "cancelled";
			order.items[itemIndex].cancelReason = reason || "Customer emergency";
			order.items[itemIndex].cancelledAt = new Date();

			// Recalculer totalAmount (exclure items cancelled)
			order.totalAmount = order.items
				.filter((item) => item.itemStatus !== "cancelled")
				.reduce((sum, item) => sum + item.price * item.quantity, 0);

			await order.save();

			// WebSocket
			const io = req.app.get("io");
			if (io && order.restaurantId) {
				io.to(`restaurant_${order.restaurantId}`).emit("order", {
					type: "item_cancelled",
					data: order.toObject(),
				});
			}

			res.status(200).json(order);
		} catch (err) {
			console.error("Erreur annulation item :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

module.exports = router;
