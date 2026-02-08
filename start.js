console.log("=== [DEBUG] DEMARRAGE start.js ===");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const app = require("./server");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 3000;

// ⭐ Créer le serveur HTTP avec Socket.io (CORS STRICT)
const server = http.createServer(app);
const io = new Server(server, {
	cors:
		process.env.NODE_ENV !== "production"
			? {
					// Développement : CORS permissif
					origin: "*",
					credentials: true,
					methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
					allowedHeaders: ["Content-Type", "Authorization"],
				}
			: {
					// Production : CORS STRICT (liste blanche)
					origin: [
						"https://sunnygo-frontend.vercel.app", // Frontend production
					"https://orderit-backend-6y1m.onrender.com", // Backend production
						process.env.FRONTEND_URL, // Variable d'environnement
					].filter(Boolean), // Enlever les undefined
					credentials: true,
					methods: ["GET", "POST"],
					allowedHeaders: ["Content-Type", "Authorization"],
				},
	transports: ["websocket", "polling"], // Important : polling en fallback
	allowUpgrades: true,
	pingTimeout: 60000, // Augmente pour Render
	pingInterval: 25000,
	path: "/socket.io/", // ESSENTIEL pour Render
	serveClient: false,
	connectTimeout: 45000,
	perMessageDeflate: false,
});

// ⭐ Enregistrer io dans l'app Express (CRUCIAL pour les routes)
app.set("io", io);

// ⭐ AJOUTE CE LOG IMPORTANT
io.engine.on("connection", (socket) => {
	console.log("🔄 Socket.io engine connection");
});
// ⭐ Middleware d'authentification Socket.io (optionnel pour clients publics)
io.use((socket, next) => {
	const token = socket.handshake.auth.token;

	// ✅ Si pas de token, c'est un client public (non authentifié)
	if (!token) {
		console.log("🔓 Connexion Socket client public (sans token)");
		socket.isPublicClient = true; // Marquer comme client public
		return next();
	}

	// ✅ Si token présent, vérifier et authentifier
	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
		socket.userId = decoded.id;
		socket.restaurantId = decoded.restaurantId;
		socket.userType = decoded.userType;
		socket.isPublicClient = false;
		console.log(
			`🔐 Connexion Socket authentifiée: ${decoded.userType} (${decoded.id})`,
		);
		next();
	} catch (err) {
		console.error("❌ Token Socket invalide:", err.message);
		return next(new Error("Token invalide"));
	}
});

// ⭐ Stockage global des sockets connectées par restaurant
const restaurantConnections = new Map();
const tableConnections = new Map(); // Connexions par table
const missedEvents = new Map(); // Événements manqués par client (replay après reconnexion)

// ⭐ Helper : Enregistrer un événement manqué pour replay
const storeMissedEvent = (socketId, event, data) => {
	if (!missedEvents.has(socketId)) {
		missedEvents.set(socketId, []);
	}
	const events = missedEvents.get(socketId);
	events.push({ event, data, timestamp: Date.now() });

	// Limiter à 50 événements max par client
	if (events.length > 50) {
		events.shift();
	}
};

// ⭐ Helper : Replay des événements manqués
const replayMissedEvents = (socket) => {
	const events = missedEvents.get(socket.id);
	if (!events || events.length === 0) return;

	console.log(
		`📼 Replay de ${events.length} événements manqués pour ${socket.id}`,
	);
	events.forEach(({ event, data }) => {
		socket.emit(event, data);
	});
	missedEvents.delete(socket.id);
};

