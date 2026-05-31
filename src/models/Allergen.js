const mongoose = require("mongoose");

const allergenSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			unique: true,
		},
		description: {
			type: String,
			trim: true,
			default: "",
		},
		icon: {
			type: String,
			default: "⚠️", // Icône par défaut
		},
		// Pour les stats/analytics
		usageCount: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
	}
);

// Index pour la recherche
allergenSchema.index({ name: "text" });

module.exports = mongoose.model("Allergen", allergenSchema);
