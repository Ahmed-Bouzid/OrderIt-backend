console.log("=== [DEBUG] DEMARRAGE server.js ===");
console.log("=== DEMARRAGE SERVER.JS ===");
const express = require("express");
const cors = require("cors");
const rateLimiter = require("./middlewares/rateLimiter");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const auth = require("./middlewares/auth");
const clientTokenRoutes = require("./routes/clientToken");
const clientProductsRoutes = require("./routes/clientProducts");
const enforceHttps = require("./middlewares/enforceHttps");

// Création de l'app
const app = express();

// 🌐 Trust proxy pour Render/Heroku (derrière 1 proxy uniquement)
// CRITIQUE pour rate limiting derrière reverse proxy
// 1 = fait confiance au premier proxy seulement (sécurisé)
app.set("trust proxy", 1);

// 🔒 Forcer HTTPS en production (AVANT tout autre middleware)
app.use(enforceHttps);

// CORS strict pour Expo, localhost, Render, Vercel
app.use(
	cors(
		process.env.NODE_ENV !== "production"
			? {
					origin: true, // Autorise toutes les origines en dev
					credentials: true,
					methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
					allowedHeaders: ["Content-Type", "Authorization"],
				}
			: {
					origin: [
						"http://localhost:8081",
						"exp://192.168.*.*:8081",
						"http://localhost:3000",
						"https://sunnygo-frontend.vercel.app",
						"https://sunnygo-backend-6y1m.onrender.com",
					],
					credentials: true,
					methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
					allowedHeaders: ["Content-Type", "Authorization"],
				},
	),
);

app.use(express.json({ limit: "10mb" }));
// Pour les formulaires (si jamais utilisé)
app.use(express.urlencoded({ limit: "10mb", extended: true }));
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
app.use("/client-messages", require("./routes/clientMessages")); // 💬 Route messagerie client → serveur
app.use("/servers", require("./routes/servers"));
app.use("/reservations", require("./routes/reservations"));
app.use("/assistant", require("./routes/assistant")); // ⭐ Assistant intelligent réservations
app.use("/developer", require("./routes/developer")); // 🔧 Routes développeur
app.use("/accounting", auth, require("./routes/accounting")); // 💰 Routes comptabilité
app.use("/products", auth, require("./routes/products"));
app.use("/products", auth, require("./routes/productOptions")); // ⭐ Routes options produits
app.use("/products", auth, require("./routes/productAllergens")); // ⭐ Routes allergènes produits
app.use("/allergens", require("./routes/allergens")); // ⭐ Routes allergènes
app.use("/payments", auth, require("./routes/payments")); // 💳 Routes Stripe
app.use("/feedback", require("./routes/feedback")); // 🛠️ Routes feedback utilisateurs
app.use("/mfa", require("./routes/mfa")); // 🔐 Routes MFA (Multi-Factor Authentication)
app.use("/api/feature-levels", auth, require("./routes/featureLevels")); // 🎚️ Routes niveaux fonctionnels
app.use("/client/token", clientTokenRoutes);
app.use("/client/products", clientProductsRoutes);

// ⚠ N'écoute pas ici, on exporte seulement l'app
module.exports = app;
