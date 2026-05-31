require("dotenv").config();
const mongoose = require("mongoose");

mongoose
	.connect(process.env.MONGO_URI)
	.then(async () => {
		const db = mongoose.connection.db;
		const id = new mongoose.Types.ObjectId("686af511bb4cba684ff3b72e");

		// 1. Trouver toutes les résas cibles
		const resas = await db
			.collection("reservations")
			.find({ restaurantId: id, status: { $in: ["confirmed", "pending"] } })
			.toArray();
		console.log("Résas à traiter:", resas.length);

		// 2. Collecter tous les orderIds
		const allOrderIds = resas.flatMap((r) => r.orderIds || []);
		console.log("Orders liés:", allOrderIds.length);

		// 3. Marquer tous les orders comme paid
		if (allOrderIds.length > 0) {
			const ordersResult = await db
				.collection("orders")
				.updateMany(
					{ _id: { $in: allOrderIds }, paymentStatus: { $ne: "paid" } },
					{ $set: { paymentStatus: "paid", paid: true } },
				);
			console.log("Orders mis à jour:", ordersResult.modifiedCount);
		}

		// 4. Fermer toutes les résas → terminée
		const resaResult = await db
			.collection("reservations")
			.updateMany(
				{ restaurantId: id, status: { $in: ["confirmed", "pending"] } },
				{ $set: { status: "completed", isPresent: false, remainingAmount: 0 } },
			);
		console.log("Résas fermées:", resaResult.modifiedCount);

		// 5. Vérification finale
		const remaining = await db.collection("reservations").countDocuments({
			restaurantId: id,
			status: { $in: ["confirmed", "pending"] },
		});
		console.log(
			"Résas encore ouvertes:",
			remaining,
			remaining === 0 ? "✅ Tout fermé" : "⚠️ PROBLÈME",
		);

		await mongoose.disconnect();
	})
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
