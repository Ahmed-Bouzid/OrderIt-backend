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
const { applyDiscounts } = require("../utils/discountCalculator");
const counterService = require("../services/counterService"); // ✅ Import du service

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
			const { restaurantId, tableId, reservationId, guestCount } = req.body;

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

			// ✅ Utiliser counterService pour créer la session avec transaction atomique
			const session = await counterService.createSession({
				restaurantId,
				tableId,
				reservationId: reservationId || null,
				guestCount: guestCount || 1,
				serverId: req.user._id,
			});

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
			
			// Gestion d'erreur spécifique
			if (err.message === "Table not found") {
				return res.status(404).json({ message: "Table non trouvée" });
			}
			if (err.message === "Table already occupied") {
				return res.status(409).json({ message: "Table déjà occupée" });
			}
			if (err.message === "Reservation not found") {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}
			
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

			// ✅ Utiliser counterService.requestBill()
			const session = await counterService.requestBill(id);

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
			
			// Gestion d'erreur spécifique
			if (err.message === "Session not found") {
				return res.status(404).json({ message: "Session non trouvée" });
			}
			if (err.message === "Session is not active") {
				return res.status(400).json({ message: "Session n'est pas active" });
			}
			if (err.message === "Bill already closed") {
				return res.status(400).json({ message: "Addition déjà encaissée" });
			}
			
			res.status(500).json({ message: err.message });
		}
	},
);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * PATCH /counter/sessions/:id/close
 * Encaisser
 *   paymentMethod: "cash" | "card_offline",
 *   discounts: [{ type, value, reason, description?, orderId?, itemIndex? }] (optionnel)
 * }
 */
