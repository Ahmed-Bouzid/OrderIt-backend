/**
 * 🖼️ Script pour ajouter un champ backgroundImageUrl au modèle Style
 * Permet de stocker des URLs d'images en BDD (Cloudinary, S3, etc.)
 * Usage: node scripts/addBackgroundImage.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Style = require("../models/Style");

/**
 * URLs d'exemples d'images pour chaque style
 * Tu peux remplacer par tes propres images uploadées sur Cloudinary, AWS S3, etc.
 */
const BACKGROUND_IMAGES = {
	italia: {
		url: "https://res.cloudinary.com/ds6aqolxo/image/upload/v1771346715/551988272_17851872288550975_4151156391962741059_n_ffpfwq.jpg",
		alt: "Fond authentique cuisine italienne",
		type: "photo", // "pattern" | "photo" | "gradient"
	},
	grillz: {
		url: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1200", // Burger flammes
		alt: "Fond grill et flammes",
		type: "photo",
	},
	premium: {
		url: null, // Pas d'image, gradient pur
		alt: null,
		type: "gradient",
	},
};

async function addBackgroundImages() {
	try {
		console.log("🔌 Connexion à MongoDB...");
		await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
		console.log("✅ Connecté à MongoDB");

		// Récupérer tous les styles
		const styles = await Style.find({});
		console.log(`\n📋 ${styles.length} styles trouvés`);

		// Mettre à jour chaque style
		for (const style of styles) {
			const bgImage = BACKGROUND_IMAGES[style.key];
			if (bgImage) {
				console.log(`\n🎨 Mise à jour du style: ${style.name} (${style.key})`);

				// Ajouter le champ backgroundImageUrl dans config
				const updatedConfig = {
					...style.config,
					backgroundImageUrl: bgImage.url,
					backgroundImageAlt: bgImage.alt,
					backgroundImageType: bgImage.type,
				};

				await Style.updateOne(
					{ _id: style._id },
					{ $set: { config: updatedConfig } },
				);

				console.log(`   ✅ Image ajoutée: ${bgImage.url || "Aucune"}`);
			} else {
				console.log(`   ⏭️  Aucune image configurée pour ${style.key}`);
			}
		}

		console.log("\n✅ Toutes les images ont été ajoutées !");
		console.log(
			"\n💡 Pour utiliser tes propres images, upload-les sur Cloudinary/S3",
		);
		console.log("   et modifie les URLs dans ce script.");
	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Déconnecté de MongoDB");
	}
}

addBackgroundImages();
