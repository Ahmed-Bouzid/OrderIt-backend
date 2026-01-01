const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true, // Index ajouté
		},
		name: {
			type: String,
			required: true,
			index: "text", // Permet les recherches full-text
		},
		description: {
			type: String,
			index: "text", // Permet les recherches full-text
		},
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		category: {
			type: String,
			index: true, // Index pour les filtres par catégorie
		},
		image: String,
		available: {
			type: Boolean,
			default: true,
			index: true, // Index pour filtrer les produits disponibles
		},
		allergens: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Allergen",
			},
		],
		// 📦 Gestion des stocks
		quantifiable: {
			type: Boolean,
			default: false,
		},
		quantity: {
			type: Number,
			default: null,
			min: 0,
		},
		lowStockThreshold: {
			type: Number,
			default: 5,
			min: 0,
		},
		createdAt: {
			type: Date,
			default: Date.now,
			index: true, // Index pour tri chronologique
		},
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Index composé pour les requêtes fréquentes
productSchema.index({
	restaurantId: 1,
	category: 1,
	available: 1,
});

// Méthode statique pour trouver les produits disponibles
productSchema.statics.findAvailable = function (restaurantId) {
	return this.find({
		restaurantId,
		available: true,
	}).maxTimeMS(10000);
};

// Méthode statique pour trouver les produits à stock bas
productSchema.statics.findLowStock = function (restaurantId) {
	return this.find({
		restaurantId,
		quantifiable: true,
		$expr: { $lte: ["$quantity", "$lowStockThreshold"] },
	}).maxTimeMS(10000);
};

// Virtuel pour vérifier si stock bas
productSchema.virtual("isLowStock").get(function () {
	if (!this.quantifiable || this.quantity === null) return false;
	return this.quantity <= this.lowStockThreshold;
});

// Virtuel pour vérifier si rupture de stock
productSchema.virtual("isOutOfStock").get(function () {
	if (!this.quantifiable || this.quantity === null) return false;
	return this.quantity === 0;
});

module.exports = mongoose.model("Product", productSchema);
