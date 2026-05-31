/**
 * Helper pour émettre des événements WebSocket
 * Utilisé dans les routes pour notifier les clients
 *
 * ✨ NOUVEAU (v2.0):
 * - Support des acknowledgements (ACK) optionnels
 * - Validation stricte des payloads
 * - Logs détaillés avec restaurant_id/user_id
 * - Événement style_applied pour synchronisation en temps réel
 */

/**
 * Valide un payload avant émission
 */
const validatePayload = (eventType, data) => {
	if (!data) {
		throw new Error(`Payload manquant pour ${eventType}`);
	}

	// Vérifications spécifiques par type d'événement
	switch (eventType) {
		case "order":
			if (!data._id && !data.id) {
				console.warn(`⚠️ Commande sans ID:`, data);
			}
			break;
		case "product":
		case "menu_updated":
			if (!data.restaurantId && !data.restaurant_id) {
				console.warn(`⚠️ Produit/Menu sans restaurantId:`, data);
			}
			break;
		case "style_applied":
			if (!data.restaurantId || !data.style_id) {
				throw new Error("style_applied requiert restaurantId + style_id");
			}
			break;
	}

	return true;
};

/**
 * Émet un événement avec payload standardisé
 */
const emitEvent = (
	io,
	restaurantId,
	channel,
	eventType,
	data,
	options = {},
) => {
	try {
		// Validation
		if (!io) {
			throw new Error("Instance Socket.io manquante");
		}
		if (!restaurantId) {
			throw new Error("restaurantId manquant");
		}

		validatePayload(eventType, data);

		// Construction du payload standardisé
		const payload = {
			type: eventType,
			data,
			timestamp: new Date().toISOString(),
			restaurant_id: restaurantId,
			...options, // user_id, table_id, etc.
		};

		// Émission vers la room du restaurant
		const roomName = `restaurant-${restaurantId}`;
		io.to(roomName).emit(channel, payload);


		return true;
	} catch (error) {
		console.error(`❌ Erreur émission ${eventType}:`, error.message);
		return false;
	}
};

/**
 * 📦 Événements de réservation
 */
const emitReservationEvent = (io, restaurantId, eventName, data) => {
	return emitEvent(io, restaurantId, "reservation", eventName, data);
};

/**
 * 🪑 Événements de table
 */
const emitTableEvent = (io, restaurantId, eventName, data, options = {}) => {
	const success = emitEvent(
		io,
		restaurantId,
		"table",
		eventName,
		data,
		options,
	);

	// Émettre aussi vers la room de la table spécifique si table_id fourni
	if (options.table_id) {
		const tableRoomName = `table-${restaurantId}-${options.table_id}`;
		io.to(tableRoomName).emit("table_status_updated", {
			type: eventName,
			data,
			timestamp: new Date().toISOString(),
			table_id: options.table_id,
		});
	}

	return success;
};

/**
 * 🍽️ Événements de produit
 */
const emitProductEvent = (io, restaurantId, eventName, data) => {
	const success = emitEvent(io, restaurantId, "product", eventName, data);

	// Émettre aussi un événement menu_updated global pour le client-end
	if (
		eventName === "product_updated" ||
		eventName === "product_created" ||
		eventName === "product_deleted"
	) {
		io.to(`restaurant-${restaurantId}`).emit("menu_updated", {
			type: eventName,
			data,
			timestamp: new Date().toISOString(),
			restaurant_id: restaurantId,
		});
	}

	return success;
};

/**
 * 📦 Événements de commande
 */
const emitOrderEvent = (io, restaurantId, eventName, data, options = {}) => {
	return emitEvent(io, restaurantId, "order", eventName, data, options);
};

/**
 * 💬 Événements de message client → serveur
 */
const emitClientMessageEvent = (io, restaurantId, eventName, data) => {
	return emitEvent(io, restaurantId, "client-message", eventName, data);
};

/**
 * 📤 Événements de réponse serveur
 */
const emitServerResponseEvent = (io, restaurantId, eventName, data) => {
	return emitEvent(io, restaurantId, "server-response", eventName, data);
};

/**
 * 🔧 Événement changement statut messagerie
 */
const emitMessagingStatusChanged = (io, restaurantId, isEnabled) => {
	return emitEvent(
		io,
		restaurantId,
		"messaging-status-changed",
		"status_changed",
		{
			isEnabled,
		},
	);
};

