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
 * - GET /counter/tables/:restaurantId — état de toutes les tables
 * - GET /counter/stats/:restaurantId — stats caisse du jour
 * - POST /counter/sessions/:id/transfer — transfert de table
 * - POST /counter/sessions/:id/split — split bill
 * - POST /counter/sessions/:id/extend — prolongation session
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
const counterService = require("../services/counterService");

/**
 * GET /counter/debug-version
 * Debug: vérifier commit déployé
 */
router.get("/debug-version", (req, res) => {
	const TableSession = require("../models/TableSession");
	const schema = TableSession.schema.obj;
	res.json({
		commit: "0122b96-serverId-fix",
		hasServerId: "serverId" in schema,
		serverIdDef: schema.serverId || "MISSING",
	});
});

/**
 * POST /counter/sessions
 * Ouvrir une session table counter (ou retourner l'existante)
 */
router.post(
	"/sessions",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { restaurantId, tableId, reservationId, guestCount, serverId } = req.body;

			// ✅ Validation stricte
			if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide" });
			}
			if (!tableId || !mongoose.Types.ObjectId.isValid(tableId)) {
				return res.status(400).json({ message: "tableId invalide" });
			}

			// ✅ Vérifier mode comptoir
			const restaurant = await Restaurant.findById(restaurantId);
			if (!restaurant) {
				return res.status(404).json({ message: "Restaurant non trouvé" });
			}
			if (restaurant.serviceMode !== "counter") {
				return res.status(403).json({ message: "Restaurant pas en mode Comptoir" });
			}

			// ✅ Chercher session existante (si race condition, elle sera là)
			const existingSession = await TableSession.findOne({
				tableId,
				source: "counter",
				billStatus: { $ne: "closed" },
			});

			if (existingSession) {
				const elapsed = Date.now() - startTime;
				console.log(`[COUNTER] Session existante retournée (${elapsed}ms): sessionId=${existingSession._id}`);
				return res.status(200).json(existingSession);
			}

				// ✅ Créer nouvelle session via service (transaction atomique)
			const session = await counterService.createSession({
			restaurantId,
			tableId,
			reservationId: reservationId || null,
			guestCount: guestCount || 1,
			serverId: serverId || null,
		});

		const elapsed = Date.now() - startTime;
		console.log(`[COUNTER] Session créée (${elapsed}ms): sessionId=${session._id}`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && restaurantId) {
				emitTableSessionEvent(io, restaurantId.toString(), "opened", session.toObject());
			}

			res.status(201).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] POST /sessions ERROR (${elapsed}ms):`, err.message);

			// ✅ Erreurs métier
			if (err.message === "Table not found") {
				return res.status(404).json({ message: "Table non trouvée" });
			}
			if (err.message === "Table already occupied") {
				return res.status(409).json({ message: "Table déjà occupée" });
			}
			if (err.message === "Reservation not found") {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}
			if (err.message.startsWith("TABLE_HAS_PENDING_RESERVATION")) {
				return res.status(400).json({ message: err.message });
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
		const startTime = Date.now();
		try {
			const { tableId } = req.params;

			if (!mongoose.Types.ObjectId.isValid(tableId)) {
				return res.status(400).json({ message: "tableId invalide" });
			}

			console.log(`[COUNTER] GET /sessions/${tableId}/active`);

			const session = await TableSession.findOne({
				tableId,
				source: "counter",
				billStatus: { $ne: "closed" },
		}).populate("tableId restaurantId serverId");

			if (!session) {
				const elapsed = Date.now() - startTime;
				console.log(`[COUNTER] Aucune session active (${elapsed}ms)`);
				return res.status(404).json({ message: "Aucune session active" });
			}

			// ✅ Récupérer les orders associées (1 seule query)
			const orders = await Order.find({
				tableSessionId: session._id,
				source: "counter",
				orderStatus: { $ne: "cancelled" },
			});

			const totalAmount = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Session active trouvée (${elapsed}ms): sessionId=${session._id} total=${totalAmount.toFixed(2)}€`);

			res.status(200).json({
				...session.toObject(),
				totalAmount,
				ordersCount: orders.length,
			});
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] GET /sessions/:tableId/active ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * PATCH /counter/sessions/:id/bill
 * Marquer la table comme "addition demandée" (billStatus → bill_requested)
 */
