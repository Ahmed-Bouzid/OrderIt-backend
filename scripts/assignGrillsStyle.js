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
		console.log("✅ Connecté à MongoDB");

		// Vérifier que le style "grills" existe
		const grillsStyle = await Style.findOne({ key: "grills" });
		if (!grillsStyle) {
			console.error("❌ Style 'grills' non trouvé dans la base");
			await mongoose.connection.close();
			process.exit(1);
		}

		console.log("✅ Style 'grills' trouvé:", grillsStyle.name);

		// Mise à jour Le Grillz avec le style grills
		const result = await Restaurant.findOneAndUpdate(
			{ name: "Le Grillz" },
			{ styleKey: "grills" },
			{ new: true },
		);

		if (result) {
			console.log("\n✅ Restaurant mis à jour:");
			console.log("   Nom:", result.name);
			console.log("   Email:", result.email);
			console.log("   Catégorie:", result.category);
			console.log("   Style:", result.styleKey);
			console.log("   ID:", result._id);
		} else {
			console.error("❌ Restaurant 'Le Grillz' non trouvé");
		}

		await mongoose.connection.close();
		console.log("\n✅ Connexion fermée");
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		await mongoose.connection.close();
		process.exit(1);
	}
}

assignGrillsStyle();
