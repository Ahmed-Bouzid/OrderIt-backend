/**
 * Script pour assigner le style "grills" (BBQ) au restaurant Le Grillz
 * Usage: node scripts/assignGrillsStyle.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");
const Style = require("../models/Style");

async function assignGrillsStyle() {
	try {
		// Connexion MongoDB
		const mongoUri = process.env.MONGO_URI;
		await mongoose.connect(mongoUri);

		// Vérifier que le style "grills" existe
		const grillsStyle = await Style.findOne({ key: "grills" });
		if (!grillsStyle) {
			console.error("❌ Style 'grills' non trouvé dans la base");
			await mongoose.connection.close();
			process.exit(1);
		}


		// Mise à jour Le Grillz avec le style grills
		const result = await Restaurant.findOneAndUpdate(
			{ name: "Le Grillz" },
			{ styleKey: "grills" },
			{ new: true },
		);

		if (result) {
		} else {
			console.error("❌ Restaurant 'Le Grillz' non trouvé");
		}

		await mongoose.connection.close();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		await mongoose.connection.close();
		process.exit(1);
	}
}

assignGrillsStyle();