router.patch(
	"/sessions/:id/bill",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { id } = req.params;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID invalide" });
			}

			console.log(`[COUNTER] PATCH /sessions/${id}/bill`);

			// ✅ Service gère la transaction atomique
			const session = await counterService.requestBill(id);

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Addition demandée (${elapsed}ms): sessionId=${session._id}`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(io, session.restaurantId.toString(), "bill_requested", session.toObject());
			}

			res.status(200).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] PATCH /sessions/:id/bill ERROR (${elapsed}ms):`, err.message);

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

/**
 * PATCH /counter/sessions/:id/close
 * Encaisser : calculer réductions, fermer session, libérer table
 * Body: { paymentMethod: "cash"|"card_offline", discounts?: [...] }
 */
router.patch(
	"/sessions/:id/close",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { id } = req.params;
			const { paymentMethod, discounts } = req.body;

			// ✅ Validation input
			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID invalide" });
			}
			if (!["cash", "card_offline"].includes(paymentMethod)) {
				return res.status(400).json({ message: 'paymentMethod doit être "cash" ou "card_offline"' });
			}

			console.log(`[COUNTER] PATCH /sessions/${id}/close: paymentMethod=${paymentMethod}`);

			// ✅ Récupérer session
			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session non trouvée" });
			}
			if (session.source !== "counter") {
				return res.status(403).json({ message: "Session pas en mode Comptoir" });
			}

			// ✅ Récupérer toutes les commandes (1 query)
			const orders = await Order.find({
				tableSessionId: session._id,
				source: "counter",
			});

			// ✅ Appliquer les réductions si fournies
			let pricing = { subtotal: 0, totalDiscounts: 0, finalAmount: 0 };
			let processedDiscounts = [];
			let discountErrors = [];

			if (discounts && Array.isArray(discounts) && discounts.length > 0) {
				const result = await applyDiscounts(discounts, orders, req.user.id);
				pricing = result.pricing;
				processedDiscounts = result.processedDiscounts;
				discountErrors = result.errors;

				if (discountErrors.length > 0) {
					return res.status(400).json({
						message: "Certaines réductions sont invalides",
						errors: discountErrors,
					});
				}

				console.log(`[COUNTER] Réductions appliquées: ${processedDiscounts.length} | total déduit=${pricing.totalDiscounts.toFixed(2)}€`);
			} else {
				// Pas de réduction : calcul simple
				const subtotal = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
				pricing = {
					subtotal: Math.round(subtotal * 100) / 100,
					totalDiscounts: 0,
					finalAmount: Math.round(subtotal * 100) / 100,
				};
			}

			// ✅ Fermer la session
			session.billStatus = "closed";
			session.status = "closed";
			session.closedAt = new Date();
			session.totalAmount = pricing.finalAmount;
			session.paymentMethod = paymentMethod;
			session.discounts = processedDiscounts;
			session.pricing = pricing;

			await session.save({ validateModifiedOnly: true });

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Session fermée (${elapsed}ms): sessionId=${session._id} | subtotal=${pricing.subtotal.toFixed(2)}€ réductions=-${pricing.totalDiscounts.toFixed(2)}€ FINAL=${pricing.finalAmount.toFixed(2)}€`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(io, session.restaurantId.toString(), "closed", session.toObject());
			}

			res.status(200).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] PATCH /sessions/:id/close ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * GET /counter/tables/:restaurantId
 * Récupérer l'état de toutes les tables d'un restaurant (pour plan de salle)
 */
router.get(
	"/tables/:restaurantId",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { restaurantId } = req.params;
			const { roomNumber } = req.query;

			if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide" });
			}

			console.log(`[COUNTER] GET /tables/${restaurantId}${roomNumber ? ` room=${roomNumber}` : ""}`);

			// ✅ Récupérer les tables du restaurant
			const query = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };
			if (roomNumber) {
				query.roomNumber = parseInt(roomNumber);
			}

			const tables = await Table.find(query).select("_id number capacity roomNumber position size status isAvailable");

			// ✅ FIX CRITIQUE : Convertir restaurantId en ObjectId pour query MongoDB
			const activeSessions = await TableSession.find({
				restaurantId: new mongoose.Types.ObjectId(restaurantId),
				source: "counter",
				billStatus: { $ne: "closed" },
			});

			console.log(`[COUNTER] Tables trouvées: ${tables.length} | Sessions actives: ${activeSessions.length}`);

			// ✅ OPTIMISATION : 1 seule aggregation Order au lieu de N queries
			const sessionIds = activeSessions.map((s) => s._id);
			const ordersGrouped = await Order.aggregate([
				{
					$match: {
						tableSessionId: { $in: sessionIds },
						source: "counter",
						orderStatus: { $ne: "cancelled" },
					},
				},
				{
					$group: {
						_id: "$tableSessionId",
						totalAmount: { $sum: "$totalAmount" },
						itemsCount: { $sum: { $size: "$items" } },
					},
				},
			]);

			// ✅ Map orders par sessionId pour lookup O(1)
			const ordersMap = {};
			ordersGrouped.forEach((group) => {
				ordersMap[group._id.toString()] = {
					totalAmount: group.totalAmount,
					itemsCount: group.itemsCount,
				};
			});

			// ✅ Mapper état pour chaque table
			const tablesWithState = tables.map((table) => {
				const session = activeSessions.find((s) => s.tableId.toString() === table._id.toString());

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

				// Table occupée : récupérer orders depuis map
				const orderData = ordersMap[session._id.toString()] || { totalAmount: 0, itemsCount: 0 };

				return {
					...table.toObject(),
					status: session.billStatus === "bill_requested" ? "bill_requested" : "occupied",
					sessionId: session._id,
					totalAmount: orderData.totalAmount,
					itemsCount: orderData.itemsCount,
					openedAt: session.openedAt,
				};
			});

			const elapsed = Date.now() - startTime;
			const occupiedCount = tablesWithState.filter((t) => t.status !== "free").length;
			console.log(`[COUNTER] État calculé (${elapsed}ms): ${occupiedCount}/${tables.length} tables occupées`);

			res.status(200).json({
				tables: tablesWithState,
				activeSessions: activeSessions.length,
			});
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] GET /tables ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * GET /counter/stats/:restaurantId
 * Récupérer les stats caisse du jour (tables en cours + tables payées)
 */
router.get(
	"/stats/:restaurantId",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { restaurantId } = req.params;

			if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
				return res.status(400).json({ message: "restaurantId invalide" });
			}

			console.log(`[COUNTER] GET /stats/${restaurantId}`);

			// ✅ Début de la journée (00h00)
			const today = new Date();
			today.setHours(0, 0, 0, 0);

			// ✅ FIX CRITIQUE : Convertir restaurantId en ObjectId
			const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);

			// ✅ Sessions en cours (non fermées)
			const enCoursSessionsRaw = await TableSession.find({
				restaurantId: restaurantObjectId,
				source: "counter",
				billStatus: { $ne: "closed" },
			})
				.populate("tableId", "number")
				.populate("restaurantId", "name")
				.populate("serverId", "name serverId");

			// ✅ Sessions fermées aujourd'hui
			const payeesSessionsRaw = await TableSession.find({
				restaurantId: restaurantObjectId,
				source: "counter",
				billStatus: "closed",
				closedAt: { $gte: today },
			})
				.populate("tableId", "number")
				.populate("restaurantId", "name")
				.populate("serverId", "name serverId");

			// ✅ OPTIMISATION : 1 seule aggregation Order au lieu de N queries
			const allSessionIds = [
				...enCoursSessionsRaw.map((s) => s._id),
				...payeesSessionsRaw.map((s) => s._id),
			];

			const ordersGrouped = await Order.aggregate([
				{
					$match: {
						tableSessionId: { $in: allSessionIds },
						source: "counter",
						orderStatus: { $ne: "cancelled" },
					},
				},
				{
					$group: {
						_id: "$tableSessionId",
						totalAmount: { $sum: "$totalAmount" },
					},
				},
			]);

			// ✅ Map orders par sessionId pour lookup O(1)
			const ordersMap = {};
			ordersGrouped.forEach((group) => {
				ordersMap[group._id.toString()] = group.totalAmount;
			});

			// ✅ Enrichir sessions avec montants
			const enCoursSessions = enCoursSessionsRaw.map((session) => ({
				_id: session._id,
				source: "counter", // ✅ Identification mode Comptoir
				tableNumber: session.tableId?.number || "?",
				tableId: session.tableId?._id, // ✅ ID table pour référence
				restaurantId: session.restaurantId, // ✅ Populate avec nom du resto
				totalAmount: ordersMap[session._id.toString()] || 0,
				openedAt: session.openedAt,
				billStatus: session.billStatus,
			}));

			const payeesSessions = payeesSessionsRaw.map((session) => ({
				_id: session._id,
				source: "counter", // ✅ Identification mode Comptoir
				tableNumber: session.tableId?.number || "?",
				tableId: session.tableId?._id, // ✅ ID table pour référence
				restaurantId: session.restaurantId, // ✅ Populate avec nom du resto
				totalAmount: ordersMap[session._id.toString()] || 0,
				closedAt: session.closedAt,
				paymentMethod: session.paymentMethod === "cash" ? "Espèces" : session.paymentMethod === "card_offline" ? "Carte" : "Espèces", // ✅ Traduction lisible
			}));

			const enCoursMontant = enCoursSessions.reduce((sum, s) => sum + s.totalAmount, 0);
			const payeesMontant = payeesSessions.reduce((sum, s) => sum + s.totalAmount, 0);

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Stats calculées (${elapsed}ms): ${enCoursSessions.length} en cours (${enCoursMontant.toFixed(2)}€) | ${payeesSessions.length} payées (${payeesMontant.toFixed(2)}€)`);

			// ✅ Logs CA détaillés (moins verbeux)
			console.log("\n━━━ 💰 CA COMPTOIR ━━━");
			console.log(`📊 En cours : ${enCoursSessions.length} table(s) | ${enCoursMontant.toFixed(2)}€`);
			console.log(`✅ Payées   : ${payeesSessions.length} table(s) | ${payeesMontant.toFixed(2)}€`);
			if (payeesSessions.length > 0) {
				console.log("📋 Détail payées :", payeesSessions.map((s) => `T${s.tableNumber}=${s.totalAmount.toFixed(2)}€`).join(" | "));
			}
			console.log("━━━━━━━━━━━━━━━━━━━━━\n");

			res.status(200).json({
				enCours: {
					count: enCoursSessions.length,
					montant: enCoursMontant,
					sessions: enCoursSessions,
				},
				payees: {
					count: payeesSessions.length,
					montant: payeesMontant,
					sessions: payeesSessions,
				},
			});
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] GET /stats ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	},
);

