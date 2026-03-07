require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const readline = require("readline");

// ⚠️ SCRIPT DE DÉVELOPPEMENT UNIQUEMENT
// NE JAMAIS UTILISER EN PRODUCTION

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function askQuestion(question) {
	return new Promise((resolve) => {
		rl.question(question, resolve);
	});
}

function askPasswordHidden(prompt) {
	return new Promise((resolve) => {
		process.stdout.write(prompt);
		process.stdin.setRawMode(true);
		process.stdin.resume();
		let password = "";

		process.stdin.on("data", (char) => {
			if (char.toString() === "\r" || char.toString() === "\n") {
				process.stdin.setRawMode(false);
				process.stdin.pause();
				process.stdout.write("\n");
				resolve(password);
				return;
			}

			if (char.toString() === "\u007f") {
				// backspace
				if (password.length > 0) {
					password = password.slice(0, -1);
					process.stdout.write("\b \b");
				}
			} else {
				password += char.toString();
				process.stdout.write("*");
			}
		});
	});
}

async function resetPassword() {
	try {

		// Récupérer les données de manière interactive
		const restaurantId = await askQuestion("🏪 ID du restaurant: ");
		const email = await askQuestion("📧 Email de l'admin: ");
		const name = await askQuestion("👤 Nom de l'admin: ");
		const newPassword = await askPasswordHidden(
			"🔑 Nouveau mot de passe (masqué): ",
		);

		// Validation basique
		if (!restaurantId || !email || !newPassword) {
			process.exit(1);
		}

		if (newPassword.length < 8) {
			process.exit(1);
		}

		// Confirmation
		const confirm = await askQuestion(
			`\n⚠️  CONFIRMER: Réinitialiser le mot de passe pour ${email} ? (oui/non): `,
		);
		if (confirm.toLowerCase() !== "oui" && confirm.toLowerCase() !== "yes") {
			process.exit(0);
		}

		await mongoose.connect(process.env.MONGO_URI);

		const db = mongoose.connection.db;

		// Vérifier si un admin existe pour cet email
		const existingAdmin = await db
			.collection("admins")
			.findOne({ email: email });

		const salt = await bcrypt.genSalt(12); // Plus sécurisé
		const hash = await bcrypt.hash(newPassword, salt);

		if (existingAdmin) {
			// Mettre à jour le mot de passe
			await db
				.collection("admins")
				.updateOne({ email: email }, { $set: { passwordHash: hash } });
		} else {
			// Créer un nouvel admin lié au restaurant
			await db.collection("admins").insertOne({
				serverId: `S${Date.now().toString().slice(-4)}`, // ID unique
				name: name,
				email: email,
				passwordHash: hash,
				role: "admin",
				restaurantId: new mongoose.Types.ObjectId(restaurantId),
				createdAt: new Date(),
			});
		}


		await mongoose.disconnect();
		rl.close();
		process.exit(0);
	} catch (err) {
		console.error("❌ Erreur:", err.message);
		rl.close();
		process.exit(1);
	}
}

// Vérification de l'environnement
if (process.env.NODE_ENV === "production") {
	process.exit(1);
}

resetPassword();
