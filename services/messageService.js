/**
 * 📨 Message Service - Logique métier pour messages internes
 */
const ServerMessage = require("../models/ServerMessage");
const Server = require("../models/Server");
const Admin = require("../models/Admin");

class MessageService {
	/**
	 * Créer un nouveau message
	 */
	static async createMessage(restaurantId, managerId, serverId, messageData) {
		try {
			// Vérifier que le serveur existe
			const server = await Server.findOne({
				_id: serverId,
				restaurantId,
			});
			if (!server) {
				throw new Error("Serveur introuvable");
			}

			// Vérifier que le manager existe
			const manager = await Admin.findOne({
				_id: managerId,
				restaurantId,
			});
			if (!manager) {
				throw new Error("Manager introuvable");
			}

			// Créer le message
			const message = new ServerMessage({
				restaurantId,
				managerId,
				serverId,
				type: messageData.type,
				title: messageData.title,
				description: messageData.description,
				coachingItem: messageData.coachingItem || "general",
				metadata: messageData.metadata || null,
				priority: messageData.priority || "normal",
				status: "pending",
				history: [
					{
						action: "sent",
						performedBy: managerId,
						timestamp: new Date(),
						notes: "Message créé",
					},
				],
			});

			await message.save();

			// Émettre WebSocket pour notification en temps réel
			const socketEmitter = require("../utils/socketEmitter");
			socketEmitter.emitToServer(
				serverId,
				"newServerMessage",
				message.toObject(),
			);

			return message;
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur création message:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Récupérer les messages d'un serveur
	 */
	static async getServerMessages(serverId, restaurantId, options = {}) {
		try {
			const {
				status = "pending",
				includeDeleted = false,
				limit = 50,
				skip = 0,
			} = options;

			const query = {
				serverId,
				restaurantId,
				deletedAt: null,
			};

			if (status !== "all") {
				query.status = status;
			}

			const messages = await ServerMessage.find(query)
				.populate("managerId", "name email")
				.populate("serverId", "name email")
				.sort({ createdAt: -1 })
				.limit(limit)
				.skip(skip);

			const total = await ServerMessage.countDocuments(query);

			return {
				messages,
				total,
				page: Math.floor(skip / limit) + 1,
				hasMore: skip + limit < total,
			};
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur récupération serveur messages:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Récupérer les messages envoyés par un manager
	 */
	static async getManagerMessages(managerId, restaurantId, options = {}) {
		try {
			const { limit = 50, skip = 0 } = options;

			const messages = await ServerMessage.find({
				managerId,
				restaurantId,
				deletedAt: null,
			})
				.populate("serverId", "name email performanceScore")
				.populate("managerId", "name email")
				.sort({ createdAt: -1 })
				.limit(limit)
				.skip(skip);

			const total = await ServerMessage.countDocuments({
				managerId,
				restaurantId,
				deletedAt: null,
			});

			return {
				messages,
				total,
				page: Math.floor(skip / limit) + 1,
				hasMore: skip + limit < total,
			};
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur récupération manager messages:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Répondre à un message (accepter/refuser)
	 */
	static async respondToMessage(messageId, serverId, responseData) {
		try {
			const message = await ServerMessage.findById(messageId);
			if (!message) {
				throw new Error("Message introuvable");
			}

			// Vérifier que le serveur est le destinataire
			if (message.serverId.toString() !== serverId.toString()) {
				throw new Error("Accès non autorisé");
			}

			// Mettre à jour le message
			message.response = {
				status: responseData.status, // 'accepted' ou 'rejected'
				respondedAt: new Date(),
				notes: responseData.notes || null,
			};
			message.status = responseData.status;

			// Ajouter à l'historique
			message.history.push({
				action: responseData.status,
				performedBy: serverId,
				timestamp: new Date(),
				notes: responseData.notes || null,
			});

			await message.save();

			// Notification WebSocket au manager
			const socketEmitter = require("../utils/socketEmitter");
			socketEmitter.emitToAdmin(
				message.managerId,
				"messageResponse",
				message.toObject(),
			);

			return message;
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur réponse message:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Supprimer un message (soft delete)
	 */
	static async deleteMessage(messageId, userId) {
		try {
			const message = await ServerMessage.findById(messageId);
			if (!message) {
				throw new Error("Message introuvable");
			}

			// Soft delete
			message.deletedAt = new Date();
			message.status = "deleted";

			message.history.push({
				action: "deleted",
				performedBy: userId,
				timestamp: new Date(),
			});

			await message.save();

			return message;
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur suppression message:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Marquer un message comme lu
	 */
	static async markAsRead(messageId, serverId) {
		try {
			const message = await ServerMessage.findById(messageId);
			if (!message) {
				throw new Error("Message introuvable");
			}

			message.isRead = true;
			message.readAt = new Date();
			await message.save();

			return message;
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur marquage message:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Récupérer l'historique d'un message
	 */
	static async getMessageHistory(messageId) {
		try {
			const message = await ServerMessage.findById(messageId).populate(
				"history.performedBy",
				"name email",
			);

			if (!message) {
				throw new Error("Message introuvable");
			}

			return message.history;
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur historique message:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Récupérer les statistiques des messages
	 */
	static async getMessageStats(restaurantId) {
		try {
			const stats = await ServerMessage.aggregate([
				{
					$match: {
						restaurantId: new (require("mongoose").Types.ObjectId)(
							restaurantId,
						),
					},
				},
				{
					$group: {
						_id: "$status",
						count: { $sum: 1 },
					},
				},
			]);

			const typeStats = await ServerMessage.aggregate([
				{
					$match: {
						restaurantId: new (require("mongoose").Types.ObjectId)(
							restaurantId,
						),
					},
				},
				{
					$group: {
						_id: "$type",
						count: { $sum: 1 },
					},
				},
			]);

			return {
				byStatus: stats,
				byType: typeStats,
			};
		} catch (error) {
			console.error(
				"❌ [MessageService] Erreur stats messages:",
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Récupérer les messages non lus d'un serveur
	 */
	static async getUnreadCount(serverId, restaurantId) {
		try {
			const count = await ServerMessage.countDocuments({
				serverId,
				restaurantId,
				isRead: false,
				status: "pending",
				deletedAt: null,
			});

			return count;
		} catch (error) {
			console.error("❌ [MessageService] Erreur count non lus:", error.message);
			throw error;
		}
	}
}

module.exports = MessageService;