/**
 * POST /counter/sessions/:id/transfer
 * Transfert de table mid-service (CAS 11)
 */
router.post(
	"/sessions/:id/transfer",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { id } = req.params;
			const { newTableId, reason } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}
			if (!newTableId || !mongoose.Types.ObjectId.isValid(newTableId)) {
				return res.status(400).json({ message: "newTableId invalide" });
			}

			console.log(`[COUNTER] POST /sessions/${id}/transfer: newTableId=${newTableId}`);

			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}
			if (session.billStatus === "closed") {
				return res.status(400).json({ message: "Session déjà fermée" });
			}

			const newTable = await Table.findById(newTableId);
			if (!newTable) {
				return res.status(404).json({ message: "Table cible introuvable" });
			}

			// ✅ Vérifier que nouvelle table est libre
			const existingSession = await TableSession.findOne({
				tableId: newTableId,
				billStatus: { $ne: "closed" },
			});

			if (existingSession) {
				return res.status(409).json({ message: "Table cible déjà occupée" });
			}

			const oldTableId = session.tableId;

			// ✅ Historique du transfert
			session.transferHistory = session.transferHistory || [];
			session.transferHistory.push({
				fromTableId: oldTableId,
				toTableId: newTableId,
				transferredAt: new Date(),
				reason: reason || "Staff request",
			});

			session.tableId = newTableId;
			await session.save({ validateModifiedOnly: true });

			// ✅ Mettre à jour tous les orders liés
			await Order.updateMany({ tableSessionId: session._id }, { tableId: newTableId });

			// ✅ Libérer ancienne table
			if (oldTableId) {
				await Table.findByIdAndUpdate(oldTableId, { status: "available" });
			}

			// ✅ Occuper nouvelle table
			await Table.findByIdAndUpdate(newTableId, { status: "occupied" });

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Transfert effectué (${elapsed}ms): ${oldTableId} → ${newTableId}`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(io, session.restaurantId.toString(), "transferred", session.toObject());
			}

			res.status(200).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] POST /sessions/:id/transfer ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	}
);

/**
 * POST /counter/sessions/:id/split
 * Split bill / addition séparée (CAS 12)
 */
router.post(
	"/sessions/:id/split",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { id } = req.params;
			const { splits } = req.body;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}
			if (!Array.isArray(splits) || splits.length === 0) {
				return res.status(400).json({ message: "Format splits invalide (array requis)" });
			}

			console.log(`[COUNTER] POST /sessions/${id}/split: ${splits.length} parts`);

			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}
			if (session.billStatus === "closed") {
				return res.status(400).json({ message: "Session déjà fermée" });
			}

			// ✅ Valider chaque split
			for (const split of splits) {
				if (!split.amount || split.amount <= 0) {
					return res.status(400).json({ message: "Chaque split doit avoir un amount > 0" });
				}
			}

			session.splitPayments = splits.map((s) => ({
				amount: s.amount,
				orderIds: s.orderIds || [],
				paidAt: s.paidAt || null,
				paymentMethod: s.paymentMethod || null,
			}));

			await session.save({ validateModifiedOnly: true });

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Split créé (${elapsed}ms): ${splits.length} parts pour total=${splits.reduce((sum, s) => sum + s.amount, 0).toFixed(2)}€`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(io, session.restaurantId.toString(), "split_created", session.toObject());
			}

			res.status(200).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] POST /sessions/:id/split ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	}
);

