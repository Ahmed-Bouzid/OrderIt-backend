require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const restaurantId = "6970ef6594abf8bacd9d804d";
const email = "contact@cucina.com";
const newPassword = "Cucina2026!";

async function resetPassword() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		const db = mongoose.connection.db;

		// Vérifier si un admin existe pour cet email
		const existingAdmin = await db
			.collection("admins")
			.findOne({ email: email });

		const salt = await bcrypt.genSalt(10);
		const hash = await bcrypt.hash(newPassword, salt);

		if (existingAdmin) {
			// Mettre à jour le mot de passe
			await db
				.collection("admins")
				.updateOne({ email: email }, { $set: { passwordHash: hash } });
			console.log("✅ Mot de passe admin mis à jour!");
		} else {
			// Créer un nouvel admin lié au restaurant
			await db.collection("admins").insertOne({
				serverId: "S0099",
				name: "Lacucinadinini",
				email: email,
				passwordHash: hash,
				role: "admin",
				restaurantId: new mongoose.Types.ObjectId(restaurantId),
				createdAt: new Date(),
			});
			console.log("✅ Nouvel admin créé et lié au restaurant!");
		}

		console.log("");
		console.log("📧 Email:", email);
		console.log("🔑 Mot de passe:", newPassword);
		console.log("");
		console.log("Tu peux maintenant te connecter !");

		await mongoose.disconnect();
		process.exit(0);
	} catch (err) {
		console.error("❌ Erreur:", err.message);
		process.exit(1);
	}
}

resetPassword();
