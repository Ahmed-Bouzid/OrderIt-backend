const mongoose = require("mongoose");

/**
 * CashShift — Session de caisse (shift)
 * 
 * Représente une période d'ouverture/fermeture de caisse
 * Le Z de caisse = agrégation des events d'un shift
 */

const cashShiftSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		// Numéro séquentiel par restaurant
		sequenceNumber: {
			type: Number,
			required: true,
		},

		// État du shift
		status: {
			type: String,
			enum: ["open", "closing", "closed"],
			default: "open",
			index: true,
		},

		// ═══ DATES ═══
		openedAt: {
			type: Date,
			required: true,
			default: Date.now,
			index: true,
		},

		closedAt: {
			type: Date,
			required: false,
		},

		// ═══ RESPONSABLES ═══
		openedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: true,
		},

		closedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
		},

		// ═══ CAISSE ═══
		openingFloatCents: {
			type: Number,
			required: true,
			min: 0,
			// Fond de caisse initial en centimes
		},

		closingCountCents: {
			type: Number,
			required: false,
			min: 0,
			// Espèces comptées à la fermeture
		},

		// ═══ MÉTADONNÉES ═══
		notes: {
			type: String,
			default: "",
		},

		// ═══ Z-REPORT ASSOCIÉ ═══
		zReportId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ZReport",
			required: false,
			// Lien vers le Z généré pour ce shift
		},

		// ═══ AUDIT ═══
		deviceId: {
			type: String,
			required: false,
			// Identifiant de la caisse/terminal
		},
	},
	{
		timestamps: true,
	},
);

// Index unique : un seul shift "open" par restaurant
cashShiftSchema.index(
	{ restaurantId: 1, status: 1 },
	{
		unique: true,
		partialFilterExpression: { status: "open" },
	},
);

// Index pour historique
cashShiftSchema.index({ restaurantId: 1, openedAt: -1 });
cashShiftSchema.index({ restaurantId: 1, sequenceNumber: 1 }, { unique: true });

// ═══ MÉTHODES ═══

/**
 * Ferme le shift (étape 1 : marque "closing" pour empêcher nouveaux tickets)
 */
cashShiftSchema.methods.startClosing = async function (closedBy) {
	if (this.status !== "open") {
		throw new Error(`Shift ${this._id} is not open (current: ${this.status})`);
	}
	this.status = "closing";
	this.closedBy = closedBy;
	await this.save();
};

/**
 * Finalise la fermeture après génération du Z
 */
cashShiftSchema.methods.finalizeClosure = async function (zReportId, closingCountCents) {
	if (this.status !== "closing") {
		throw new Error(`Shift ${this._id} is not closing (current: ${this.status})`);
	}
	this.status = "closed";
	this.closedAt = new Date();
	this.closingCountCents = closingCountCents;
	this.zReportId = zReportId;
	await this.save();
};

// ═══ STATICS ═══

/**
 * Récupère le shift actif d'un restaurant
 */
cashShiftSchema.statics.getActiveShift = async function (restaurantId) {
	return this.findOne({ restaurantId, status: "open" });
};

/**
 * Ouvre un nouveau shift
 */
cashShiftSchema.statics.openShift = async function (restaurantId, openedBy, openingFloatCents, deviceId = null) {
	// Vérifier qu'aucun shift n'est déjà ouvert
	const existing = await this.getActiveShift(restaurantId);
	if (existing) {
		throw new Error(`Shift ${existing._id} already open for restaurant ${restaurantId}`);
	}

	// Récupérer le dernier numéro de séquence
	const lastShift = await this.findOne(
		{ restaurantId },
		{ sequenceNumber: 1 },
		{ sort: { sequenceNumber: -1 } },
	).lean();

	const sequenceNumber = (lastShift?.sequenceNumber || 0) + 1;

	return this.create({
		restaurantId,
		sequenceNumber,
		openedBy,
		openingFloatCents,
		deviceId,
		status: "open",
	});
};

module.exports = mongoose.model("CashShift", cashShiftSchema);
