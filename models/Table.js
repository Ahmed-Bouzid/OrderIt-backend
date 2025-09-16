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
			index: true,
		},

		// ✅ Informations sur le client / réservation
		clientName: { type: String, default: "" },
		nbPersonnes: { type: Number, default: 1 },
		reservationTime: { type: String, default: "" }, // "19:30"
		arrivalTime: { type: Date }, // Date réelle d'arrivée
		reservationDate: { type: Date }, // Date de réservation
		reservationSource: { type: String, default: "Sur place" },

		// ✅ Détails alimentaires
		allergies: { type: String, default: "" },
		restrictions: { type: String, default: "" },
		notes: { type: String, default: "" },

		// ✅ Service
		server: { type: String, default: "" },
		orderSummary: { type: String, default: "" },
		dishStatus: { type: String, default: "" },

		// ✅ Paiement
		paymentMethod: { type: String, default: "" },
		totalAmount: { type: String, default: "" },

		// ✅ Statut table
		isPresent: { type: Boolean, default: false },

		createdAt: {
			type: Date,
			default: Date.now,
			index: true,
		},
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Supprimer le flag "unique" du chemin si défini
delete tableSchema.paths.number.options.unique;

// Index composé restaurantId + number
tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });

// Méthode statique pour trouver les tables d'un restaurant
tableSchema.statics.findByRestaurant = function (restaurantId) {
	return this.find({ restaurantId }).sort({ number: 1 }).maxTimeMS(10000);
};

module.exports = mongoose.model("Table", tableSchema);
