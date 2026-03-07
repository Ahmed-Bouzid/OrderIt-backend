/**
 * Script pour mettre à jour Le Grillz en catégorie "foodtruck"
 * Usage: node scripts/updateGrillzCategory.js
 */

const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");

async function updateGrillz() {
	try {
		// Connexion MongoDB
		const mongoUri =
			process.env.MONGODB_URI || "mongodb://localhost:27017/sunnygo";
		await mongoose.connect(mongoUri);

		// Mise à jour Le Grillz
		const result = await Restaurant.findByIdAndUpdate(
			"695e4300adde654b80f6911a",
			{ category: "foodtruck" },
			{ new: true },
		);

		if (result) {
		} else {
			console.error("❌ Restaurant non trouvé");
		}

		await mongoose.connection.close();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

updateGrillz();
