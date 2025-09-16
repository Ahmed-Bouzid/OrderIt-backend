const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
	{
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: false,
			index: true,
		},
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server", // référence à ton modèle Server
			required: false, // si tu veux rendre obligatoire l'attribution
			index: true,
		},
		status: {
			type: String,
			enum: ["ouverte", "fermee", "annulee", "en attente"],
			default: "en attente",
			index: true,
		},
		clientName: { type: String, required: true, trim: true },
		nbPersonnes: { type: Number, default: 1 },
		reservationDate: { type: Date, required: true },
		reservationTime: { type: String, default: "" }, // peut aussi être Date combiné avec reservationDate si besoin
		arrivalTime: { type: Date },
		reservationSource: {
			type: String,
			enum: ["Sur place", "À distance", "Sans réservation"],
			default: "Sur place",
		},

		allergies: { type: String, default: "" },
		restrictions: { type: String, default: "" },
		notes: { type: String, default: "" },

		orderSummary: { type: String, default: "" },
		dishStatus: {
			type: String,
			enum: ["En attente", "En cours", "Annulé", "Terminé"],
			default: "En attente",
		},

		paymentMethod: {
			type: String,
			enum: ["Carte", "Espèces", "Autre"],
			default: "Autre",
		},
		totalAmount: { type: Number, default: 0 },

		isPresent: { type: Boolean, default: false },
		canceled: { type: Boolean, default: false },
		canceledAt: { type: Date },

		createdAt: { type: Date, default: Date.now, index: true },
		updatedAt: { type: Date, default: Date.now },
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

// Index pour retrouver rapidement toutes les réservations d'une table ou d'un restaurant
reservationSchema.index({ tableId: 1, reservationDate: 1 });
reservationSchema.index({ restaurantId: 1, reservationDate: 1 });

// Middleware pour mettre à jour la date de modification
reservationSchema.pre("save", function (next) {
	this.updatedAt = Date.now();
	next();
});

module.exports = mongoose.model("Reservation", reservationSchema);
