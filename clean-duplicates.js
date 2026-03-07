#!/usr/bin/env node
const mongoose = require("mongoose");
require("dotenv").config();
const Product = require("./models/Product");

const RESTAURANT_ID = "69a035934b395eaaba6b8d21";

async function cleanDuplicates() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		// Supprimer DÉFINITIVEMENT tous les anciens produits
		const deleted = await Product.deleteMany({
			restaurantId: RESTAURANT_ID,
			$or: [
				{ archived: true },
				{ archived: { $exists: false } },
				{ available: false },
			],
		});

		// Vérifier ce qui reste
		const remaining = await Product.find({
			restaurantId: RESTAURANT_ID,
		}).select("name archived available options");

		// Vérifier les doublons Menu Enfant
		const menuEnfants = remaining.filter((p) => /Menu Enfant/i.test(p.name));
		menuEnfants.forEach((p, i) => {});

		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	}
}

cleanDuplicates();