/**
 * POST /counter/sessions/:id/extend
 * Prolongation session / client revient (CAS 14)
 */
router.post(
	"/sessions/:id/extend",
	auth,
	checkRoles(["server", "admin"]),
	async (req, res) => {
		const startTime = Date.now();
		try {
			const { id } = req.params;

			if (!mongoose.Types.ObjectId.isValid(id)) {
				return res.status(400).json({ message: "ID session invalide" });
			}

			console.log(`[COUNTER] POST /sessions/${id}/extend`);

			const session = await TableSession.findById(id);
			if (!session) {
				return res.status(404).json({ message: "Session introuvable" });
			}
			if (session.billStatus !== "closed") {
				return res.status(400).json({ message: "Seule une session fermée peut être prolongée" });
			}

			// ✅ Rouvrir la session
			session.billStatus = "open";
			session.reopenedAt = new Date();
			session.extensionCount = (session.extensionCount || 0) + 1;
			session.status = "active";

			await session.save({ validateModifiedOnly: true });

			const elapsed = Date.now() - startTime;
			console.log(`[COUNTER] Session prolongée (${elapsed}ms): extensionCount=${session.extensionCount}`);

			// ✅ WebSocket sync temps réel
			const io = req.app.locals.io;
			if (io && session.restaurantId) {
				emitTableSessionEvent(io, session.restaurantId.toString(), "extended", session.toObject());
			}

			res.status(200).json(session);
		} catch (err) {
			const elapsed = Date.now() - startTime;
			console.error(`[COUNTER] POST /sessions/:id/extend ERROR (${elapsed}ms):`, err.message);
			res.status(500).json({ message: err.message });
		}
	}
);

module.exports = router;
