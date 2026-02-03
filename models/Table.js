const mongoose = require("mongoose");

// Enum des statuts possibles d'une table
const TABLE_STATUS = {
	AVAILABLE: "available",
	OCCUPIED: "occupied",
	UNAVAILABLE: "unavailable",
};

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
		// Capacité de la table (nombre de places)
		capacity: {
			type: Number,
			default: 4,
			min: 1,
			max: 50,
		},
		// Position sur la grille (6x6) - OPTIONNEL pour rétrocompatibilité
		position: {
			x: {
				type: Number,
				min: -1000,
				max: 10000, // Canvas large pour plan de salle libre
			},
			y: {
				type: Number,
				min: -1000,
				max: 10000,
			},
		},
		// Taille de la table (multiplicateur 0.5-2.5)
		size: {
			type: Number,
			default: 1,
			min: 0.5,
			max: 2.5,
		},
		qrCodeUrl: {
			type: String,
			required: false,
		},
		// Statut de la table (remplace isAvailable)
		status: {
			type: String,
			enum: Object.values(TABLE_STATUS),
			default: TABLE_STATUS.AVAILABLE,
			index: true,
		},
		// Rétrocompatibilité : isAvailable calculé depuis status
		isAvailable: { type: Boolean, default: true },

		// 🎯 Marqueur pour tables temporaires (snack)
		isTemporary: {
			type: Boolean,
			default: false,
			index: true,
		},

		// Liste des invités (ordre d'arrivée)
		guests: [{ type: String }],

		// Réservation assignée à la table (si besoin)
		tableReservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
		},
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
		timestamps: true,
	},
);

// Middleware pre-save pour synchroniser isAvailable avec status
tableSchema.pre("save", function (next) {
	this.isAvailable = this.status === TABLE_STATUS.AVAILABLE;
	next();
});

// Middleware pre-findOneAndUpdate pour synchroniser isAvailable
tableSchema.pre("findOneAndUpdate", function (next) {
	const update = this.getUpdate();
	if (update.status) {
		update.isAvailable = update.status === TABLE_STATUS.AVAILABLE;
	}
	next();
});

// Index pour retrouver rapidement une table d'un restaurant
tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });
tableSchema.index({ restaurantId: 1, status: 1 });

// Index pour positions uniques par restaurant
tableSchema.index(
	{ restaurantId: 1, "position.x": 1, "position.y": 1 },
	{
		unique: true,
		sparse: true,
		partialFilterExpression: {
			"position.x": { $exists: true },
			"position.y": { $exists: true },
		},
	},
);

// Méthode statique pour récupérer toutes les tables d'un restaurant
tableSchema.statics.findByRestaurant = function (restaurantId) {
	return this.find({ restaurantId }).sort({ number: 1 }).maxTimeMS(10000);
};

// Méthode statique pour récupérer les tables disponibles d'un restaurant
tableSchema.statics.findAvailableByRestaurant = function (restaurantId) {
	return this.find({
		restaurantId,
		status: TABLE_STATUS.AVAILABLE,
	})
		.sort({ number: 1 })
		.maxTimeMS(10000);
};

// Expose les statuts pour utilisation externe
tableSchema.statics.STATUS = TABLE_STATUS;

const Table = mongoose.model("Table", tableSchema);

module.exports = Table;
module.exports.TABLE_STATUS = TABLE_STATUS;
