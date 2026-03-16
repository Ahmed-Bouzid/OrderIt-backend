// ✅ Démarrage sécurisé du serveur
const express = require("express");
const path = require("path");
const cors = require("cors");
const rateLimiter = require("./middlewares/rateLimiter");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const auth = require("./middlewares/auth");
const {
	secureErrorHandler,
	notFoundHandler,
} = require("./middlewares/secureErrorHandler");
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
const corsOrigins =
	process.env.NODE_ENV !== "production"
		? [
				/^http:\/\/localhost:\d+$/, // Port dynamique localhost
				/^exp:\/\/192\.168\.\d+\.\d+:\d+$/, // Expo dev
				/^http:\/\/192\.168\.\d+\.\d+:\d+$/, // Réseau local
			]
		: [
				"https://sunnygo-frontend.vercel.app",
				"https://orderit-backend-6y1m.onrender.com",
				// ✅ Client public Vercel (toutes les preview URLs + production)
				"https://client-rho-two-46.vercel.app",
				/^https:\/\/client-[a-z0-9-]+-warais-projects\.vercel\.app$/, // Preview deployments
				/^https:\/\/client-[a-z0-9]+\.vercel\.app$/, // Autres previews
				// ✅ AUTORISER EXPO MÊME EN PRODUCTION pour les apps mobiles
				/^exp:\/\/192\.168\.\d+\.\d+:\d+$/, // Expo mobile dev
				/^http:\/\/localhost:\d+$/, // Localhost mobile
			];

app.use(
	cors({
		origin: function (origin, callback) {
			// ✅ TEMPORAIRE: Permettre les requêtes sans origin pour debug
			// if (process.env.NODE_ENV === "production" && !origin) {
			// 	console.error("🚨 CORS: Request sans origin rejetée");
			// 	return callback(new Error("Origin requis en production"));
			// }

			// ✅ SÉCURITÉ: Validation stricte contre liste d'origins autorisées
			const isAllowed = corsOrigins.some((allowedOrigin) => {
				if (typeof allowedOrigin === "string") {
					return allowedOrigin === origin;
				} else if (allowedOrigin instanceof RegExp) {
					return allowedOrigin.test(origin);
				}
				return false;
			});

			if (isAllowed || !origin) {
				callback(null, true);
			} else {
				// ✅ SÉCURITÉ: Log uniquement en développement
				if (process.env.NODE_ENV !== "production") {
					console.error(`🚨 CORS: Origin non autorisé: ${origin}`);
				}
				callback(new Error("Accès refusé par CORS"));
			}
		},
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
	}),
);

app.use(express.json({ limit: "10mb" }));
// Pour les formulaires (si jamais utilisé)
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // 📦 Sert les fichiers statiques (APK, etc.)
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
// app.use("/auth-secure", require("./routes/authSecure")); // 🔐 TODO: Réactiver après test
app.use("/restaurants", require("./routes/restaurants"));
app.use("/orders", auth, require("./routes/orders"));
app.use("/tables", auth, tablesRouter);
app.use("/client-tables", require("./routes/clientTables")); // ⭐ Route publique guests
app.use("/client-orders", require("./routes/clientOrders")); // ⭐ Route publique commandes par réservation
app.use("/client-messages", require("./routes/clientMessages")); // 💬 Route messagerie client → serveur
app.use("/messages", auth, require("./routes/messages")); // 📨 Route messagerie interne manager → serveur
app.use("/servers", require("./routes/servers"));
app.use("/reservations", require("./routes/reservations"));
app.use("/assistant", require("./routes/assistant")); // ⭐ Assistant intelligent réservations
app.use("/ai", require("./routes/ai")); // 🤖 Fonctions IA — créneaux, heatmap, prédiction, liste attente
app.use("/developer", require("./routes/developer")); // 🔧 Routes développeur
app.use("/api/developer", require("./routes/api/developerFeatures")); // 🛠️ Routes gestion fonctionnalités payantes
app.use("/crm", auth, require("./routes/crm")); // 📊 Routes CRM - Performance des équipes
app.use("/accounting", auth, require("./routes/accounting")); // 💰 Routes comptabilité
app.use("/products", auth, require("./routes/products"));
app.use("/products", auth, require("./routes/productOptions")); // ⭐ Routes options produits
app.use("/products", auth, require("./routes/productAllergens")); // ⭐ Routes allergènes produits
app.use("/allergens", require("./routes/allergens")); // ⭐ Routes allergènes
app.use("/payments", auth, require("./routes/payments")); // 💳 Routes Stripe
app.use("/feedback", require("./routes/feedback")); // 🛠️ Routes feedback utilisateurs
app.use("/client-feedback", require("./routes/api/clientFeedback")); // 🌟 Routes feedback clients & avis Google
app.use("/mfa", require("./routes/mfa")); // 🔐 Routes MFA (Multi-Factor Authentication)
app.use("/api/feature-levels", auth, require("./routes/featureLevels")); // 🎚️ Routes niveaux fonctionnels
app.use("/client/token", clientTokenRoutes);
app.use("/client/products", clientProductsRoutes);
app.use("/print", auth, require("./routes/print")); // 🖨️ Impression thermique ESC/POS (Chez Ahmed)
app.use("/api/app", require("./routes/appVersion")); // 📱 Version APK + téléchargement

// ✅ SÉCURITÉ: Middlewares de gestion d'erreurs (TOUJOURS EN DERNIER)
app.use(notFoundHandler); // 404 pour routes non trouvées
app.use(secureErrorHandler); // Gestionnaire d'erreurs sécurisé

// ⚠ N'écoute pas ici, on exporte seulement l'app
module.exports = app;
