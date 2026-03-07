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



		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

check();
