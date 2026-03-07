#!/usr/bin/env node
/**
 * Script pour réimporter le menu de La Boucle avec support des options
 * Usage: node reimport-menu.js
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const Product = require("./models/Product");

const RESTAURANT_ID = "69a035934b395eaaba6b8d21"; // La Boucle
const MENU_FILE = path.join(__dirname, "menuBoucle.json");

async function reimportMenu() {
	try {
		// Connexion MongoDB
		await mongoose.connect(process.env.MONGO_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});

		// Charger le menu
		const menu = JSON.parse(fs.readFileSync(MENU_FILE, "utf8"));

		// Archiver l'ancien menu
		const archivedResult = await Product.updateMany(
			{ restaurantId: RESTAURANT_ID },
			{ $set: { archived: true, available: false } },
		);

		let totalImported = 0;
		const errors = [];

		// Importer les nouveaux produits avec options
		for (const categoryData of menu) {
			const { category, items } = categoryData;

			if (!category || !Array.isArray(items)) {
				errors.push({
					category: category || "unknown",
					error: "Format invalide",
				});
				continue;
			}

			for (const item of items) {
				try {
					const { name, price, description, options } = item;

					if (!name || typeof price !== "number") {
						errors.push({
							item: name || "unknown",
							error: "Nom ou prix manquant",
						});
						continue;
					}

					// Transformer options si présentes
					let processedOptions = [];
					if (Array.isArray(options) && options.length > 0) {
						processedOptions = options.map((option, idx) => ({
							id: option.id || `opt-${idx}`,
							name: option.name || "",
							description: option.description || "",
							required: option.required ?? true,
							multiSelect: option.multiSelect ?? false,
							available: option.available ?? true,
							choices: Array.isArray(option.choices)
								? option.choices.map((choice, cidx) => ({
										id: choice.id || `choice-${cidx}`,
										name: choice.name || "",
										description: choice.description || "",
										priceAdjustment: choice.priceAdjustment || choice.price || 0,
										available: choice.available ?? true,
									}))
								: [],
						}));
					}

					const product = await Product.create({
						restaurantId: RESTAURANT_ID,
						name: name.trim(),
						description: description?.trim() || "",
						price: price,
						category: category.trim(),
						available: true,
						archived: false,
						options: processedOptions,
					});

					totalImported++;

					// Log si le produit a des options
					if (processedOptions.length > 0) {
					}
				} catch (error) {
					console.error(`❌ Erreur import item ${item.name}:`, error.message);
					errors.push({
						item: item.name,
						error: error.message,
					});
				}
			}
		}


		if (errors.length > 0) {
			errors.slice(0, 5).forEach((err) => {
			});
		}

		// Vérifier les produits avec options
		const productsWithOptions = await Product.countDocuments({
			restaurantId: RESTAURANT_ID,
			"options.0": { $exists: true },
		});

		// Afficher quelques exemples
		const examples = await Product.find(
			{
				restaurantId: RESTAURANT_ID,
				"options.0": { $exists: true },
			},
			"name options",
		).limit(3);

		if (examples.length > 0) {
			examples.forEach((prod) => {
				prod.options.forEach((opt) => {
				});
			});
		}

		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	}
}

reimportMenu();
