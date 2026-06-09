/**
 * archive-legacy-zreports.js — Phase 4 Migration
 * 
 * Marque tous les Z existants (créés avant migration) comme mode "legacy".
 * Permet de distinguer les Z event-sourced des Z legacy dans l'historique.
 * 
 * Usage :
 *   node scripts/archive-legacy-zreports.js
 * 
 * Sécurité :
 *   - Lecture seule sauf pour le champ generationMode
 *   - Pas de modification des données comptables
 *   - Opération idempotente (peut être relancé sans risque)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const ZReport = require("../src/models/ZReport");

async function main() {
	try {
		console.log("═".repeat(60));
		console.log("  ARCHIVAGE Z LEGACY (Phase 4)");
		console.log("═".repeat(60));
		console.log("");

		// Connexion MongoDB
		const mongoUri = process.env.MONGODB_URI;
		if (!mongoUri) {
			throw new Error("MONGODB_URI manquante dans .env");
		}

		console.log("📡 Connexion à MongoDB...");
		await mongoose.connect(mongoUri);
		console.log("✅ Connecté");
		console.log("");

		// Compter les Z sans generationMode (legacy implicite)
		const legacyCount = await ZReport.countDocuments({
			generationMode: { $exists: false },
		});

		const eventSourcedCount = await ZReport.countDocuments({
			generationMode: "event_sourced",
		});

		const totalCount = await ZReport.countDocuments();

		console.log("📊 État actuel :");
		console.log(`   Total Z rapports      : ${totalCount}`);
		console.log(`   Event-sourced (Phase 2+) : ${eventSourcedCount}`);
		console.log(`   Sans mode (legacy)    : ${legacyCount}`);
		console.log("");

		if (legacyCount === 0) {
			console.log("✅ Aucun Z legacy à archiver. Migration Phase 4 déjà complète.");
			process.exit(0);
		}

		console.log(`⚠️  ${legacyCount} Z rapports vont être marqués comme "legacy"`);
		console.log("");

		// Pause confirmation (5 secondes)
		console.log("⏳ Démarrage dans 5 secondes... (Ctrl+C pour annuler)");
		await new Promise(resolve => setTimeout(resolve, 5000));
		console.log("");

		// Mise à jour en batch
		console.log("🔄 Mise à jour...");
		const result = await ZReport.updateMany(
			{ generationMode: { $exists: false } },
			{ $set: { generationMode: "legacy" } },
		);

		console.log("");
		console.log("═".repeat(60));
		console.log("  RÉSULTAT");
		console.log("═".repeat(60));
		console.log(`✅ ${result.modifiedCount} Z rapports marqués comme "legacy"`);
		console.log(`   Total Z maintenant : ${totalCount}`);
		console.log(`   - Legacy           : ${legacyCount}`);
		console.log(`   - Event-sourced    : ${eventSourcedCount}`);
		console.log("");
		console.log("✅ Phase 4 archivage terminé avec succès !");
		console.log("");

	} catch (err) {
		console.error("");
		console.error("❌ ERREUR :");
		console.error(err);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
		console.log("📡 Déconnecté de MongoDB");
	}
}

main();
