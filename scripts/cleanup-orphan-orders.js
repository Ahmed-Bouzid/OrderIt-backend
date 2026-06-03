/**
 * cleanup-orphan-orders.js
 *
 * Ferme les orders "pending"/"confirmed" dont la TableSession associée
 * est fermée (status: "closed") ou inexistante.
 *
 * Ces orders continuent à s'afficher dans le floor même après fermeture de session
 * parce que leur orderStatus n'a jamais été mis à "completed" (bug counterService corrigé
 * le 2026-06-03 : mauvais champ "status" au lieu de "orderStatus" dans updateMany).
 *
 * Usage :
 *   node scripts/cleanup-orphan-orders.js             ← dry-run par défaut (sûr)
 *   node scripts/cleanup-orphan-orders.js --apply     ← applique réellement
 *
 * ⚠️  Toujours lancer sans --apply d'abord pour vérifier le nombre de documents.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/Order");
const TableSession = require("../src/models/TableSession");

const APPLY = process.argv.includes("--apply");

async function main() {
	const uri = process.env.MONGO_URI;
	if (!uri) {
		console.error("❌ MONGO_URI manquant dans .env");
		process.exit(1);
	}

	console.log("🔌 Connexion à MongoDB...");
	await mongoose.connect(uri);
	console.log("✅ Connecté\n");

	// 1. Récupérer tous les orders actifs (pending ou confirmed)
	const activeOrders = await Order.find({
		orderStatus: { $in: ["pending", "confirmed"] },
	})
		.select("_id orderStatus tableSessionId tableId createdAt")
		.lean();

	console.log(`📦 Orders actifs (pending/confirmed) : ${activeOrders.length}`);

	const toClose = [];

	for (const order of activeOrders) {
		if (!order.tableSessionId) {
			toClose.push({ order, reason: "no_session" });
			continue;
		}
		const session = await TableSession.findById(order.tableSessionId)
			.select("status")
			.lean();
		if (!session || session.status === "closed") {
			toClose.push({ order, reason: !session ? "session_deleted" : "session_closed" });
		}
	}

	console.log(`\n🗑️  Orders orphelins détectés : ${toClose.length}`);
	toClose.forEach(({ order, reason }) => {
		const date = order.createdAt?.toISOString().slice(0, 10) || "?";
		console.log(
			`  - ${order._id} | table=${order.tableId} | status=${order.orderStatus} | créé=${date} | reason=${reason}`,
		);
	});

	if (toClose.length === 0) {
		console.log("\n✅ Aucun orphan à nettoyer.");
		await mongoose.disconnect();
		return;
	}

	if (!APPLY) {
		console.log(
			"\n⚠️  DRY RUN — aucune modification. Relancer avec --apply pour fermer ces orders.",
		);
		await mongoose.disconnect();
		return;
	}

	const ids = toClose.map(({ order }) => order._id);
	const result = await Order.updateMany(
		{ _id: { $in: ids } },
		{ $set: { orderStatus: "completed" } },
	);

	console.log(`\n✅ ${result.modifiedCount} orders fermés (orderStatus → "completed")`);
	await mongoose.disconnect();
	console.log("🔌 Déconnecté. Terminé.");
}

main().catch((err) => {
	console.error("❌ Erreur :", err);
	process.exit(1);
});
