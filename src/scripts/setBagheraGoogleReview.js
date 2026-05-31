/**
 * setBagheraGoogleReview.js
 *
 * Active la redirection vers les avis Google pour le restaurant Baghera.
 * Pattern identique à l'update Cucina du 2026-04-23
 * (cf. SunnyGo-Brain/04-SunnyGo/MongoDB-Update-Cucina-GoogleReview-2026-04-23.md).
 *
 * Restaurant : Baghera — 29 Grand Rue, 13002 Marseille
 * _id        : 6a0381c865b4fbf2f219e0f0
 * Place ID   : ChIJs_OafzjByRIRbQpZxwN1sYw
 *
 * Run:
 *   cd backend
 *   node scripts/setBagheraGoogleReview.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const RESTAURANT_ID = "6a0381c865b4fbf2f219e0f0";
const PLACE_ID = "ChIJs_OafzjByRIRbQpZxwN1sYw";
const REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

mongoose
	.connect(process.env.MONGO_URI)
	.then(async () => {
		const db = mongoose.connection.db;
		const _id = new mongoose.Types.ObjectId(RESTAURANT_ID);

		// 1. PRE check
		const before = await db
			.collection("restaurants")
			.findOne(
				{ _id },
				{ projection: { name: 1, googlePlaceId: 1, googleReviewUrl: 1 } },
			);

		if (!before) {
			console.error("❌ Restaurant introuvable pour _id:", RESTAURANT_ID);
			await mongoose.disconnect();
			process.exit(1);
		}

		console.log("📋 BEFORE:", before);

		// 2. Update
		const result = await db.collection("restaurants").updateOne(
			{ _id },
			{
				$set: {
					googlePlaceId: PLACE_ID,
					googleReviewUrl: REVIEW_URL,
				},
			},
		);

		console.log(
			"✏️  Update:",
			"matched=" + result.matchedCount,
			"modified=" + result.modifiedCount,
		);

		// 3. POST check
		const after = await db
			.collection("restaurants")
			.findOne(
				{ _id },
				{ projection: { name: 1, googlePlaceId: 1, googleReviewUrl: 1 } },
			);

		console.log("✅ AFTER:", after);

		await mongoose.disconnect();
	})
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
