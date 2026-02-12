/**
 * 🔧 Script de migration : Ajouter isMade=false à toutes les commandes existantes
 * À lancer UNE SEULE FOIS après le déploiement du nouveau modèle
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/Order");

async function addIsMadeField() {
	try {
		console.log("🔌 Connexion à MongoDB...");
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté\n");

		// Compter les commandes sans le champ isMade
		const ordersWithoutField = await Order.countDocuments({
			isMade: { $exists: false },
		});

		console.log(
			`📊 Commandes sans champ isMade: ${ordersWithoutField}\n`,
		);

		if (ordersWithoutField === 0) {
			console.log("✅ Aucune commande à mettre à jour");
			return;
		}

		console.log("⏳ Mise à jour en cours...");

		// Ajouter isMade: false à toutes les commandes qui n'ont pas le champ
		const result = await Order.updateMany(
			{ isMade: { $exists: false } },
			{ $set: { isMade: false } },
		);

		console.log(`✅ ${result.modifiedCount} commandes mises à jour\n`);
		console.log("🎉 Migration terminée avec succès");
	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Déconnecté de MongoDB");
	}
}

addIsMadeField();
