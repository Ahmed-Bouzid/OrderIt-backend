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
		origin: [
			"http://localhost:8081", // Expo web
			"exp://192.168.*.*:8081", // Expo local
			"http://localhost:3000", // React dev
			"https://orderit-frontend.vercel.app", // Frontend prod (à adapter)
			"https://orderit-backend-6y1m.onrender.com", // Render backend (pour tests)
		],
		methods: ["GET", "POST"],
		credentials: true,
	},
	transports: ["websocket", "polling"],
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
		`🔌 Client connecté: ${socket.id} (User: ${socket.userId}, Restaurant: ${socket.restaurantId})`
	);

	// Joindre la room du restaurant
	socket.join(`restaurant-${socket.restaurantId}`);

	if (!restaurantConnections.has(socket.restaurantId)) {
		restaurantConnections.set(socket.restaurantId, []);
	}
	restaurantConnections.get(socket.restaurantId).push(socket.id);

	// Déconnexion
	socket.on("disconnect", () => {
		console.log(`🔌 Client déconnecté: ${socket.id}`);
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