/**
 * 🎨 Événement de changement de style (NOUVEAU)
 * Notifie tous les clients connectés au restaurant que le style a changé
 *
 * @param {object} io - Instance Socket.io
 * @param {string} restaurantId - ID du restaurant
 * @param {string} styleKey - Clé du nouveau style (ex: "premium", "foodtruck")
 * @param {object} styleConfig - Configuration complète du style { colors, fonts, menuLayout }
 * @param {string} appliedBy - ID de l'utilisateur ayant appliqué le style (optionnel)
 */
const emitStyleAppliedEvent = (
	io,
	restaurantId,
	styleKey,
	styleConfig,
	appliedBy = null,
) => {
	try {
		if (!io || !restaurantId || !styleKey) {
			throw new Error("Paramètres manquants pour emitStyleAppliedEvent");
		}

		const payload = {
			restaurant_id: restaurantId,
			style_id: styleKey,
			config: styleConfig,
			applied_by: appliedBy,
			timestamp: new Date().toISOString(),
		};

		// Validation
		validatePayload("style_applied", payload);

		// Émission vers tous les clients du restaurant
		const roomName = `restaurant-${restaurantId}`;
		io.to(roomName).emit("style_applied", payload);


		return true;
	} catch (error) {
		console.error(`❌ Erreur émission style_applied:`, error.message);
		return false;
	}
};

/**
 * 📊 Événement de mise à jour de stock (NOUVEAU)
 */
const emitStockUpdatedEvent = (io, restaurantId, productId, newStock) => {
	return emitEvent(io, restaurantId, "stock_updated", "stock_changed", {
		product_id: productId,
		stock: newStock,
	});
};

/**
 * 🔔 Notification générique
 */
const emitNotification = (
	io,
	restaurantId,
	title,
	message,
	type = "info",
	options = {},
) => {
	return emitEvent(
		io,
		restaurantId,
		"notification",
		"notification_received",
		{
			title,
			message,
			type, // "info", "success", "warning", "error"
		},
		options,
	);
};

/**
 * 💳 Événement de paiement complété
 * Émet une notification vers le dashboard serveur
 */
const emitPaymentCompleted = (
	io,
	restaurantId,
	{ tableNumber, guestName, amount, orderId, tableId },
) => {
	if (!io) {
		console.warn("⚠️ Socket.io non disponible pour payment-completed");
		return false;
	}

	const roomName = `restaurant-${restaurantId}`;
	const payload = {
		type: "payment_completed",
		data: {
			tableNumber,
			guestName: guestName || "Client",
			amount,
			orderId,
			tableId,
		},
		timestamp: new Date().toISOString(),
		restaurant_id: restaurantId,
	};

	io.to(roomName).emit("payment-completed", payload);

	return true;
};

/**
 * 📊 Événement pour le PaymentsCommandCenter (monitoring temps réel)
 * Émet un événement riche avec toutes les infos nécessaires au dashboard
 */
const emitPaymentMonitorUpdate = (
	io,
	restaurantId,
	{ paymentId, orderId, amount, status, paymentMethod, client, tableNumber, cardBrand, cardLast4, errorMessage },
) => {
	if (!io) {
		console.warn("⚠️ Socket.io non disponible pour payment-monitor");
		return false;
	}

	const roomName = `restaurant-${restaurantId}`;
	const now = new Date();
	const payload = {
		type: "payment_monitor_update",
		data: {
			id: paymentId || `pay_${Date.now()}`,
			orderId: orderId || null,
			amount: typeof amount === "number" ? amount : 0,
			status, // "success", "pending", "failed"
			mode: paymentMethod || "card",
			client: client || tableNumber ? `Table ${tableNumber}` : "Client",
			cardBrand: cardBrand || null,
			cardLast4: cardLast4 || null,
			errorMessage: errorMessage || null,
			timestamp: now.toISOString(),
			timeLabel: now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
		},
		timestamp: now.toISOString(),
		restaurant_id: restaurantId,
	};

	io.to(roomName).emit("payment-monitor", payload);

	return true;
};

/**
 * 🏪 Événements de session table (mode Comptoir)
 */
const emitTableSessionEvent = (io, restaurantId, eventName, data) => {
	return emitEvent(io, restaurantId, "table-session", eventName, data);
};

module.exports = {
	emitReservationEvent,
	emitTableEvent,
	emitProductEvent,
	emitOrderEvent,
	emitClientMessageEvent,
	emitServerResponseEvent, // ⭐ NOUVEAU
	emitMessagingStatusChanged, // ⭐ NOUVEAU
	emitStyleAppliedEvent,
	emitStockUpdatedEvent,
	emitNotification,
	emitPaymentCompleted, // 🔔 Notification paiement
	emitPaymentMonitorUpdate, // 📊 PaymentsCommandCenter temps réel
	emitTableSessionEvent, // 🏪 Événements session table Comptoir
};
