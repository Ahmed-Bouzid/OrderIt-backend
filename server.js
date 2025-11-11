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

// Middlewares généraux
app.use(express.json());
app.use(rateLimiter);
app.use(helmet());
app.use(mongoSanitize());
app.use(xss());

// Route test
app.get("/", (req, res) => {
	res.send("API EasyQR fonctionne !");
});

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/restaurants", require("./routes/restaurants"));
app.use("/orders", auth, require("./routes/orders"));
app.use("/tables", auth, require("./routes/tables"));
app.use("/servers", require("./routes/servers"));
app.use("/reservations", require("./routes/reservations"));
app.use("/products", auth, require("./routes/products"));
app.use("/client/token", clientTokenRoutes);
app.use("/client/products", clientProductsRoutes);

// ⚠ N'écoute pas ici, on exporte seulement l'app
module.exports = app;
