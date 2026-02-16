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
		console.log("\n🔍 TEST 1 : Le Grillz (695e4300adde654b80f6911a)");
		const grillz = await Restaurant.findById(grillzId).select(
			"name category styleKey",
		);
		console.log("   Restaurant:", {
			name: grillz.name,
			category: grillz.category,
			styleKey: grillz.styleKey || "NON DÉFINI",
		});

		const grillzStyleKey = grillz.styleKey || "premium";
		const grillzStyle = await Style.findByKey(grillzStyleKey);
		console.log("   Style récupéré:", {
			key: grillzStyle?.key,
			name: grillzStyle?.name,
			hasConfig: !!grillzStyle?.config,
			useCustomHeader: grillzStyle?.config?.useCustomHeader,
			useCustomBackground: grillzStyle?.config?.useCustomBackground,
		});

		// Test 2 : Lacucinadinini
		console.log("\n🔍 TEST 2 : Lacucinadinini (6970ef6594abf8bacd9d804d)");
		const lacucina = await Restaurant.findById(lacucinaId).select(
			"name category styleKey",
		);
		console.log("   Restaurant:", {
			name: lacucina.name,
			category: lacucina.category,
			styleKey: lacucina.styleKey || "NON DÉFINI",
		});

		const lacucinaStyleKey = lacucina.styleKey || "premium";
		const lacucinaStyle = await Style.findByKey(lacucinaStyleKey);
		console.log("   Style récupéré:", {
			key: lacucinaStyle?.key,
			name: lacucinaStyle?.name,
			hasConfig: !!lacucinaStyle?.config,
			useCustomHeader: lacucinaStyle?.config?.useCustomHeader,
			useCustomBackground: lacucinaStyle?.config?.useCustomBackground,
		});

		// Test 3 : Tous les styles disponibles
		console.log("\n📋 STYLES DISPONIBLES EN BDD:");
		const allStyles = await Style.find({ active: true }).select("key name");
		allStyles.forEach((s) => {
			console.log(`   - ${s.key} (${s.name})`);
		});

		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

testConfig();
