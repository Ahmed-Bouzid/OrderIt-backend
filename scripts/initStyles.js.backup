/**
 * Script d'initialisation des styles système
 * Crée les styles par défaut : Premium, Foodtruck, Grills
 * Usage: node backend/scripts/initStyles.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Style = require("../models/Style");

const SYSTEM_STYLES = [
	{
		name: "Style Premium",
		key: "premium",
		description:
			"Style élégant pour restaurants standard - Dégradés violet/mauve, glassmorphism, animations fluides",
		suitableFor: ["restaurant", "cafe", "boulangerie"],
		isSystem: true,
		config: {
			primary: ["#667eea", "#764ba2"],
			secondary: ["#f093fb", "#f5576c"],
			accent: ["#4facfe", "#00f2fe"],
			success: ["#11998e", "#38ef7d"],
			warning: ["#f2994a", "#f2c94c"],
			dark: ["#0f0c29", "#302b63", "#24243e"],
			background: ["#0f0c29", "#302b63", "#24243e"],
			text: "#ffffff",
			textMuted: "rgba(255, 255, 255, 0.7)",
			glass: "rgba(255, 255, 255, 0.15)",
			glassBorder: "rgba(255, 255, 255, 0.25)",
			menuLayout: "grid",
			fontFamily: "System",
			cardStyle: "glassmorphism",
			buttonStyle: "gradient",
			animationSpeed: "smooth",
		},
	},
	{
		name: "Style Foodtruck",
		key: "foodtruck",
		description:
			"Style énergique pour food trucks - Orange/rouge vif, design direct, accent sur la rapidité",
		suitableFor: ["foodtruck", "snack", "bar"],
		isSystem: true,
		config: {
			primary: ["#ff9800", "#ff6f00"],
			secondary: ["#ffb347", "#ffcc33"],
			accent: ["#ff512f", "#dd2476"],
			success: ["#ff9800", "#ff6f00"],
			dark: ["#181818", "#232526"],
			background: ["#181818", "#232526"],
			text: "#ffffff",
			textMuted: "rgba(255, 255, 255, 0.7)",
			glass: "rgba(255, 255, 255, 0.1)",
			glassBorder: "rgba(255, 255, 255, 0.18)",
			menuLayout: "grid",
			fontFamily: "System",
			cardStyle: "solid",
			buttonStyle: "gradient",
			animationSpeed: "fast",
		},
	},
	{
		name: "Style Grills",
		key: "grills",
		description:
			"Style sombre pour grillades - Dégradé noir/rouge/orange, ambiance barbecue urbain",
		suitableFor: ["foodtruck", "restaurant", "bar"],
		isSystem: true,
		config: {
			primary: ["#181818", "#ff512f", "#ff9800"],
			secondary: ["#ff9800", "#ff512f"],
			accent: ["#ff512f", "#ff9800"],
			success: ["#22c55e", "#16a34a"],
			dark: ["#181818", "#232526"],
			background: ["#181818", "#232526"],
			text: "#ffffff",
			textMuted: "rgba(255, 255, 255, 0.7)",
			glass: "rgba(255, 255, 255, 0.1)",
			glassBorder: "rgba(255, 255, 255, 0.18)",
			menuLayout: "grid",
			fontFamily: "System",
			cardStyle: "solid",
			buttonStyle: "gradient",
			animationSpeed: "smooth",
		},
	},
	{
		name: "Style Moderne",
		key: "modern",
		description:
			"Style contemporain minimaliste - Bleu/cyan, design épuré, typographie moderne",
		suitableFor: ["restaurant", "cafe"],
		isSystem: true,
		config: {
			primary: ["#3b82f6", "#2563eb"],
			secondary: ["#06b6d4", "#0891b2"],
			accent: ["#8b5cf6", "#7c3aed"],
			success: ["#10b981", "#059669"],
			dark: ["#0f172a", "#1e293b"],
			background: ["#0f172a", "#1e293b"],
			text: "#ffffff",
			textMuted: "rgba(255, 255, 255, 0.7)",
			glass: "rgba(255, 255, 255, 0.1)",
			glassBorder: "rgba(255, 255, 255, 0.2)",
			menuLayout: "list",
			fontFamily: "System",
			cardStyle: "modern",
			buttonStyle: "solid",
			animationSpeed: "smooth",
		},
	},
];

async function initStyles() {
	try {
		// Connexion MongoDB
		const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
		if (!mongoUri) {
			throw new Error("MONGODB_URI ou MONGO_URI non défini dans .env");
		}

		await mongoose.connect(mongoUri);
		console.log("✅ Connecté à MongoDB");

		// Vérifier si des styles existent déjà
		const existingCount = await Style.countDocuments();
		console.log(`📊 Styles existants: ${existingCount}`);

		// Insérer ou mettre à jour les styles système
		let created = 0;
		let updated = 0;

		for (const styleData of SYSTEM_STYLES) {
			const existing = await Style.findOne({ key: styleData.key });

			if (existing) {
				// Mettre à jour si c'est un style système
				if (existing.isSystem) {
					await Style.findByIdAndUpdate(existing._id, {
						...styleData,
						updatedAt: Date.now(),
					});
					console.log(`🔄 Style mis à jour: ${styleData.name}`);
					updated++;
				} else {
					console.log(
						`⏭️  Style personnalisé existant, non modifié: ${styleData.name}`,
					);
				}
			} else {
				// Créer nouveau style
				const style = new Style(styleData);
				await style.save();
				console.log(`✨ Style créé: ${styleData.name}`);
				created++;
			}
		}

		console.log("\n📈 Résumé:");
		console.log(`   ✅ Créés: ${created}`);
		console.log(`   🔄 Mis à jour: ${updated}`);
		console.log(`   📦 Total: ${await Style.countDocuments()}`);

		await mongoose.connection.close();
		console.log("\n✅ Déconnexion MongoDB");
		process.exit(0);
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

// Exécuter si appelé directement
if (require.main === module) {
	initStyles();
}

module.exports = { initStyles, SYSTEM_STYLES };
