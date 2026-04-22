const mongoose = require("mongoose");

/**
 * ⭐ Participant — Client participant à une TableSession (Phase B)
 *
 * Représente un client connecté à une session de table.
 * Bridge légacy : reservationId optionnel si le client est passé par POST /client/reservations.
 */
const participantSchema = new mongoose.Schema(
	{
		tableSessionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "TableSession",
			required: true,
			index: true,
		},
		// ⭐ Bridge légacy — pointe vers la Reservation si le client a créé via /client/reservations
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: false,
			index: true,
		},
		// ⭐ clientId = String UUID généré côté client (stable cross-sessions)
		clientId: {
			type: String,
			required: false,
			index: true,
		},
		// ⭐ deviceId = identifiant stable de l'appareil (header x-device-id)
		deviceId: {
			type: String,
			required: false,
		},
		clientName: {
			type: String,
			required: true,
			trim: true,
		},
		// ⭐ true si ce participant a créé la réservation/session
		isCreator: {
			type: Boolean,
			default: false,
		},
		joinedAt: {
			type: Date,
			default: Date.now,
		},
		// ⭐ null tant que le participant est actif
		leftAt: {
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

// ⭐ Un device donné ne peut être qu'une fois par session (sparse car deviceId optionnel)
participantSchema.index(
	{ tableSessionId: 1, deviceId: 1 },
	{ unique: true, sparse: true },
);
// ⭐ Chercher les sessions actives d'un client
participantSchema.index({ clientId: 1, leftAt: 1 });
participantSchema.index({ tableSessionId: 1, clientId: 1 });

module.exports = mongoose.model("Participant", participantSchema);
