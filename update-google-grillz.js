#!/usr/bin/env node
/**
 * Script pour ajouter les infos Google Avis au restaurant Le Grillz
 *
 * Usage: node update-google-grillz.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Restaurant = require("./models/Restaurant");

// ⭐ CONFIGUREZ ICI VOS INFOS GOOGLE
const RESTAURANT_NAME = "Le Grillz"; // Nom exact dans la BDD
const GOOGLE_PLACE_ID = "0x12c9bf5f0128ffff:0xdc39beff36063e58"; // CID extrait de Google Maps
const GOOGLE_REVIEW_URL =
	"https://search.google.com/local/writereview?placeid=0x12c9bf5f0128ffff:0xdc39beff36063e58";

// 📍 Adresse: 52 Av. Frédéric Mistral, 13013 Marseille (Les Olives)
// 🔗 URL Google Maps: https://www.google.com/maps/place/Le+grill'z+les+olives/@43.3231501,5.4536353,17z

async function updateGoogleInfo() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const restaurant = await Restaurant.findOne({
			name: { $regex: new RegExp(RESTAURANT_NAME, "i") },
		});

		if (!restaurant) {
			console.error(`❌ Restaurant "${RESTAURANT_NAME}" non trouvé`);
			process.exit(1);
		}


		// Mise à jour
		restaurant.googlePlaceId = GOOGLE_PLACE_ID;
		restaurant.googleReviewUrl = GOOGLE_REVIEW_URL;

		await restaurant.save();


	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

updateGoogleInfo();
