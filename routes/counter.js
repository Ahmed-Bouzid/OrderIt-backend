/**
 * 🏪 Counter.js — Endpoints pour le mode Comptoir
 *
 * Mode service : tablette partagée au comptoir, prise de commande directe par table
 * Gère les sessions table (sans QR client, sans réservation formelle)
 *
 * Endpoints :
 * - POST /counter/sessions — ouvrir une session table
 * - GET /counter/sessions/:tableId/active — récupérer session active
 * - PATCH /counter/sessions/:id/bill — demander l'addition
 * - PATCH /counter/sessions/:id/close — encaisser & libérer
 */

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const mongoose = require("mongoose");
const TableSession = require("../models/TableSession");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const { emitTableSessionEvent } = require("../utils/socketEmitter");

/**
 * POST /counter/sessions
 * Ouvrir une session table counter (ou retourner l'existante)
 */
router.post(
	"/sessions",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { restaurantId, tableId, waiterName, waiterId } = req.body;

			// Validation
			if (
				!restaurantId ||
				!mongoose.Types.ObjectId.isValid(restaurantId)
			) {
				return res
					.status(400)
					.json({ message: "restaurantId invalide" });
			}
			if (!tableId || !mongoose.Types.ObjectId.isValid(tableId)) {
				return res
					.status(400)
					.json({ message: "tableId invalide" });
			}

			// Vérifier que la table existe
			const table = await Table.findById(tableId);
			if (!table) {
				return res
					.status(404)
					.json({ message: "Table non trouvée" });
			}

			// Vérifier que le restaurant existe et est en mode counter
			const restaurant = await Restaurant.findById(restaurantId);
			if (!restaurant) {
				return res
					.status(404)
					.json({ message: "Restaurant non trouvé" });
			}
			if (restaurant.serviceMode !== "counter") {
				return res.status(403).json({
					message:
						"Ce restaurant n'est pas en mode Comptoir",
				});
			}

			// Chercher une session counter active existante pour cette table
			const existingSession = await TableSession.findOne({
				tableId,
				source: "counter",
				billStatus: { $ne: "closed" },
			});

			if (existingSession) {
				// Retourner la session existante
				return res.status(200).json(existingSession);
			}

			// Créer une nouvelle session counter
			const session = new TableSession({
				restaurantId,
				tableId,
				source: "counter",
				status: "active",
				billStatus: "open",
				totalAmount: 0,
				paymentMethod: null,
				openedAt: new Date(),
				...(waiterName && { waiterName }),
				...(waiterId && mongoose.Types.ObjectId.isValid(waiterId) && { waiterId }),
			});

			await session.save();

			// Émettre événement WebSocket
			const io = req.app.locals.io;
			if (io && restaurantId) {
				emitTableSessionEvent(
					io,
					restaurantId.toString(),
					"opened",
					session.toObject(),
				);
			}

			res.status(201).json(session);
		} catch (err) {
			console.error("Erreur création session counter :", err);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * GET /counter/sessions/:tableId/active
 * Récupérer la session counter active pour une table
 */
router.get(
	"/sessions/:tableId/active",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { tableId } = req.params;

			if (!mongoose.Types.ObjectId.isValid(tableId)) {
				return res
					.status(400)
					.json({ message: "tableId invalide" });
			}

			const session = await TableSession.findOne({
				tableId,
				source: "counter",
				billStatus: { $ne: "closed" },
			}).populate("tableId restaurantId");

			if (!session) {
				return res
					.status(404)
					.json({ message: "Aucune session active" });
			}

			// Récupérer les orders associées (cumuler le total)
			const orders = await Order.find({
				tableSessionId: session._id,
				source: "counter",
			});

			// Recalculer le total cumulé depuis les orders
			const totalAmount = orders.reduce(
				(sum, order) => sum + (order.totalAmount || 0),
				0,
			);

			res.status(200).json({
				...session.toObject(),
				totalAmount,
				ordersCount: orders.length,
			});
		} catch (err) {
			console.error("Erreur récupération session :", err);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * PATCH /counter/sessions/:id/bill
 * Marquer la table comme "addition demandée" (passe au statut "bill_requested")
 */
router.patch(
	"/sessions/:id/bill",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID invalide" });
			}

			const session = await TableSession.findById(id);
			if (!session) {
				return res
					.status(404)
					.json({ message: "Session non trouvée" });
			}

			if (session.source !== "counter") {
				return res.status(403).json({
					message: "Cette session n'est pas en mode Comptoir",
				});
			}

			// Passer à bill_requested
			session.billStatus = "bill_requested";
			await session.save();

			// Émettre événement WebSocket
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(
					io,
					session.restaurantId.toString(),
					"bill_requested",
					session.toObject(),
				);
			}

			res.status(200).json(session);
		} catch (err) {
			console.error("Erreur demande addition :", err);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * PATCH /counter/sessions/:id/close
 * Encaisser et libérer la table (passe au statut "closed")
 * Body : { paymentMethod: "cash" | "card_offline" }
 */
router.patch(
	"/sessions/:id/close",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { paymentMethod } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID invalide" });
			}

			if (!["cash", "card_offline"].includes(paymentMethod)) {
				return res.status(400).json({
					message: 'paymentMethod doit être "cash" ou "card_offline"',
				});
			}

			const session = await TableSession.findById(id);
			if (!session) {
				return res
					.status(404)
					.json({ message: "Session non trouvée" });
			}

			if (session.source !== "counter") {
				return res.status(403).json({
					message: "Cette session n'est pas en mode Comptoir",
				});
			}

			// Récupérer le total depuis les orders
			const orders = await Order.find({
				tableSessionId: session._id,
				source: "counter",
			});

			const totalAmount = orders.reduce(
				(sum, order) => sum + (order.totalAmount || 0),
				0,
			);

			// Fermer la session
			session.billStatus = "closed";
			session.status = "closed";
			session.closedAt = new Date();
			session.totalAmount = totalAmount;
			session.paymentMethod = paymentMethod;

			await session.save();

			// Log d'encaissement (audit trail)
			console.log(`[COUNTER] Session fermée :`, {
				sessionId: session._id,
				tableId: session.tableId,
				totalAmount,
				paymentMethod,
				closedAt: session.closedAt,
			});

			// Émettre événement WebSocket
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(
					io,
					session.restaurantId.toString(),
					"closed",
					session.toObject(),
				);
			}

			res.status(200).json(session);
		} catch (err) {
			console.error("Erreur fermeture session :", err);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * GET /counter/tables/:restaurantId
 * Récupérer l'état de toutes les tables d'un restaurant (pour l'affichage du plan)
 */
router.get(
	"/tables/:restaurantId",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.params;
			const { roomNumber } = req.query;

			if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({
					message: "restaurantId invalide",
				});
			}

			// Récupérer les tables du restaurant (avec filtre salle si fourni)
			const query = { restaurantId };
			if (roomNumber) {
				query.roomNumber = parseInt(roomNumber);
			}

			const tables = await Table.find(query)
				.select(
					"_id number capacity roomNumber x y size status isAvailable",
				);

			// Récupérer les sessions counter actives
			const activeSessions = await TableSession.find({
				restaurantId,
				source: "counter",
				billStatus: { $ne: "closed" },
			});

			// Mapper état pour chaque table
			const tablesWithState = await Promise.all(
				tables.map(async (table) => {
					const session = activeSessions.find(
						(s) =>
							s.tableId.toString() === table._id.toString(),
					);

					if (!session) {
						// Table libre
						return {
							...table.toObject(),
							status: "free",
							sessionId: null,
							totalAmount: 0,
							itemsCount: 0,
						};
					}

					// Récupérer les orders pour cette session
					const orders = await Order.find({
						tableSessionId: session._id,
						source: "counter",
					});

					const totalAmount = orders.reduce(
						(sum, order) => sum + (order.totalAmount || 0),
						0,
					);

					const itemsCount = orders.reduce(
						(sum, order) => sum + (order.items?.length || 0),
						0,
					);

					return {
						...table.toObject(),
						status: session.billStatus === "bill_requested" ? "bill_requested" : "occupied",
						sessionId: session._id,
						totalAmount,
						itemsCount,
						openedAt: session.openedAt,
					};
				}),
			);

			res.status(200).json({
				tables: tablesWithState,
				activeSessions: activeSessions.length,
			});
		} catch (err) {
			console.error("Erreur récupération état tables :", err);
			res.status(500).json({ message: err.message });
		}
	},
);

module.exports = router;