// ⭐ Gestion des connexions
io.on("connection", (socket) => {
	console.log(
		`✅ Client connecté via Socket.io: ${socket.id} (User: ${socket.userId}, Restaurant: ${socket.restaurantId})`,
	);

	// ============ HEARTBEAT ============
	socket.on("ping", (cb) => {
		if (typeof cb === "function") cb();
	});

	socket.on("client-ping", (data) => {
		socket.emit("server-pong", {
			timestamp: Date.now(),
			clientTimestamp: data?.timestamp,
		});
	});

	// ============ GESTION DES ROOMS ============

	// Joindre la room du restaurant automatiquement
	if (socket.restaurantId) {
		socket.join(`restaurant-${socket.restaurantId}`);
		console.log(
			`🏠 Socket ${socket.id} rejoint room restaurant-${socket.restaurantId}`,
		);

		if (!restaurantConnections.has(socket.restaurantId)) {
			restaurantConnections.set(socket.restaurantId, []);
		}
		restaurantConnections.get(socket.restaurantId).push(socket.id);
	}

	// Joindre une room de restaurant (manuel avec ACK)
	socket.on("join-restaurant", (data, callback) => {
		const { restaurantId } = data;
		if (!restaurantId) {
			if (callback)
				callback({ success: false, error: "restaurantId manquant" });
			return;
		}

		socket.join(`restaurant-${restaurantId}`);
		socket.restaurantId = restaurantId; // Mise à jour
		console.log(
			`🏠 Socket ${socket.id} rejoint room restaurant-${restaurantId}`,
		);

		if (!restaurantConnections.has(restaurantId)) {
			restaurantConnections.set(restaurantId, []);
		}
		if (!restaurantConnections.get(restaurantId).includes(socket.id)) {
			restaurantConnections.get(restaurantId).push(socket.id);
		}

		// Replay des événements manqués
		replayMissedEvents(socket);

		if (callback) callback({ success: true, restaurantId });
	});

	// Quitter une room de restaurant
	socket.on("leave-restaurant", (data) => {
		const { restaurantId } = data;
		if (!restaurantId) return;

		socket.leave(`restaurant-${restaurantId}`);
		console.log(
			`👋 Socket ${socket.id} quitte room restaurant-${restaurantId}`,
		);

		const connections = restaurantConnections.get(restaurantId);
		if (connections) {
			const index = connections.indexOf(socket.id);
			if (index > -1) {
				connections.splice(index, 1);
			}
		}
	});

	// Joindre une room de table (avec ACK)
	socket.on("join-table", (data, callback) => {
		const { restaurantId, tableId } = data;
		if (!restaurantId || !tableId) {
			if (callback)
				callback({ success: false, error: "restaurantId ou tableId manquant" });
			return;
		}

		const roomName = `table-${restaurantId}-${tableId}`;
		socket.join(roomName);
		socket.tableId = tableId; // Mise à jour
		console.log(`🪑 Socket ${socket.id} rejoint room ${roomName}`);

		const key = `${restaurantId}-${tableId}`;
		if (!tableConnections.has(key)) {
			tableConnections.set(key, []);
		}
		if (!tableConnections.get(key).includes(socket.id)) {
			tableConnections.get(key).push(socket.id);
		}

		if (callback) callback({ success: true, tableId });
	});

	// Quitter une room de table
	socket.on("leave-table", (data) => {
		const { restaurantId, tableId } = data;
		if (!restaurantId || !tableId) return;

		const roomName = `table-${restaurantId}-${tableId}`;
		socket.leave(roomName);
		console.log(`👋 Socket ${socket.id} quitte room ${roomName}`);

		const key = `${restaurantId}-${tableId}`;
		const connections = tableConnections.get(key);
		if (connections) {
			const index = connections.indexOf(socket.id);
			if (index > -1) {
				connections.splice(index, 1);
			}
		}
	});

	// Joindre une room de réservation (pour recevoir les mises à jour de messages)
	socket.on("join-reservation", (data, callback) => {
		const { reservationId } = data;
		console.log(`🔍 [DEBUG] join-reservation appelé avec:`, data);
		if (!reservationId) {
			console.warn("⚠️ join-reservation sans reservationId");
			if (callback)
				callback({ success: false, error: "reservationId manquant" });
			return;
		}

		const roomName = `reservation-${reservationId}`;
		socket.join(roomName);
		socket.reservationId = reservationId;
		console.log(`📝 Socket ${socket.id} rejoint room ${roomName}`);
		console.log(
			`🔍 [DEBUG] Total sockets dans ${roomName}:`,
			io.sockets.adapter.rooms.get(roomName)?.size || 0,
		);

		if (callback) callback({ success: true, reservationId });
	});

	// Quitter une room de réservation
	socket.on("leave-reservation", (data) => {
		const { reservationId } = data;
		if (!reservationId) return;

		const roomName = `reservation-${reservationId}`;
		socket.leave(roomName);
		console.log(`👋 Socket ${socket.id} quitte room ${roomName}`);
	});

	// ============ DÉCONNEXION ============
	socket.on("disconnect", (reason) => {
		console.log(`❌ Client déconnecté: ${socket.id} Reason: ${reason}`);

		// Nettoyer les connexions restaurant
		if (socket.restaurantId) {
			const connections = restaurantConnections.get(socket.restaurantId);
			if (connections) {
				const index = connections.indexOf(socket.id);
				if (index > -1) {
					connections.splice(index, 1);
				}
			}
		}

		// Nettoyer les connexions table
		if (socket.tableId && socket.restaurantId) {
			const key = `${socket.restaurantId}-${socket.tableId}`;
			const connections = tableConnections.get(key);
			if (connections) {
				const index = connections.indexOf(socket.id);
				if (index > -1) {
					connections.splice(index, 1);
				}
			}
		}

		// Garder les événements manqués pendant 5 minutes max
		setTimeout(
			() => {
				missedEvents.delete(socket.id);
			},
			5 * 60 * 1000,
		);
	});
});

// ⭐ Exposer io globalement pour les routes
app.locals.io = io;
app.locals.restaurantConnections = restaurantConnections;

// ⭐ Exporter io pour l'utiliser dans les modèles
module.exports.io = io;

const os = require("os");
const { initEmailService } = require("./services/emailService");

function getLocalIp() {
	const interfaces = os.networkInterfaces();
	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name]) {
			if (iface.family === "IPv4" && !iface.internal) {
				return iface.address;
			}
		}
	}
	return "localhost";
}

mongoose
	.connect(process.env.MONGO_URI, {
		serverSelectionTimeoutMS: 10000,
		socketTimeoutMS: 15000,
	})
	.then(async () => {
		console.log("✅ MongoDB connecté");

		// 📧 Initialiser le service email (optionnel, ne bloque pas le démarrage)
		await initEmailService();

		server.listen(port, "0.0.0.0", () => {
			const localIp = getLocalIp();
			console.log(`🚀 Server EasyQR démarré sur http://0.0.0.0:${port}`);
			console.log(`🌐 Accès local: http://${localIp}:${port}`);
			console.log(`🔌 WebSocket prêt sur ws://0.0.0.0:${port}`);
		});
	})
	.catch((err) => {
		console.error("❌ Erreur connexion MongoDB:", err);
	});
