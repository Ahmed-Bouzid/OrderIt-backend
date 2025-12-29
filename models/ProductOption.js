const mongoose = require("mongoose");

const productOptionSchema = new mongoose.Schema(
	{
		productId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Product",
			required: true,
			index: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		price: {
			type: Number,
			default: 0,
			min: 0,
		},
		available: {
			type: Boolean,
			default: true,
		},
		createdAt: {
			type: Date,
			default: Date.now,
		},
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Index composé pour requêtes fréquentes
productOptionSchema.index({ productId: 1, available: 1 });

// Méthode statique pour récupérer toutes les options d'un produit
productOptionSchema.statics.findByProduct = function (productId) {
	return this.find({ productId, available: true }).maxTimeMS(10000);
};

module.exports = mongoose.model("ProductOption", productOptionSchema);
