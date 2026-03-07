require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");
const Style = require("../models/Style");

async function testConfig() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const grillzId = "695e4300adde654b80f6911a";
		const lacucinaId = "6970ef6594abf8bacd9d804d";

		// Test 1 : Grillz
		const grillz = await Restaurant.findById(grillzId).select(
			"name category styleKey",
		);

		const grillzStyleKey = grillz.styleKey || "premium";
		const grillzStyle = await Style.findByKey(grillzStyleKey);

		// Test 2 : Lacucinadinini
		const lacucina = await Restaurant.findById(lacucinaId).select(
			"name category styleKey",
		);

		const lacucinaStyleKey = lacucina.styleKey || "premium";
		const lacucinaStyle = await Style.findByKey(lacucinaStyleKey);

		// Test 3 : Tous les styles disponibles
		const allStyles = await Style.find({ active: true }).select("key name");
		allStyles.forEach((s) => {
		});

		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

testConfig();
