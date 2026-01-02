/**
 * Script d'initialisation des messages prédéfinis
 * À exécuter une fois pour créer les messages par défaut
 *
 * Usage: node scripts/initPredefinedMessages.js <restaurantId>
 */

const mongoose = require("mongoose");
require("dotenv").config();

const PredefinedMessage = require("../models/PredefinedMessage");

const DEFAULT_MESSAGES = [
	// 🍽️ Service
	{
		text: "Pouvons-nous avoir la carte ?",
		category: "service",
		icon: "book-outline",
		order: 1,
	},
	{
		text: "Nous sommes prêts à commander",
		category: "service",
		icon: "hand-left-outline",
		order: 2,
	},
	{
		text: "Pouvons-nous avoir de l'eau ?",
		category: "service",
		icon: "water-outline",
		order: 3,
	},
	{
		text: "Pouvons-nous avoir du pain ?",
		category: "service",
		icon: "nutrition-outline",
		order: 4,
	},
	{
		text: "Avez-vous des recommandations ?",
		category: "service",
		icon: "star-outline",
		order: 5,
	},
	{
		text: "Pouvons-nous avoir des couverts supplémentaires ?",
		category: "service",
		icon: "restaurant-outline",
		order: 6,
	},
	{
		text: "Pouvons-nous avoir des serviettes ?",
		category: "service",
		icon: "layers-outline",
		order: 7,
	},

	// 🛒 Commande
	{
		text: "Notre commande met du temps",
		category: "commande",
		icon: "time-outline",
		order: 10,
	},
	{
		text: "Nous voudrions modifier notre commande",
		category: "commande",
		icon: "create-outline",
		order: 11,
	},
	{
		text: "Il manque un plat dans notre commande",
		category: "commande",
		icon: "alert-circle-outline",
		order: 12,
	},
	{
		text: "Un plat n'est pas conforme",
		category: "commande",
		icon: "warning-outline",
		order: 13,
	},

	// 💳 Paiement
	{
		text: "Nous voudrions l'addition",
		category: "paiement",
		icon: "receipt-outline",
		order: 20,
	},
	{
		text: "Pouvons-nous payer en plusieurs fois ?",
		category: "paiement",
		icon: "card-outline",
		order: 21,
	},
	{
		text: "Acceptez-vous les tickets restaurant ?",
		category: "paiement",
		icon: "ticket-outline",
		order: 22,
	},

	// 📍 Autre
	{
		text: "Où sont les toilettes ?",
		category: "autre",
		icon: "location-outline",
		order: 30,
	},
	{
		text: "Y a-t-il un accès PMR ?",
		category: "autre",
		icon: "accessibility-outline",
		order: 31,
	},
	{
		text: "Merci pour le service !",
		category: "autre",
		icon: "heart-outline",
		order: 32,
	},
];

async function initMessages(restaurantId) {
	try {
		// Connexion MongoDB
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		// Vérifier si des messages existent déjà
		const existingCount = await PredefinedMessage.countDocuments({
			restaurantId,
		});
		if (existingCount > 0) {
			console.log(
				`⚠️ ${existingCount} messages existent déjà pour ce restaurant`
			);
			const answer = await askQuestion("Voulez-vous les remplacer ? (y/n): ");
			if (answer.toLowerCase() !== "y") {
				console.log("❌ Annulé");
				process.exit(0);
			}
			await PredefinedMessage.deleteMany({ restaurantId });
			console.log("🗑️ Messages existants supprimés");
		}

		// Créer les messages avec le restaurantId
		const messages = DEFAULT_MESSAGES.map((msg) => ({
			...msg,
			restaurantId,
		}));

		await PredefinedMessage.insertMany(messages);
		console.log(
			`✅ ${messages.length} messages prédéfinis créés pour le restaurant ${restaurantId}`
		);

		// Afficher un résumé par catégorie
		const byCategory = messages.reduce((acc, msg) => {
			acc[msg.category] = (acc[msg.category] || 0) + 1;
			return acc;
		}, {});
		console.log("\n📊 Résumé par catégorie:");
		Object.entries(byCategory).forEach(([cat, count]) => {
			console.log(`   ${cat}: ${count} messages`);
		});
	} catch (error) {
		console.error("❌ Erreur:", error.message);
	} finally {
		await mongoose.disconnect();
		process.exit(0);
	}
}

function askQuestion(question) {
	const readline = require("readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

// Exécution
const restaurantId = process.argv[2];
if (!restaurantId) {
	console.error(
		"❌ Usage: node scripts/initPredefinedMessages.js <restaurantId>"
	);
	process.exit(1);
}

initMessages(restaurantId);
