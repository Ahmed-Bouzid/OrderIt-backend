const mongoose = require("mongoose");

const tableSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		number: {
			type: String,
			required: true,
			index: true,
		},
		qrCodeUrl: {
			type: String,
		},
		// Statut de disponibilité de la table
		isAvailable: { type: Boolean, default: true },

		// Réservation assignée à la table (si besoin)
		tableReservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
		},
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true, // gère createdAt et updatedAt automatiquement
	}
);

// Index pour retrouver rapidement une table d’un restaurant
tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });

// Méthode statique pour récupérer toutes les tables d’un restaurant
tableSchema.statics.findByRestaurant = function (restaurantId) {
	return this.find({ restaurantId }).sort({ number: 1 }).maxTimeMS(10000);
};

module.exports = mongoose.model("Table", tableSchema);
