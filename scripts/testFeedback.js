const Feedback = require("../models/Feedback");
const mongoose = require("mongoose");

/**
 * Script d'initialisation pour tester le système de feedback
 * Usage: node scripts/testFeedback.js
 */

async function testFeedback() {
	try {

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


		// Récupérer tous les feedbacks
		const allFeedbacks = await Feedback.find({})
			.sort({ createdAt: -1 })
			.limit(5);

		allFeedbacks.forEach((fb, index) => {
		});


		// Supprimer le feedback de test
		await Feedback.findByIdAndDelete(testFeedback._id);
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
		return testFeedback();
	})
	.then(() => {
		mongoose.connection.close();
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Erreur de connexion MongoDB:", error);
		process.exit(1);
	});
