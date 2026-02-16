require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");

async function check() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const grillz = await Restaurant.findById("695e4300adde654b80f6911a").select(
			"name email category styleKey",
		);
		const lacucina = await Restaurant.findById(
			"6970ef6594abf8bacd9d804d",
		).select("name email category styleKey");

		console.log("\n🔍 Restaurant Le Grillz:");
		console.log("   ID:", "695e4300adde654b80f6911a");
		console.log("   Nom:", grillz?.name);
		console.log("   Style:", grillz?.styleKey);
		console.log("   Catégorie:", grillz?.category);

		console.log("\n🔍 Restaurant Lacucinadinini:");
		console.log("   ID:", "6970ef6594abf8bacd9d804d");
		console.log("   Nom:", lacucina?.name);
		console.log("   Style:", lacucina?.styleKey);
		console.log("   Catégorie:", lacucina?.category);

		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

check();
