const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
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
				notes: {
					type: String,
					default: "",
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
			index: true,
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

		// 👇 Nouveau champ pour indiquer l'origine de la commande
		origin: {
			type: String,
			enum: ["client", "server", "admin"],
			default: "server",
		},
	},
	{
		timestamps: true,
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Index composés
orderSchema.index({ restaurantId: 1, status: 1 });
orderSchema.index({ tableId: 1, createdAt: -1 });
orderSchema.index({ serverId: 1, createdAt: -1 });

// Validation automatique du total
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

// Méthode utilitaire
orderSchema.statics.findByStatus = function (status) {
	return this.find({ status }).maxTimeMS(10000);
};

module.exports = mongoose.model("Order", orderSchema);
