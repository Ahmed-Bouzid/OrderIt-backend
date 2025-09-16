require("dotenv").config();
const mongoose = require("mongoose");
const app = require("./server");

const port = process.env.PORT || 3000;

mongoose
	.connect(process.env.MONGO_URI, {
		serverSelectionTimeoutMS: 10000,
		socketTimeoutMS: 15000,
	})
	.then(() => {
		console.log("✅ MongoDB connecté");
		app.listen(port, "0.0.0.0", () => {
			console.log(`🚀 Serveur EasyQR démarré sur http://0.0.0.0:${port}`);
		});
	})
	.catch((err) => {
		console.error("❌ Erreur connexion MongoDB:", err);
	});
