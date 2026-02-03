const Feedback = require("../models/Feedback");
const mongoose = require("mongoose");

/**
 * Script d'initialisation pour tester le système de feedback
 * Usage: node scripts/testFeedback.js
 */

async function testFeedback() {
	try {
		console.log("🧪 Test du système de feedback...\n");

		// Créer un feedback de test
		const testFeedback = new Feedback({
			userId: "TEST_USER_123",
			userName: "Utilisateur Test",
			userRole: "server",
			restaurantId: "TEST_RESTAURANT_456",
			category: "Bug technique",
			message:
				"Ceci est un feedback de test pour vérifier le bon fonctionnement du système.",
			includeLogs: true,
			logs: {
				timestamp: new Date().toISOString(),
				screen: "TestScreen",
				error: "Test Error",
				stack: "Error: Test Error\n    at testFeedback (test.js:1:1)",
				platform: "ios",
				appVersion: "1.0.0",
			},
			timestamp: new Date(),
		});

		await testFeedback.save();

		console.log("✅ Feedback de test créé avec succès !");
		console.log("📋 ID:", testFeedback._id);
		console.log("👤 Utilisateur:", testFeedback.userName);
		console.log("📂 Catégorie:", testFeedback.category);
		console.log("📝 Message:", testFeedback.message);
		console.log("🔧 Logs inclus:", testFeedback.includeLogs);
		console.log("\n");

		// Récupérer tous les feedbacks
		const allFeedbacks = await Feedback.find({})
			.sort({ createdAt: -1 })
			.limit(5);

		console.log("📊 Derniers feedbacks (max 5):");
		allFeedbacks.forEach((fb, index) => {
			console.log(`\n${index + 1}. ${fb.category}`);
			console.log(`   Par: ${fb.userName} (${fb.userRole})`);
			console.log(`   Message: ${fb.message.substring(0, 50)}...`);
			console.log(`   Statut: ${fb.status}`);
			console.log(`   Date: ${fb.createdAt.toLocaleString("fr-FR")}`);
		});

		console.log("\n✅ Test terminé avec succès !");

		// Supprimer le feedback de test
		await Feedback.findByIdAndDelete(testFeedback._id);
		console.log("🧹 Feedback de test supprimé.");
	} catch (error) {
		console.error("❌ Erreur lors du test:", error);
		process.exit(1);
	}
}

// Connexion à MongoDB
const MONGODB_URI =
	process.env.MONGODB_URI || "mongodb://localhost:27017/sunnygo";

mongoose
	.connect(MONGODB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	})
	.then(() => {
		console.log("✅ Connexion MongoDB établie");
		return testFeedback();
	})
	.then(() => {
		mongoose.connection.close();
		console.log("👋 Connexion MongoDB fermée");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Erreur de connexion MongoDB:", error);
		process.exit(1);
	});
