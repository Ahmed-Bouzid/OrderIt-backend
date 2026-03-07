/**
 * 🔧 Script de migration : Ajouter isMade=false à toutes les commandes existantes
 * À lancer UNE SEULE FOIS après le déploiement du nouveau modèle
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/Order");

async function addIsMadeField() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		// Compter les commandes sans le champ isMade
		const ordersWithoutField = await Order.countDocuments({
			isMade: { $exists: false },
		});


		if (ordersWithoutField === 0) {
			return;
		}


		// Ajouter isMade: false à toutes les commandes qui n'ont pas le champ
		const result = await Order.updateMany(
			{ isMade: { $exists: false } },
			{ $set: { isMade: false } },
		);

	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
	}
}

addIsMadeField();
