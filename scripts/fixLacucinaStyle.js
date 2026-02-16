require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");

async function fixLacucina() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const result = await Restaurant.findByIdAndUpdate(
			"6970ef6594abf8bacd9d804d",
			{ styleKey: "premium" },
			{ new: true },
		).select("name category styleKey");

		console.log("\n✅ Lacucinadinini mis à jour:");
		console.log("   Nom:", result.name);
		console.log("   Catégorie:", result.category);
		console.log("   Style:", result.styleKey);
		console.log("   ID:", result._id);

		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

fixLacucina();
