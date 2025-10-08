const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true, // Index direct dans la définition du champ
		},
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: true,
			index: true,
		},
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
			index: true,
		},
		items: [
			{
				productId: {
					type: mongoose.Schema.Types.ObjectId,
					ref: "Product",
					required: false,
				},
				name: { type: String, required: true },
				quantity: {
					type: Number,
					required: true,
					min: 1,
					validate: {
						validator: Number.isInteger,
						message: "La quantité doit être un entier positif",
					},
				},
				price: {
					type: Number,
					required: true,
					min: 0,
				},
			},
		],
		total: {
			type: Number,
			required: true,
			min: 0,
		},
		paid: {
			type: Boolean,
			default: false,
		},
		tip: {
			type: Number,
			default: 0,
			min: 0,
		},
		status: {
			type: String,
			enum: ["pending", "in_progress", "completed", "cancelled"],
			default: "pending",
			index: true, // Important pour les filtres par statut
		},
		paymentMethod: {
			type: String,
			enum: ["cash", "card", "app"],
			default: "cash",
		},
		notes: {
			type: String,
			default: "",
		},
	},
	{
		timestamps: true,
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Index composés pour les requêtes fréquentes
orderSchema.index({
	restaurantId: 1,
	status: 1,
});

orderSchema.index({
	tableId: 1,
	createdAt: -1,
});

// Index pour les recherches par server et date
orderSchema.index({
	serverId: 1,
	createdAt: -1,
});

// Validation du total avant sauvegarde
orderSchema.pre("save", function (next) {
	if (this.isModified("items")) {
		const calculatedTotal = this.items.reduce(
			(sum, item) => sum + item.price * item.quantity,
			0
		);

		if (this.total !== calculatedTotal) {
			throw new Error(
				`Le total ${this.total} ne correspond pas à la somme des articles ${calculatedTotal}`
			);
		}
	}
	next();
});

// Méthode utilitaire pour trouver les commandes par statut
orderSchema.statics.findByStatus = function (status) {
	return this.find({ status }).maxTimeMS(10000);
};

module.exports = mongoose.model("Order", orderSchema);