router.patch(
	"/sessions/:id/close",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { paymentMethod, discounts } = req.body;

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

			// Récupérer toutes les commandes de la session
			const orders = await Order.find({
				tableSessionId: session._id,
				source: "counter",
			});

			// Appliquer les réductions si fournies
			let pricing = { subtotal: 0, totalDiscounts: 0, finalAmount: 0 };
			let processedDiscounts = [];
			let discountErrors = [];

			if (discounts && Array.isArray(discounts) && discounts.length > 0) {
				const result = await applyDiscounts(
					discounts,
					orders,
					req.user._id, // Serveur qui applique
				);

				pricing = result.pricing;
				processedDiscounts = result.processedDiscounts;
				discountErrors = result.errors;

				// Si erreurs de validation, retourner avec détails
				if (discountErrors.length > 0) {
					return res.status(400).json({
						message: "Certaines réductions sont invalides",
						errors: discountErrors,
					});
				}
			} else {
				// Pas de réduction : calcul simple
				const subtotal = orders.reduce(
					(sum, order) => sum + (order.totalAmount || 0),
					0,
				);
				pricing = {
					subtotal: Math.round(subtotal * 100) / 100,
					totalDiscounts: 0,
					finalAmount: Math.round(subtotal * 100) / 100,
				};
			}

			// Fermer la session avec les données de pricing
			session.billStatus = "closed";
			session.status = "closed";
			session.closedAt = new Date();
			session.totalAmount = pricing.finalAmount; // Montant FINAL après réductions
			session.paymentMethod = paymentMethod;
			session.discounts = processedDiscounts;
			session.pricing = pricing;

			// validateModifiedOnly: true évite de revalider les sous-documents
			// existants en DB qui pourraient avoir des champs required manquants
			// (ex: discounts.appliedBy créés avant la contrainte)
			await session.save({ validateModifiedOnly: true });

			// Log d'encaissement (audit trail)
			console.log(`[COUNTER] Session fermée :`, {
				sessionId: session._id,
				tableId: session.tableId,
				subtotal: pricing.subtotal,
				totalDiscounts: pricing.totalDiscounts,
				finalAmount: pricing.finalAmount,
				discountsApplied: processedDiscounts.length,
				paymentMethod,
				closedAt: session.closedAt,
			});

			// Log détaillé des réductions
			if (processedDiscounts.length > 0) {
				console.log(`[COUNTER] Réductions appliquées :`, {
					sessionId: session._id,
					discounts: processedDiscounts.map((d) => ({
						type: d.type,
						reason: d.reason,
						amountDeducted: d.amountDeducted,
					})),
				});
			}

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
					"_id number capacity roomNumber position size status isAvailable",
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

					// Récupérer les orders pour cette session (excluant les annulés)
					const orders = await Order.find({
						tableSessionId: session._id,
						source: "counter",
						orderStatus: { $ne: "cancelled" }, // ✅ Exclure les orders annulés
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

/**
 * POST /counter/sessions/:id/transfer
 * CAS 11 — Transfert de table mid-service
 */
router.post(
	"/sessions/:id/transfer",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { newTableId, reason } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}

			if (!newTableId || !mongoose.Types.ObjectId.isValid(newTableId)) {
				return res.status(400).json({ message: "newTableId invalide" });
			}

			// Récupérer la session
			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}

			if (session.billStatus === "closed") {
				return res.status(400).json({ message: "Session déjà fermée" });
			}

			// Vérifier que la nouvelle table existe et est disponible
			const newTable = await Table.findById(newTableId);
			if (!newTable) {
				return res.status(404).json({ message: "Table cible introuvable" });
			}

			// Vérifier qu'aucune session active sur la nouvelle table
			const existingSession = await TableSession.findOne({
				tableId: newTableId,
				billStatus: { $ne: "closed" },
			});

			if (existingSession) {
				return res.status(409).json({
					message: "Table cible déjà occupée",
				});
			}

			const oldTableId = session.tableId;

			// Ajouter au transferHistory
			session.transferHistory = session.transferHistory || [];
			session.transferHistory.push({
				fromTableId: oldTableId,
				toTableId: newTableId,
				transferredAt: new Date(),
				reason: reason || "Staff request",
			});

			// Mettre à jour tableId
			session.tableId = newTableId;
			await session.save({ validateModifiedOnly: true });

			// Mettre à jour tous les orders liés
			await Order.updateMany(
				{ tableSessionId: session._id },
				{ tableId: newTableId }
			);

			// Libérer ancienne table
			if (oldTableId) {
				await Table.findByIdAndUpdate(oldTableId, {
					status: "available",
				});
			}

			// Occuper nouvelle table
			await Table.findByIdAndUpdate(newTableId, {
				status: "occupied",
			});

			// WebSocket
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(
					io,
					session.restaurantId.toString(),
					"transferred",
					session.toObject()
				);
			}

			res.status(200).json(session);
		} catch (err) {
			console.error("Erreur transfert table :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

/**
 * POST /counter/sessions/:id/split
 * CAS 12 — Split bill (addition séparée)
 */
router.post(
	"/sessions/:id/split",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;
			const { splits } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}

			if (!Array.isArray(splits) || splits.length === 0) {
				return res.status(400).json({
					message: "Format splits invalide (array requis)",
				});
			}

			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}

			if (session.billStatus === "closed") {
				return res.status(400).json({ message: "Session déjà fermée" });
			}

			// Valider chaque split
			for (const split of splits) {
				if (!split.amount || split.amount <= 0) {
					return res.status(400).json({
						message: "Chaque split doit avoir un amount > 0",
					});
				}
			}

			// Ajouter les splits
			session.splitPayments = splits.map((s) => ({
				amount: s.amount,
				orderIds: s.orderIds || [],
				paidAt: s.paidAt || null,
				paymentMethod: s.paymentMethod || null,
			}));

			await session.save({ validateModifiedOnly: true });

			// WebSocket
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(
					io,
					session.restaurantId.toString(),
					"split_created",
					session.toObject()
				);
			}

			res.status(200).json(session);
		} catch (err) {
			console.error("Erreur split payment :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

/**
 * POST /counter/sessions/:id/extend
 * CAS 14 — Prolongation session (client revient)
 */
router.post(
	"/sessions/:id/extend",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		try {
			const { id } = req.params;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}

			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}

			if (session.billStatus !== "closed") {
				return res.status(400).json({
					message: "Seule une session fermée peut être prolongée",
				});
			}

			// Rouvrir la session
			session.billStatus = "open";
			session.reopenedAt = new Date();
			session.extensionCount = (session.extensionCount || 0) + 1;
			session.status = "active";

			await session.save({ validateModifiedOnly: true });

			// WebSocket
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(
					io,
					session.restaurantId.toString(),
					"extended",
					session.toObject()
				);
			}

			res.status(200).json(session);
		} catch (err) {
			console.error("Erreur prolongation session :", err);
			res.status(500).json({ message: err.message });
		}
	}
);

module.exports = router;
