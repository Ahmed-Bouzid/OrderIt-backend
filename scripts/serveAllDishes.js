require("dotenv").config();
const mongoose = require("mongoose");

mongoose
	.connect(process.env.MONGO_URI)
	.then(async () => {
		const db = mongoose.connection.db;
		const id = new mongoose.Types.ObjectId("686af511bb4cba684ff3b72e");

		// 1. Récupérer tous les orderIds des résas de Chez Ahmed
		const resas = await db
			.collection("reservations")
			.find({ restaurantId: id })
			.project({ orderIds: 1 })
			.toArray();

		const allOrderIds = resas.flatMap((r) => r.orderIds || []);
		console.log("Orders trouvés via résas:", allOrderIds.length);

		if (allOrderIds.length === 0) {
			// Fallback : chercher par restaurantId directement sur les orders
			const sample = await db.collection("orders").findOne();
			console.log("Clés order sample:", Object.keys(sample || {}));
		}

		// 2. Marquer orderStatus = "completed" + tous les items.itemStatus = "served"
		const result = await db.collection("orders").updateMany(
			{ _id: { $in: allOrderIds } },
			{
				$set: {
					orderStatus: "completed",
					"items.$[].itemStatus": "served",
				},
			},
		);
		console.log("Orders mis à jour:", result.modifiedCount);

		// 3. Vérification
		const nonCompleted = await db.collection("orders").countDocuments({
			_id: { $in: allOrderIds },
			orderStatus: { $ne: "completed" },
		});
		console.log(
			"Orders non completed restants:",
			nonCompleted,
			nonCompleted === 0 ? "✅ OK" : "⚠️ PROBLÈME",
		);

		await mongoose.disconnect();
	})
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
