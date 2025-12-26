const express = require("express");
const cors = require("cors");
const rateLimiter = require("./middlewares/rateLimiter");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const auth = require("./middlewares/auth");
const clientTokenRoutes = require("./routes/clientToken");
const clientProductsRoutes = require("./routes/clientProducts");

// Création de l'app
const app = express();

// CORS strict pour Expo, localhost, Render, Vercel
app.use(
	cors({
		origin: [
			"http://localhost:8081", // Expo web
			"exp://192.168.*.*:8081", // Expo local
			"http://localhost:3000", // React dev
			"https://orderit-frontend.vercel.app", // Frontend prod (à adapter)
			"https://orderit-backend-6y1m.onrender.com", // Render backend (pour tests)
		],
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
	})
);

app.use(express.json());
app.use(rateLimiter);
app.use(helmet());
app.use(mongoSanitize());
app.use(xss());

// Route test
app.get("/", (req, res) => {
	res.send("API EasyQR fonctionne !");
});

// Route GET /tables/:tableId publique (avant le bloc auth)
const tablesRouter = require("./routes/tables");
app.get("/tables/:tableId", tablesRouter);

// Routes protégées
app.use("/auth", require("./routes/auth"));
app.use("/restaurants", require("./routes/restaurants"));
app.use("/orders", auth, require("./routes/orders"));
app.use("/tables", auth, tablesRouter);
app.use("/client-tables", require("./routes/clientTables")); // ⭐ Route publique guests
app.use("/client-orders", require("./routes/clientOrders")); // ⭐ Route publique commandes par réservation
app.use("/servers", require("./routes/servers"));
app.use("/reservations", require("./routes/reservations"));
app.use("/products", auth, require("./routes/products"));
app.use("/client/token", clientTokenRoutes);
app.use("/client/products", clientProductsRoutes);

// ⚠ N'écoute pas ici, on exporte seulement l'app
module.exports = app;
