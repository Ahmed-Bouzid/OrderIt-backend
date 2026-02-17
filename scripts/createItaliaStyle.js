/**
 * 🇮🇹 Script pour créer le style "Italia" pour Lacucinadinini
 * Thème immersif italien avec les couleurs du drapeau : vert, blanc, rouge
 * Usage: node scripts/createItaliaStyle.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Style = require("../models/Style");
const Restaurant = require("../models/Restaurant");

const ITALIA_STYLE = {
	name: "Style Italia",
	key: "italia",
	description:
		"Thème authentique italien avec les couleurs du drapeau (vert, blanc, rouge), typographie élégante, et ambiance chaleureuse de trattoria",
	config: {
		// 🇮🇹 Couleurs du drapeau italien
		primary: ["#009246", "#006837"], // Vert Italien (gradient)
		secondary: ["#CE2B37", "#A8192E"], // Rouge Italien (gradient)
		accent: ["#F1BF00", "#D4A500"], // Doré (luxe italien)
		success: ["#009246", "#006837"], // Vert pour succès
		warning: ["#FF8C42", "#FF7733"], // Orange toscan
		dark: ["#2C1810", "#1a0f0a"], // Brun foncé (bois)
		gold: ["#F1BF00", "#DAA520"], // Or italien

		// 🎨 Couleurs spéciales Italia
		terracotta: ["#E07856", "#C86942"], // Terre cuite toscane
		olive: ["#6B7A3F", "#556330"], // Vert olive
		cream: ["#FFF8E7", "#F5E6D3"], // Crème
		wine: ["#722F37", "#5A252C"], // Rouge vin

		// Texte
		text: "#2C1810", // Brun foncé sur fond clair
		textLight: "#FFFFFF", // Blanc sur fond foncé
		textMuted: "rgba(44, 24, 16, 0.7)", // Brun léger

		// Glass effect (pour modales)
		glass: "rgba(255, 255, 255, 0.9)",
		glassBorder: "rgba(241, 191, 0, 0.3)",

		// Background
		background: ["#FFF8E7", "#F5E6D3"], // Fond crème chaleureux

		// 🎭 Customisation UI
		useCustomHeader: true, // Header personnalisé italien
		useCustomBackground: true, // Image de fond
		backgroundImageUrl:
			"https://res.cloudinary.com/ds6aqolxo/image/upload/v1771346715/551988272_17851872288550975_4151156391962741059_n_ffpfwq.jpg",
		backgroundImageAlt: "Fond authentique cuisine italienne",
		backgroundImageType: "photo", // "pattern" | "photo" | "gradient"
		headerComponent: "ItaliaHeader", // Composant header custom
		headerIcon: "pizza", // 🍕 Icon pour le header

		// 📋 Layout
		menuLayout: "grid", // Affichage en grille
		fontFamily: "Playfair Display", // Typo élégante italienne

		// 🏷️ Labels et textes
		categoryLabel: "CUCINA ITALIANA", // Badge header
		slogan: "Autentica cucina italiana", // Sous-titre

		// 🎨 Décoration
		showFlag: true, // Afficher drapeau italien
		flagPosition: "header", // Position du drapeau

		// 🍝 Catégories spéciales pour italien
		categories: [
			{
				id: "antipasti",
				name: "Antipasti",
				emoji: "🧀",
				gradient: ["#009246", "#006837"],
				icon: "food",
				visible: true,
			},
			{
				id: "primi",
				name: "Primi Piatti",
				emoji: "🍝",
				gradient: ["#CE2B37", "#A8192E"],
				icon: "restaurant",
				visible: true,
			},
			{
				id: "secondi",
				name: "Secondi Piatti",
				emoji: "🥩",
				gradient: ["#F1BF00", "#D4A500"],
				icon: "food-steak",
				visible: true,
			},
			{
				id: "contorni",
				name: "Contorni",
				emoji: "🥗",
				gradient: ["#6B7A3F", "#556330"],
				icon: "food-variant",
				visible: true,
			},
			{
				id: "dolci",
				name: "Dolci",
				emoji: "🍰",
				gradient: ["#E07856", "#C86942"],
				icon: "cake",
				visible: true,
			},
			{
				id: "bevande",
				name: "Bevande",
				emoji: "🍷",
				gradient: ["#722F37", "#5A252C"],
				icon: "glass-wine",
				visible: true,
			},
		],
	},
	suitableFor: ["restaurant", "trattoria", "pizzeria"],
	isSystem: false,
	active: true,
};

async function createItaliaStyle() {
	try {
		console.log("🔌 Connexion à MongoDB...");
		await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
		console.log("✅ Connecté à MongoDB");

		// 1. Vérifier si le style existe déjà
		const existingStyle = await Style.findOne({ key: "italia" });
		if (existingStyle) {
			console.log("⚠️  Style 'italia' existe déjà, mise à jour...");
			await Style.updateOne({ key: "italia" }, { $set: ITALIA_STYLE });
			console.log("✅ Style 'italia' mis à jour");
		} else {
			console.log("🆕 Création du style 'italia'...");
			await Style.create(ITALIA_STYLE);
			console.log("✅ Style 'italia' créé");
		}

		// 2. Afficher le style créé
		const style = await Style.findOne({ key: "italia" });
		console.log("\n📄 Style créé:", {
			name: style.name,
			key: style.key,
			description: style.description,
			useCustomHeader: style.config.useCustomHeader,
			backgroundImage: style.config.backgroundImage,
		});

		// 3. Proposer d'assigner à Lacucinadinini
		const lacucinaDinini = await Restaurant.findById(
			"6970ef6594abf8bacd9d804d",
		);
		if (lacucinaDinini) {
			console.log(
				`\n🍝 Restaurant trouvé: ${lacucinaDinini.name} (${lacucinaDinini._id})`,
			);
			console.log(`   Style actuel: ${lacucinaDinini.styleKey}`);

			// Assigner automatiquement
			await Restaurant.updateOne(
				{ _id: "6970ef6594abf8bacd9d804d" },
				{ $set: { styleKey: "italia" } },
			);
			console.log("✅ Style 'italia' assigné à Lacucinadinini");
		} else {
			console.log("\n⚠️  Restaurant Lacucinadinini non trouvé");
		}

		console.log("\n✅ Terminé !");
	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Déconnecté de MongoDB");
	}
}

createItaliaStyle();
