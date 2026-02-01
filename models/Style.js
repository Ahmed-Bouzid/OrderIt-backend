const mongoose = require("mongoose");

/**
 * Style - Configuration visuelle pour les restaurants
 * Permet de gérer dynamiquement les thèmes sans modifier le code
 */
const styleSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			// Ex: "Style Foodtruck", "Style Grills", "Style Premium"
		},
		key: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
			// Ex: "foodtruck", "grills", "premium"
		},
		description: {
			type: String,
			required: true,
			// Ex: "Couleurs chaudes, layout compact, pictos colorés"
		},
		config: {
			type: mongoose.Schema.Types.Mixed,
			required: true,
			// Structure :
			// {
			//   primaryColor: "#FF7F50",
			//   secondaryColor: "#FF6347",
			//   background: ["#1a1a1a", "#2d2d2d"],
			//   text: "#ffffff",
			//   textMuted: "rgba(255,255,255,0.7)",
			//   menuLayout: "grid", // "grid" | "list"
			//   fontFamily: "Poppins",
			//   categories: [
			//     { name: "Entrées", visible: true },
			//     { name: "Plats", visible: true }
			//   ]
			// }
		},
		// Catégories de restaurants auxquelles ce style s'applique bien
		suitableFor: {
			type: [String],
			default: [],
			// Ex: ["foodtruck", "snack", "bar"]
		},
		// Preview image (optionnel)
		previewImage: {
			type: String,
			default: null,
		},
		// Marqueur pour les styles système (non supprimables)
		isSystem: {
			type: Boolean,
			default: false,
		},
		// Actif/inactif
		active: {
			type: Boolean,
			default: true,
			index: true,
		},
		createdAt: {
			type: Date,
			default: Date.now,
			index: true,
		},
		updatedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true, // Gère automatiquement createdAt et updatedAt
	},
);

// Index pour recherche rapide
styleSchema.index({ key: 1, active: 1 });
styleSchema.index({ name: "text" }); // Recherche full-text

// Méthode statique pour récupérer tous les styles actifs
styleSchema.statics.findActive = function () {
	return this.find({ active: true }).sort({ name: 1 }).maxTimeMS(10000);
};

// Méthode statique pour récupérer un style par sa clé
styleSchema.statics.findByKey = function (key) {
	return this.findOne({ key: key.toLowerCase(), active: true }).maxTimeMS(
		10000,
	);
};

// Middleware pour mettre à jour updatedAt avant chaque save
styleSchema.pre("save", function (next) {
	this.updatedAt = Date.now();
	next();
});

module.exports = mongoose.model("Style", styleSchema);
