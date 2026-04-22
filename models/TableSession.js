const mongoose = require("mongoose");

/**
 * ⭐ TableSession — Session active d'une table (Phase B)
 *
 * Représente une session de vie d'une table (client arrive → mange → paye → part).
 * Bridge légacy : pointe vers la Reservation existante (dual-write).
 * Permet à terme de découpler la session du modèle Reservation.
 */
const tableSessionSchema = new mongoose.Schema(
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
			required: false,
			index: true,
		},
		// ⭐ Bridge légacy — pointe vers la Reservation correspondante
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: false,
			index: true,
		},
		status: {
			type: String,
			enum: ["active", "closed"],
			default: "active",
			index: true,
		},
		openedAt: {
			type: Date,
			default: Date.now,
		},
		closedAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	},
);

// ⭐ Index composé : chercher la session active d'une table
tableSessionSchema.index({ tableId: 1, status: 1 });
tableSessionSchema.index({ restaurantId: 1, status: 1 });
// ⭐ Une réservation → une session (sparse car reservationId optionnel)
tableSessionSchema.index({ reservationId: 1 }, { sparse: true });

// ⭐ Virtual : participants de cette session
tableSessionSchema.virtual("participants", {
	ref: "Participant",
	localField: "_id",
	foreignField: "tableSessionId",
	justOne: false,
});

module.exports = mongoose.model("TableSession", tableSessionSchema);
