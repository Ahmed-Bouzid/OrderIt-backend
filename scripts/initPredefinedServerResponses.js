/**
 * Script d'initialisation des réponses serveur prédéfinies
 * À exécuter une fois pour créer les réponses par défaut
 *
 * Usage: node scripts/initPredefinedServerResponses.js [restaurantId]
 * Si restaurantId omis → réponses globales (null)
 */

const mongoose = require("mongoose");
require("dotenv").config();

const PredefinedServerResponse = require("../models/PredefinedServerResponse");

const DEFAULT_RESPONSES = [
	// ✅ Confirmation
	{
		text: "Bien sûr !",
		category: "confirmation",
		icon: "checkmark-circle-outline",
		order: 1,
	},
	{
		text: "J'arrive tout de suite",
		category: "confirmation",
		icon: "walk-outline",
		order: 2,
	},
	{
		text: "C'est noté",
		category: "confirmation",
		icon: "checkmark-done-outline",
		order: 3,
	},
	{
		text: "Pas de problème",
		category: "confirmation",
		icon: "thumbs-up-outline",
		order: 4,
	},

	// ⏳ Délai
	{
		text: "Encore 2 minutes",
		category: "delai",
		icon: "time-outline",
		order: 5,
	},
	{
		text: "Bientôt prêt",
		category: "delai",
		icon: "hourglass-outline",
		order: 6,
	},
	{
		text: "En préparation",
		category: "delai",
		icon: "restaurant-outline",
		order: 7,
	},

	// 🙏 Remerciement
	{
		text: "Merci !",
		category: "remerciement",
		icon: "heart-outline",
		order: 8,
	},
	{
		text: "Bon appétit !",
		category: "remerciement",
		icon: "happy-outline",
		order: 9,
	},

	// 📍 Autre
	{
		text: "Un instant svp",
		category: "autre",
		icon: "hand-right-outline",
		order: 10,
	},
];

async function initResponses() {
	try {
		// Connexion MongoDB
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		const restaurantId = process.argv[2] || null;

		if (restaurantId) {
			console.log(
				`📝 Création des réponses pour le restaurant: ${restaurantId}`,
			);
		} else {
			console.log("📝 Création des réponses globales (restaurantId: null)");
		}

		// Supprimer les anciennes réponses du restaurant (ou globales)
		await PredefinedServerResponse.deleteMany({
			restaurantId: restaurantId || null,
		});

		// Créer les nouvelles réponses
		const responses = DEFAULT_RESPONSES.map((r) => ({
			...r,
			restaurantId: restaurantId || null,
		}));

		await PredefinedServerResponse.insertMany(responses);

		console.log(`✅ ${responses.length} réponses prédéfinies créées`);

		// Stats par catégorie
		const stats = {};
		responses.forEach((r) => {
			stats[r.category] = (stats[r.category] || 0) + 1;
		});

		console.log("\n📊 Résumé par catégorie:");
		Object.entries(stats).forEach(([cat, count]) => {
			console.log(`   ${cat}: ${count} réponses`);
		});

		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	}
}

initResponses();
