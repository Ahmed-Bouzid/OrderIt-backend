const express = require("express");
const router = express.Router();
const PredefinedMessage = require("../models/PredefinedMessage");
const ClientMessage = require("../models/ClientMessage");
const ServerResponse = require("../models/ServerResponse");
const PredefinedServerResponse = require("../models/PredefinedServerResponse");
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");
const validateObjectIds = require("../middlewares/validateObjectId");

// ═══════════════════════════════════════════════════════════════════════
// 📨 ROUTES PUBLIQUES (Client)
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /client-messages/predefined/:restaurantId
 * Récupère tous les messages prédéfinis actifs d'un restaurant
 * Route publique pour les clients
 */
router.get("/predefined/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;

		const messages = await PredefinedMessage.find({
			restaurantId,
			isActive: true,
		})
			.sort({ order: 1, createdAt: 1 })
			.select("text category icon order");

		res.json({
			success: true,
			messages,
		});
	} catch (error) {
		console.error("❌ Erreur récupération messages prédéfinis:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * POST /client-messages/send
 * Envoie un message prédéfini au serveur
 * Route publique pour les clients
 */
router.post("/send", async (req, res) => {
	try {
		const { predefinedMessageId, reservationId, clientId, clientName } =
			req.body;

		// Validation des champs requis
		if (!predefinedMessageId || !reservationId || !clientId) {
			return res.status(400).json({
				success: false,
				message:
					"Champs requis manquants: predefinedMessageId, reservationId, clientId",
			});
		}

		// Récupérer le message prédéfini
		const predefinedMessage = await PredefinedMessage.findById(
			predefinedMessageId
		);
		if (!predefinedMessage) {
			return res.status(404).json({
				success: false,
				message: "Message prédéfini non trouvé",
			});
		}

		// Récupérer la réservation pour avoir tableId et restaurantId
		const reservation = await Reservation.findById(reservationId)
			.populate("tableId", "serverId")
			.select("tableId restaurantId");

		if (!reservation) {
			return res.status(404).json({
				success: false,
				message: "Réservation non trouvée",
			});
		}

		// Créer le message
		const clientMessage = new ClientMessage({
			predefinedMessageId,
			messageText: predefinedMessage.text,
			reservationId,
			tableId: reservation.tableId._id,
			restaurantId: reservation.restaurantId,
			clientId,
			clientName: clientName || "Client",
			serverId: reservation.tableId.serverId || null,
			status: "sent",
		});

		await clientMessage.save();

		// Émettre l'événement WebSocket pour notifier le serveur
		const io = req.app.get("io");
		if (io) {
			// Récupérer les infos de la table pour la notification
			const table = await Table.findById(reservation.tableId._id).select(
				"number"
			);

			io.to(`restaurant-${reservation.restaurantId}`).emit("client-message", {
				type: "new-message",
				data: {
					messageId: clientMessage._id,
					messageText: predefinedMessage.text,
					category: predefinedMessage.category,
					icon: predefinedMessage.icon,
					tableNumber: table?.number || "?",
					tableId: reservation.tableId._id,
					clientName: clientName || "Client",
					reservationId,
					timestamp: clientMessage.createdAt,
				},
				timestamp: new Date().toISOString(),
			});
			console.log(
				`📡 Message client envoyé: Table ${table?.number} - "${predefinedMessage.text}"`
			);
		}

		res.status(201).json({
			success: true,
			message: "Message envoyé avec succès",
			data: {
				messageId: clientMessage._id,
				messageText: predefinedMessage.text,
				sentAt: clientMessage.createdAt,
			},
		});
	} catch (error) {
		console.error("❌ Erreur envoi message client:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur lors de l'envoi du message",
		});
	}
});

/**
 * GET /client-messages/history/:reservationId
 * Historique des messages d'une réservation (optionnel)
 */
router.get("/history/:reservationId", async (req, res) => {
	try {
		const { reservationId } = req.params;

		const messages = await ClientMessage.find({
			reservationId,
			status: { $ne: "cancelled" },
		})
			.sort({ createdAt: -1 })
			.limit(50)
			.select("messageText status createdAt readAt");

		res.json({
			success: true,
			messages,
		});
	} catch (error) {
		console.error("❌ Erreur récupération historique messages:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 📨 ROUTES PROTÉGÉES (Serveur/Admin)
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /client-messages/restaurant/:restaurantId
 * Récupère tous les messages non lus d'un restaurant (pour le dashboard serveur)
 * Route protégée
 */
router.get("/restaurant/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { status = "sent" } = req.query;

		const messages = await ClientMessage.find({
			restaurantId,
			status,
		})
			.populate("tableId", "number")
			.populate("predefinedMessageId", "icon category")
			.sort({ createdAt: -1 })
			.limit(100);

		res.json({
			success: true,
			messages,
		});
	} catch (error) {
		console.error("❌ Erreur récupération messages restaurant:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * PUT /client-messages/:messageId/read
 * Marque un message comme lu
 */
router.put("/:messageId/read", async (req, res) => {
	try {
		const { messageId } = req.params;

		const message = await ClientMessage.findByIdAndUpdate(
			messageId,
			{
				status: "read",
				readAt: new Date(),
			},
			{ new: true }
		);

		if (!message) {
			return res.status(404).json({
				success: false,
				message: "Message non trouvé",
			});
		}

		// Notifier via WebSocket que le message a été lu
		const io = req.app.get("io");
		if (io) {
			io.to(`restaurant-${message.restaurantId}`).emit("client-message", {
				type: "message-read",
				data: {
					messageId: message._id,
					readAt: message.readAt,
				},
				timestamp: new Date().toISOString(),
			});
		}

		res.json({
			success: true,
			message: "Message marqué comme lu",
		});
	} catch (error) {
		console.error("❌ Erreur marquage message lu:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * PUT /client-messages/:messageId/read-all
 * Marque tous les messages d'une table comme lus
 */
router.put("/read-all/:tableId", async (req, res) => {
	try {
		const { tableId } = req.params;

		const result = await ClientMessage.updateMany(
			{
				tableId,
				status: "sent",
			},
			{
				status: "read",
				readAt: new Date(),
			}
		);

		res.json({
			success: true,
			message: `${result.modifiedCount} messages marqués comme lus`,
		});
	} catch (error) {
		console.error("❌ Erreur marquage messages lus:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 📝 GESTION DES MESSAGES PRÉDÉFINIS (Admin)
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /client-messages/predefined
 * Crée un nouveau message prédéfini
 */
router.post("/predefined", async (req, res) => {
	try {
		const { text, category, icon, order, restaurantId } = req.body;

		if (!text || !restaurantId) {
			return res.status(400).json({
				success: false,
				message: "Texte et restaurantId requis",
			});
		}

		const message = new PredefinedMessage({
			text,
			category: category || "service",
			icon: icon || "chatbubble-outline",
			order: order || 0,
			restaurantId,
		});

		await message.save();

		res.status(201).json({
			success: true,
			message: "Message prédéfini créé",
			data: message,
		});
	} catch (error) {
		console.error("❌ Erreur création message prédéfini:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * PUT /client-messages/predefined/:messageId
 * Modifie un message prédéfini
 */
router.put("/predefined/:messageId", async (req, res) => {
	try {
		const { messageId } = req.params;
		const { text, category, icon, order, isActive } = req.body;

		const message = await PredefinedMessage.findByIdAndUpdate(
			messageId,
			{ text, category, icon, order, isActive },
			{ new: true, runValidators: true }
		);

		if (!message) {
			return res.status(404).json({
				success: false,
				message: "Message non trouvé",
			});
		}

		res.json({
			success: true,
			message: "Message prédéfini mis à jour",
			data: message,
		});
	} catch (error) {
		console.error("❌ Erreur modification message prédéfini:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * DELETE /client-messages/predefined/:messageId
 * Supprime un message prédéfini (soft delete)
 */
router.delete("/predefined/:messageId", async (req, res) => {
	try {
		const { messageId } = req.params;

		const message = await PredefinedMessage.findByIdAndUpdate(
			messageId,
			{ isActive: false },
			{ new: true }
		);

		if (!message) {
			return res.status(404).json({
				success: false,
				message: "Message non trouvé",
			});
		}

		res.json({
			success: true,
			message: "Message prédéfini désactivé",
		});
	} catch (error) {
		console.error("❌ Erreur suppression message prédéfini:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 💬 MESSAGERIE BIDIRECTIONNELLE (Conversation)
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /client-messages/conversation/:reservationId
 * Récupère la conversation complète (messages client + réponses serveur)
 * Route publique pour afficher le thread de conversation
 */
router.get("/conversation/:reservationId", async (req, res) => {
	try {
		const { reservationId } = req.params;

		// Récupérer messages clients
		const clientMessages = await ClientMessage.find({
			reservationId,
			status: { $ne: "cancelled" },
		})
			.select("messageText createdAt status")
			.lean();

		// Récupérer réponses serveur
		const serverResponses = await ServerResponse.find({
			reservationId,
		})
			.select("responseText serverName createdAt status")
			.lean();

		// Fusionner et trier chronologiquement
		const conversation = [
			...clientMessages.map((m) => ({
				...m,
				type: "client",
				text: m.messageText,
			})),
			...serverResponses.map((r) => ({
				...r,
				type: "server",
				text: r.responseText,
			})),
		].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

		res.json({
			success: true,
			conversation,
			totalMessages: conversation.length,
		});
	} catch (error) {
		console.error("❌ Erreur récupération conversation:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * GET /client-messages/server-responses/predefined/:restaurantId
 * Récupère les réponses serveur prédéfinies
 * Route protégée (serveur/admin uniquement)
 */
router.get("/server-responses/predefined/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;

		// Récupérer réponses spécifiques restaurant + globales
		const responses = await PredefinedServerResponse.find({
			$or: [{ restaurantId }, { restaurantId: null }],
			isActive: true,
		})
			.sort({ order: 1, createdAt: 1 })
			.select("text category icon order");

		res.json({
			success: true,
			responses,
		});
	} catch (error) {
		console.error("❌ Erreur récupération réponses prédéfinies:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * POST /client-messages/server-responses/send
 * Envoie une réponse serveur au client
 * Route protégée (serveur/admin uniquement)
 */
router.post("/server-responses/send", async (req, res) => {
	try {
		const {
			clientMessageId,
			responseText,
			reservationId,
			serverId,
			serverName,
		} = req.body;

		// Validation
		if (!clientMessageId || !responseText || !reservationId || !serverId) {
			return res.status(400).json({
				success: false,
				message:
					"Champs requis manquants: clientMessageId, responseText, reservationId, serverId",
			});
		}

		// Vérifier que le message client existe
		const clientMessage = await ClientMessage.findById(clientMessageId);
		if (!clientMessage) {
			return res.status(404).json({
				success: false,
				message: "Message client non trouvé",
			});
		}

		// Créer la réponse serveur
		const serverResponse = new ServerResponse({
			clientMessageId,
			responseText,
			reservationId,
			restaurantId: clientMessage.restaurantId,
			serverId,
			serverName: serverName || "Serveur",
			status: "sent",
		});

		await serverResponse.save();

		// Marquer le message client comme lu
		if (clientMessage.status === "sent") {
			clientMessage.status = "read";
			clientMessage.readAt = new Date();
			await clientMessage.save();
		}

		// Émettre événement WebSocket pour notifier le client
		const io = req.app.get("io");
		if (io) {
			io.to(`restaurant-${clientMessage.restaurantId}`).emit("server-response", {
				type: "new-response",
				data: {
					responseId: serverResponse._id,
					responseText: serverResponse.responseText,
					serverName: serverResponse.serverName,
					clientMessageId,
					reservationId,
					timestamp: serverResponse.createdAt,
				},
				timestamp: new Date().toISOString(),
			});

			console.log(
				`📤 Réponse serveur envoyée: "${responseText}" → Réservation ${reservationId}`
			);
		}

		res.status(201).json({
			success: true,
			message: "Réponse envoyée avec succès",
			data: {
				responseId: serverResponse._id,
				responseText: serverResponse.responseText,
				sentAt: serverResponse.createdAt,
			},
		});
	} catch (error) {
		console.error("❌ Erreur envoi réponse serveur:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur lors de l'envoi de la réponse",
		});
	}
});

/**
 * PUT /client-messages/toggle-messaging/:restaurantId
 * Active/Désactive la messagerie pour un restaurant
 * Route protégée (admin/manager uniquement)
 */
router.put("/toggle-messaging/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { isEnabled } = req.body;

		if (typeof isEnabled !== "boolean") {
			return res.status(400).json({
				success: false,
				message: "isEnabled doit être un boolean",
			});
		}

		const restaurant = await Restaurant.findByIdAndUpdate(
			restaurantId,
			{ isMessagingEnabled: isEnabled },
			{ new: true }
		).select("isMessagingEnabled");

		if (!restaurant) {
			return res.status(404).json({
				success: false,
				message: "Restaurant non trouvé",
			});
		}

		// Notifier via WebSocket que la messagerie a été activée/désactivée
		const io = req.app.get("io");
		if (io) {
			io.to(`restaurant-${restaurantId}`).emit("messaging-status-changed", {
				isEnabled,
				timestamp: new Date().toISOString(),
			});
		}

		res.json({
			success: true,
			message: `Messagerie ${isEnabled ? "activée" : "désactivée"}`,
			isMessagingEnabled: restaurant.isMessagingEnabled,
		});
	} catch (error) {
		console.error("❌ Erreur toggle messagerie:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

/**
 * GET /client-messages/messaging-status/:restaurantId
 * Récupère le statut de la messagerie pour un restaurant
 * Route publique
 */
router.get("/messaging-status/:restaurantId", async (req, res) => {
	try {
		const { restaurantId } = req.params;

		const restaurant = await Restaurant.findById(restaurantId).select(
			"isMessagingEnabled"
		);

		if (!restaurant) {
			return res.status(404).json({
				success: false,
				message: "Restaurant non trouvé",
			});
		}

		res.json({
			success: true,
			isMessagingEnabled: restaurant.isMessagingEnabled,
		});
	} catch (error) {
		console.error("❌ Erreur récupération statut messagerie:", error);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
		});
	}
});

module.exports = router;
