/**
 * 📨 Messages Routes - API REST pour messages internes
 */
const express = require("express");
const router = express.Router();
const MessageService = require("../services/messageService");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");

/**
 * POST /api/messages
 * Créer un nouveau message (Manager → Serveur)
 * Body: { type, title, description, coachingItem?, metadata?, priority? }
 */
router.post("/", auth, checkRoles(["admin", "manager"]), async (req, res) => {
	try {
		const {
			type,
			title,
			description,
			coachingItem,
			metadata,
			priority,
			serverId,
		} = req.body;

		// Validation
		if (!type || !title || !description || !serverId) {
			return res.status(400).json({
				error: "Champs requis: type, title, description, serverId",
			});
		}

		const validTypes = ["meeting", "planning", "zonning", "coaching"];
		if (!validTypes.includes(type)) {
			return res.status(400).json({
				error: "Type invalide: meeting, planning, zonning, coaching",
			});
		}

		const message = await MessageService.createMessage(
			req.user.restaurantId,
			req.user.id,
			serverId,
			{
				type,
				title,
				description,
				coachingItem,
				metadata,
				priority,
			},
		);

		res.status(201).json({
			success: true,
			message,
		});
	} catch (error) {
		console.error("❌ [Messages Route] POST error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/messages/server
 * Récupérer les messages d'un serveur
 * Query: status (pending|accepted|rejected|all), limit, skip
 */
router.get("/server", auth, async (req, res) => {
	try {
		const { status = "pending", limit = 50, skip = 0 } = req.query;

		// Si c'est un serveur, utiliser son ID
		const serverId = req.body.serverId || req.user.id;

		const result = await MessageService.getServerMessages(
			serverId,
			req.user.restaurantId,
			{
				status,
				limit: parseInt(limit),
				skip: parseInt(skip),
			},
		);

		res.json({
			success: true,
			...result,
		});
	} catch (error) {
		console.error(
			"❌ [Messages Route] GET server messages error:",
			error.message,
		);
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/messages/manager
 * Récupérer les messages envoyés par un manager
 * Query: limit, skip
 */
router.get(
	"/manager",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const { limit = 50, skip = 0 } = req.query;

			const result = await MessageService.getManagerMessages(
				req.user.id,
				req.user.restaurantId,
				{
					limit: parseInt(limit),
					skip: parseInt(skip),
				},
			);

			res.json({
				success: true,
				...result,
			});
		} catch (error) {
			console.error(
				"❌ [Messages Route] GET manager messages error:",
				error.message,
			);
			res.status(500).json({ error: error.message });
		}
	},
);

/**
 * GET /api/messages/unread
 * Récupérer le nombre de messages non lus
 */
router.get("/unread", auth, async (req, res) => {
	try {
		const count = await MessageService.getUnreadCount(
			req.user.id,
			req.user.restaurantId,
		);

		res.json({
			success: true,
			unreadCount: count,
		});
	} catch (error) {
		console.error("❌ [Messages Route] GET unread error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/messages/stats
 * Récupérer les statistiques des messages
 */
router.get(
	"/stats",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const stats = await MessageService.getMessageStats(req.user.restaurantId);

			res.json({
				success: true,
				stats,
			});
		} catch (error) {
			console.error("❌ [Messages Route] GET stats error:", error.message);
			res.status(500).json({ error: error.message });
		}
	},
);

/**
 * GET /api/messages/:id/history
 * Récupérer l'historique d'un message
 */
router.get("/:id/history", auth, async (req, res) => {
	try {
		const history = await MessageService.getMessageHistory(req.params.id);

		res.json({
			success: true,
			history,
		});
	} catch (error) {
		console.error("❌ [Messages Route] GET history error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

/**
 * PUT /api/messages/:id/respond
 * Répondre à un message (accepter/refuser)
 * Body: { status (accepted|rejected), notes? }
 */
router.put("/:id/respond", auth, async (req, res) => {
	try {
		const { status, notes } = req.body;

		if (!status || !["accepted", "rejected"].includes(status)) {
			return res.status(400).json({
				error: "Status invalide: accepted ou rejected",
			});
		}

		const message = await MessageService.respondToMessage(
			req.params.id,
			req.user.id,
			{
				status,
				notes,
			},
		);

		res.json({
			success: true,
			message,
		});
	} catch (error) {
		console.error("❌ [Messages Route] PUT respond error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

/**
 * PUT /api/messages/:id/read
 * Marquer un message comme lu
 */
router.put("/:id/read", auth, async (req, res) => {
	try {
		const message = await MessageService.markAsRead(req.params.id, req.user.id);

		res.json({
			success: true,
			message,
		});
	} catch (error) {
		console.error("❌ [Messages Route] PUT read error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

/**
 * DELETE /api/messages/:id
 * Supprimer un message (soft delete)
 */
router.delete("/:id", auth, async (req, res) => {
	try {
		const message = await MessageService.deleteMessage(
			req.params.id,
			req.user.id,
		);

		res.json({
			success: true,
			message,
		});
	} catch (error) {
		console.error("❌ [Messages Route] DELETE error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
