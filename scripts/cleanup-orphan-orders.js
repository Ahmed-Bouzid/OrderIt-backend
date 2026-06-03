/**
 * cleanup-orphan-orders.js
 *
 * Supprime les commandes historiques sans serveur assigné (serverId null/undefined)
 * dont tous les items sont terminés (served/cancelled) OU dont le statut est completed/cancelled.
 *
 * Usage :
 *   DRY_RUN=true node scripts/cleanup-orphan-orders.js    ← compte uniquement, ne supprime rien
 *   node scripts/cleanup-orphan-orders.js                 ← supprime réellement
 *
 * ⚠️  Toujours faire un DRY_RUN d'abord pour vérifier le nombre de documents concernés.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/Order");

const DRY_RUN = process.env.DRY_RUN !== "false";

async function main() {
	const uri = process.env.MONGO_URI;
	if (!uri) {
		console.error("❌ MONGO_URI manquant dans .env");
		process.exit(1);
	}

	console.log(`🔌 Connexion à MongoDB...`);
	await mongoose.connect(uri);
	console.log(`✅ Connecté\n`);

	// Critères : serverId absent/null + commande terminée ou annulée
	const query = {
		$or: [{ serverId: null }, { serverId: { $exists: false } }],
		orderStatus: { $in: ["completed", "cancelled"] },
	};

	const count = await Order.countDocuments(query);

	console.log(`📊 Commandes orphelines terminées/annulées trouvées : ${count}`);

	if (count === 0) {
		console.log("✅ Rien à supprimer (bloc 1).");
	}

	// Aperçu des 5 premiers
	const sample = await Order.find(query)
		.select("_id orderStatus paymentStatus createdAt origin")
		.limit(5)
		.lean();

	console.log("\n📋 Aperçu (5 premiers) :");
	sample.forEach((o) => {
		console.log(
			`  - ${o._id} | status: ${o.orderStatus} | payment: ${o.paymentStatus} | origin: ${o.origin} | créé: ${o.createdAt?.toISOString().slice(0, 10)}`,
		);
	});

	if (DRY_RUN) {
		console.log(
			`\n🔒 DRY_RUN activé → aucune suppression. Relancer avec DRY_RUN=false pour supprimer.`,
		);
	} else {
		console.log(`\n🗑️  Suppression de ${count} documents...`);
		const result = await Order.deleteMany(query);
		console.log(`✅ ${result.deletedCount} documents supprimés.`);
	}

	// --- Bloc 2 : orders pending orphelins (serverId null, antérieurs à aujourd'hui) ---
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const queryPending = {
		$or: [{ serverId: null }, { serverId: { $exists: false } }],
		orderStatus: "pending",
		createdAt: { $lt: today },
	};

	const countPending = await Order.countDocuments(queryPending);
	console.log(`\n📊 Commandes orphelines pending (antérieures à aujourd'hui) : ${countPending}`);

	if (countPending > 0) {
		const samplePending = await Order.find(queryPending)
			.select("_id orderStatus createdAt tableId tableSessionId origin")
			.limit(5)
			.lean();
		console.log("\n📋 Aperçu pending (5 premiers) :");
		samplePending.forEach((o) => {
			console.log(
				`  - ${o._id} | créé: ${o.createdAt?.toISOString().slice(0, 10)} | table: ${o.tableId} | session: ${o.tableSessionId} | origin: ${o.origin}`,
			);
		});

		if (DRY_RUN) {
			console.log(`\n🔒 DRY_RUN activé → aucune suppression des pending.`);
		} else {
			console.log(`\n🗑️  Suppression de ${countPending} orders pending orphelins...`);
			const resultPending = await Order.deleteMany(queryPending);
			console.log(`✅ ${resultPending.deletedCount} documents supprimés.`);
		}
	}

	await mongoose.disconnect();
	console.log("🔌 Déconnecté.");
}

main().catch((err) => {
	console.error("❌ Erreur :", err);
	process.exit(1);
});
