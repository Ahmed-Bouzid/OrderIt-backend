console.log("=== [DEBUG] DEMARRAGE start.js ===");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const app = require("./server");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 3000;

// ⭐ Créer le serveur HTTP avec Socket.io
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*", // Temporairement pour test
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

// ⭐ AJOUTE CE LOG IMPORTANT
io.engine.on("connection", (socket) => {
	console.log("🔄 Socket.io engine connection");
});
// ⭐ Middleware d'authentification Socket.io
io.use((socket, next) => {
	const token = socket.handshake.auth.token;
	if (!token) {
		return next(new Error("Token manquant"));
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
		socket.userId = decoded.id;
		socket.restaurantId = decoded.restaurantId;
		socket.userType = decoded.userType;
		next();
	} catch (err) {
		next(new Error("Token invalide"));
	}
});

// ⭐ Stockage global des sockets connectées par restaurant
const restaurantConnections = new Map();

// ⭐ Gestion des connexions
io.on("connection", (socket) => {
	console.log(
		`✅ Client connecté via Socket.io: ${socket.id} (User: ${socket.userId}, Restaurant: ${socket.restaurantId})`
	);

	// Ping/pong keep-alive agressif pour Render (ancien système)
	socket.on("ping", (cb) => {
		if (typeof cb === "function") cb();
	});

	// ⭐ Nouveau heartbeat custom du client pour maintenir la connexion active
	socket.on("client-ping", (data) => {
		// Répondre au client avec un pong (optionnel, pour monitoring)
		socket.emit("server-pong", {
			timestamp: Date.now(),
			clientTimestamp: data?.timestamp,
		});

		// Log silencieux (décommenter pour debug)
		// console.log(`💓 Heartbeat reçu de ${socket.id} (Restaurant: ${socket.restaurantId})`);
	});

	// Joindre la room du restaurant
	socket.join(`restaurant-${socket.restaurantId}`);

	if (!restaurantConnections.has(socket.restaurantId)) {
		restaurantConnections.set(socket.restaurantId, []);
	}
	restaurantConnections.get(socket.restaurantId).push(socket.id);

	// Déconnexion
	socket.on("disconnect", (reason) => {
		console.log(`❌ Client déconnecté: ${socket.id} Reason: ${reason}`);
		const connections = restaurantConnections.get(socket.restaurantId);
		if (connections) {
			const index = connections.indexOf(socket.id);
			if (index > -1) {
				connections.splice(index, 1);
			}
		}
	});
});

// ⭐ Exposer io globalement pour les routes
app.locals.io = io;
app.locals.restaurantConnections = restaurantConnections;

// ⭐ Exporter io pour l'utiliser dans les modèles
module.exports.io = io;

const os = require("os");

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
	.then(() => {
		console.log("✅ MongoDB connecté");
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
