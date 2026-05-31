/**
 * setAdminBaghera.js
 *
 * Crée ou met à jour le compte admin du restaurant Baghera.
 * Role : "admin" (accès complet : dashboard, Z de caisse, CRM, comptabilité…)
 *
 * Restaurant : Baghera — 29 Grand Rue, 13002 Marseille
 * _id        : 6a0381c865b4fbf2f219e0f0
 *
 * Usage :
 *   cd backend
 *   node scripts/setAdminBaghera.js
 *
 * Option :
 *   --reset-password   Force le recalcul du hash même si le compte existe déjà
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt   = require("bcrypt");
const Server   = require("../models/Server");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const RESTAURANT_ID   = new mongoose.Types.ObjectId("6a0381c865b4fbf2f219e0f0");
const RESET_PASSWORD  = process.argv.includes("--reset-password");

const ADMIN = {
	name:     "Admin Baghera",
	email:    "admin@baghera.fr",
	serverId: "baghera-admin",
	password: "Baghera@Admin2026!",
	role:     "admin",
};

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
	const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
	if (!mongoUri) {
		console.error("❌ MONGO_URI ou MONGODB_URI non défini dans .env");
		process.exit(1);
	}

	console.log("Connexion à MongoDB...");
	await mongoose.connect(mongoUri, {
		serverSelectionTimeoutMS: 15_000,
		socketTimeoutMS:          20_000,
	});
	console.log(`✅ Connecté — Restaurant Baghera (${RESTAURANT_ID})\n`);

	const existing = await Server.findOne({ email: ADMIN.email });

	if (existing) {
		// ── Mise à jour du rôle + restaurantId ──────────────────────────
		existing.role         = "admin";
		existing.restaurantId = RESTAURANT_ID;

		if (RESET_PASSWORD) {
			existing.passwordHash = await bcrypt.hash(ADMIN.password, 10);
			console.log("  🔑 Mot de passe réinitialisé");
		}

		await existing.save();
		console.log(`✅ Compte mis à jour → role: admin  (id: ${existing._id})`);
	} else {
		// ── Création du compte ───────────────────────────────────────────
		const passwordHash = await bcrypt.hash(ADMIN.password, 10);

		const doc = await Server.create({
			restaurantId: RESTAURANT_ID,
			serverId:     ADMIN.serverId,
			name:         ADMIN.name,
			email:        ADMIN.email,
			passwordHash,
			authProvider: "local",
			role:         "admin",
		});

		console.log(`✅ Compte admin créé  (id: ${doc._id})`);
	}

	console.log(`
  ┌──────────────────────────────────────────┐
  │  Compte admin Baghera                    │
  │  Email    : ${ADMIN.email.padEnd(28)} │
  │  ServerId : ${ADMIN.serverId.padEnd(28)} │
  │  Role     : admin                        │
  │  Password : ${ADMIN.password.padEnd(28)} │
  └──────────────────────────────────────────┘
`);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("❌ Erreur :", err.message);
	process.exit(1);
});
