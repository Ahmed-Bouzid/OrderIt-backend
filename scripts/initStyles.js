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
			// Gradients principaux
			primary: ["#667eea", "#764ba2"],
			fire: ["#667eea", "#764ba2"],
			gold: ["#f093fb", "#f5576c"],
			secondary: ["#f093fb", "#f5576c"],
			ember: ["#4facfe", "#00f2fe"],
			accent: ["#4facfe", "#00f2fe"],
			smoke: ["#302b63", "#0f0c29"],
			// Couleurs unitaires
			orange: "#667eea",
			rouge: "#764ba2",
			dore: "#f093fb",
			// États
			success: ["#11998e", "#38ef7d"],
			warning: ["#f2994a", "#f2c94c"],
			error: ["#e74c3c", "#c0392b"],
			danger: ["#e74c3c", "#c0392b"],
			// Backgrounds (dark = string, background = array pour LinearGradient)
			dark: "#0f0c29",
			card: "#302b63",
			elevated: "#24243e",
			background: ["#0f0c29", "#302b63", "#24243e"],
			// Textes
			text: "#ffffff",
			textSecondary: "rgba(255, 255, 255, 0.85)",
			textMuted: "rgba(255, 255, 255, 0.7)",
			textAccent: "#f093fb",
			// Transparences
			glass: "rgba(255, 255, 255, 0.15)",
			glassBorder: "rgba(255, 255, 255, 0.25)",
			overlay: "rgba(15, 12, 41, 0.9)",
			fireOverlay: "rgba(102, 126, 234, 0.2)",
			// Layout & UI
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
			// Gradients principaux
			primary: ["#ff9800", "#ff6f00"],
			fire: ["#ff9800", "#ff6f00"],
			gold: ["#ffb347", "#ffcc33"],
			secondary: ["#ffb347", "#ffcc33"],
			ember: ["#ff512f", "#dd2476"],
			accent: ["#ff512f", "#dd2476"],
			smoke: ["#232526", "#181818"],
			// Couleurs unitaires
			orange: "#ff9800",
			rouge: "#ff6f00",
			dore: "#ffcc33",
			// États
			success: ["#ff9800", "#ff6f00"],
			warning: ["#f2994a", "#f2c94c"],
			error: ["#e74c3c", "#c0392b"],
			danger: ["#e74c3c", "#c0392b"],
			// Backgrounds
			dark: "#181818",
			card: "#232526",
			elevated: "#2d2d2d",
			background: ["#181818", "#232526"],
			// Textes
			text: "#ffffff",
			textSecondary: "rgba(255, 255, 255, 0.85)",
			textMuted: "rgba(255, 255, 255, 0.7)",
			textAccent: "#ffcc33",
			// Transparences
			glass: "rgba(255, 255, 255, 0.1)",
			glassBorder: "rgba(255, 255, 255, 0.18)",
			overlay: "rgba(24, 24, 24, 0.9)",
			fireOverlay: "rgba(255, 152, 0, 0.2)",
			// Layout & UI
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
			// Gradients principaux - Flammes vives du BBQ
			primary: ["#FF5722", "#BF360C"],
			fire: ["#FF5722", "#BF360C"],
			gold: ["#FF8C00", "#FF6F00"],
			secondary: ["#FF8C00", "#FF6F00"],
			ember: ["#FF6F00", "#E65100"],
			accent: ["#FF6F00", "#E65100"],
			smoke: ["#424242", "#212121"],
			// Couleurs unitaires - Tons chauds du feu
			orange: "#FF6F00",
			rouge: "#BF360C",
			dore: "#FF8C00",
			// États - Palette chaleureuse
			success: ["#FF8C00", "#FF6F00"],
			warning: ["#FF9800", "#F57C00"],
			error: ["#D84315", "#BF360C"],
			danger: ["#D84315", "#BF360C"],
			// Backgrounds - Charbon et fumée
			dark: "#1C1C1C",
			card: "#2C2C2C",
			elevated: "#3C3C3C",
			background: ["#1C1C1C", "#2C2C2C"],
			// Textes - Blanc chaud
			text: "#FFF8E1",
			textSecondary: "#FFE0B2",
			textMuted: "#BCAAA4",
			textAccent: "#FF8C00",
			// Transparences - Braises et fumée
			glass: "rgba(255, 111, 0, 0.12)",
			glassBorder: "rgba(255, 140, 0, 0.25)",
			overlay: "rgba(28, 28, 28, 0.92)",
			fireOverlay: "rgba(255, 87, 34, 0.25)",
			// Layout & UI
			menuLayout: "grid",
			fontFamily: "System",
			cardStyle: "solid",
			buttonStyle: "gradient",
			animationSpeed: "smooth",
			// 🚀 UI Customization Flags - Architecture 100% JSON-driven
			useCustomHeader: true, // Activer le header custom GrillzHeader
			useCustomBackground: true, // Activer le fond custom (image flyer)
			backgroundImage: "grillz-flyer.jpg", // Nom du fichier dans assets
			headerComponent: "GrillzHeader", // Composant header à utiliser
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
			// Gradients principaux
			primary: ["#3b82f6", "#2563eb"],
			fire: ["#3b82f6", "#2563eb"],
			gold: ["#06b6d4", "#0891b2"],
			secondary: ["#06b6d4", "#0891b2"],
			ember: ["#8b5cf6", "#7c3aed"],
			accent: ["#8b5cf6", "#7c3aed"],
			smoke: ["#1e293b", "#0f172a"],
			// Couleurs unitaires
			orange: "#3b82f6",
			rouge: "#2563eb",
			dore: "#06b6d4",
			// États
			success: ["#10b981", "#059669"],
			warning: ["#f59e0b", "#d97706"],
			error: ["#ef4444", "#dc2626"],
			danger: ["#ef4444", "#dc2626"],
			// Backgrounds
			dark: "#0f172a",
			card: "#1e293b",
			elevated: "#334155",
			background: ["#0f172a", "#1e293b"],
			// Textes
			text: "#ffffff",
			textSecondary: "rgba(255, 255, 255, 0.85)",
			textMuted: "rgba(255, 255, 255, 0.7)",
			textAccent: "#06b6d4",
			// Transparences
			glass: "rgba(255, 255, 255, 0.1)",
			glassBorder: "rgba(255, 255, 255, 0.2)",
			overlay: "rgba(15, 23, 42, 0.9)",
			fireOverlay: "rgba(59, 130, 246, 0.2)",
			// Layout & UI
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
