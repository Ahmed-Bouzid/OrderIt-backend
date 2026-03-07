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
			"Style BBQ authentique - Flammes orange vif, braises rougeoyantes, charbon noir profond, ambiance grill urbain",
		suitableFor: ["foodtruck", "restaurant", "bar"],
		isSystem: true,
		config: {
			// 🔥 Gradients principaux - Flammes BBQ intenses
			primary: ["#FF6B35", "#D9381E"], // Orange flamme vif → Rouge feu
			fire: ["#FF6B35", "#D9381E"], // Flammes vives
			gold: ["#D4A574", "#B8860B"], // Doré grillé → Or brûlé
			secondary: ["#C73E1D", "#8B2500"], // Rouge braise → Brun brûlé
			ember: ["#C73E1D", "#A62F1A"], // Braises rougeoyantes
			accent: ["#FF8C42", "#E65100"], // Orange chaud → Orange brûlé
			smoke: ["#4A413D", "#2B1F1E"], // Gris fumée → Brun fumé

			// 🎨 Couleurs unitaires - Tons chauds BBQ
			orange: "#FF6B35", // Orange flamme signature
			rouge: "#D9381E", // Rouge feu intense
			dore: "#D4A574", // Doré grillé

			// ✅ États - Palette énergique BBQ
			success: ["#FF8C42", "#D4A574"], // Orange vif → Doré
			warning: ["#FF9933", "#E67E22"], // Orange alerte
			error: ["#D9381E", "#A62F1A"], // Rouge feu → Rouge braise
			danger: ["#C73E1D", "#8B2500"], // Rouge danger intense

			// 🌑 Backgrounds - Charbon noir profond et fumée
			dark: "#1A1110", // Noir charbon profond
			card: "#2B1F1E", // Brun charbon
			elevated: "#3D312E", // Brun élevé fumé
			background: ["#1A1110", "#2B1F1E", "#332B28"], // Dégradé charbon → fumée

			// 📝 Textes - Blanc crème chaud du feu
			text: "#FFFAF0", // Blanc crème chaud (floral white)
			textSecondary: "#FFE4B5", // Moccasin (beige chaud)
			textMuted: "#D2B48C", // Tan (brun clair)
			textAccent: "#FF6B35", // Orange flamme signature

			// ✨ Transparences - Braises et fumée BBQ
			glass: "rgba(255, 107, 53, 0.15)", // Verre orange flamme
			glassBorder: "rgba(255, 140, 66, 0.3)", // Bordure orange chaud
			overlay: "rgba(26, 17, 16, 0.94)", // Overlay charbon opaque
			fireOverlay: "rgba(255, 107, 53, 0.3)", // Overlay flamme orange

			// 🎯 Layout & UI
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

			// 🎨 Couleurs additionnelles BBQ
			charcoal: "#1A1110", // Charbon noir
			ash: "#4A413D", // Cendres grises
			flame: "#FF6B35", // Flamme signature
			grill: "#8B4513", // Brun grille (saddle brown)
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

		// Vérifier si des styles existent déjà
		const existingCount = await Style.countDocuments();

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
					updated++;
				} else {
				}
			} else {
				// Créer nouveau style
				const style = new Style(styleData);
				await style.save();
				created++;
			}
		}


		await mongoose.connection.close();
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
