/**
 * setCounterMode.js — Passe un restaurant en serviceMode: "counter"
 *
 * Usage:
 *   node scripts/setCounterMode.js                → liste tous les restaurants
 *   node scripts/setCounterMode.js <restaurantId>  → patch serviceMode → "counter"
 */
require("dotenv").config();
const mongoose = require("mongoose");

const RESTAURANT_ID = process.argv[2];

mongoose
	.connect(process.env.MONGO_URI)
	.then(async () => {
		const db = mongoose.connection.db;
		const col = db.collection("restaurants");

		if (!RESTAURANT_ID) {
			// Mode liste — ne modifie rien
			const list = await col
				.find({}, { projection: { _id: 1, name: 1, serviceMode: 1 } })
				.toArray();
			console.log("\n📋 Restaurants en base :\n");
			list.forEach((r) =>
				console.log(
					`  ${r._id}  |  ${(r.name || "").padEnd(30)}  |  serviceMode: ${r.serviceMode || "(non défini)"}`,
				),
			);
			console.log(
				"\nPour patcher un restaurant :\n  node scripts/setCounterMode.js <restaurantId>\n",
			);
		} else {
			if (!mongoose.Types.ObjectId.isValid(RESTAURANT_ID)) {
				console.error("❌ ID invalide:", RESTAURANT_ID);
				process.exit(1);
			}

			const before = await col.findOne({ _id: new mongoose.Types.ObjectId(RESTAURANT_ID) });
			if (!before) {
				console.error("❌ Restaurant introuvable:", RESTAURANT_ID);
				process.exit(1);
			}

			console.log(`\n🔍 Restaurant trouvé : ${before.name}`);
			console.log(`   serviceMode actuel  : ${before.serviceMode || "(non défini)"}`);

			if (before.serviceMode === "counter") {
				console.log("✅ Déjà en mode counter — aucun changement.");
				process.exit(0);
			}

			const result = await col.updateOne(
				{ _id: new mongoose.Types.ObjectId(RESTAURANT_ID) },
				{ $set: { serviceMode: "counter" } },
			);

			console.log(
				`\n✅ Mis à jour : ${result.modifiedCount} document(s) modifié(s)`
			);
			console.log(`   serviceMode → "counter"\n`);
		}
	})
	.catch((err) => {
		console.error("❌ Connexion MongoDB échouée:", err.message);
		process.exit(1);
	})
	.finally(() => mongoose.disconnect());
