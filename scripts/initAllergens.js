// Script d'initialisation des allergènes par défaut

const allergens = [
	{
		name: "Gluten",
		description: "Céréales contenant du gluten",
		icon: "🌾",
	},
	{
		name: "Crustacés",
		description: "Crustacés et produits à base de crustacés",
		icon: "🦐",
	},
	{
		name: "Œufs",
		description: "Œufs et produits à base d'œufs",
		icon: "🥚",
	},
	{
		name: "Poissons",
		description: "Poissons et produits à base de poissons",
		icon: "🐟",
	},
	{
		name: "Arachides",
		description: "Arachides et produits à base d'arachides",
		icon: "🥜",
	},
	{
		name: "Soja",
		description: "Soja et produits à base de soja",
		icon: "🫘",
	},
	{
		name: "Lait",
		description: "Lait et produits à base de lait (lactose inclus)",
		icon: "🥛",
	},
	{
		name: "Fruits à coque",
		description: "Amandes, noisettes, noix, cajou, etc.",
		icon: "🌰",
	},
	{
		name: "Céleri",
		description: "Céleri et produits à base de céleri",
		icon: "🥬",
	},
	{
		name: "Moutarde",
		description: "Moutarde et produits à base de moutarde",
		icon: "🟡",
	},
	{
		name: "Graines de sésame",
		description: "Graines de sésame et produits dérivés",
		icon: "🌰",
	},
	{
		name: "Sulfites",
		description: "Anhydride sulfureux et sulfites (>10mg/kg)",
		icon: "⚗️",
	},
	{
		name: "Lupin",
		description: "Lupin et produits à base de lupin",
		icon: "🌸",
	},
	{
		name: "Mollusques",
		description: "Mollusques et produits à base de mollusques",
		icon: "🦪",
	},
];

// Pour initialiser les allergènes, exécutez ce script avec:
// node backend/scripts/initAllergens.js

const mongoose = require("mongoose");
require("dotenv").config();

mongoose
	.connect(process.env.MONGO_URI)
	.then(async () => {
		console.log("✅ Connecté à MongoDB");
		const Allergen = require("../models/Allergen");

		for (const allergen of allergens) {
			const existing = await Allergen.findOne({ name: allergen.name });
			if (!existing) {
				await Allergen.create(allergen);
				console.log(`✅ Allergène créé: ${allergen.name}`);
			} else {
				console.log(`⏭️  Allergène existe déjà: ${allergen.name}`);
			}
		}

		console.log("\n✅ Initialisation terminée!");
		process.exit(0);
	})
	.catch((err) => {
		console.error("❌ Erreur:", err);
		process.exit(1);
	});
