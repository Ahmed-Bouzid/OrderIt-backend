/**
 * Helper pour émettre des événements WebSocket
 * Utilisé dans les routes pour notifier les clients
 */

const emitReservationEvent = (io, restaurantId, eventName, data) => {
	io.to(`restaurant-${restaurantId}`).emit("reservation", {
		type: eventName,
		data,
		timestamp: new Date().toISOString(),
	});
	console.log(`📡 Événement reservation envoyé: ${eventName}`);
};

const emitTableEvent = (io, restaurantId, eventName, data) => {
	io.to(`restaurant-${restaurantId}`).emit("table", {
		type: eventName,
		data,
		timestamp: new Date().toISOString(),
	});
	console.log(`📡 Événement table envoyé: ${eventName}`);
};

const emitProductEvent = (io, restaurantId, eventName, data) => {
	io.to(`restaurant-${restaurantId}`).emit("product", {
		type: eventName,
		data,
		timestamp: new Date().toISOString(),
	});
	console.log(`📡 Événement product envoyé: ${eventName}`);
};

const emitOrderEvent = (io, restaurantId, eventName, data) => {
	io.to(`restaurant-${restaurantId}`).emit("order", {
		type: eventName,
		data,
		timestamp: new Date().toISOString(),
	});
	console.log(`📡 Événement order envoyé: ${eventName}`);
};

module.exports = {
	emitReservationEvent,
	emitTableEvent,
	emitProductEvent,
	emitOrderEvent,
};
