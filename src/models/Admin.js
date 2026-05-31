const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
	serverId: {
		type: String,
		required: true,
		unique: true,
		trim: true,
	},
	name: {
		type: String,
		required: true,
		trim: true,
	},
	email: {
		type: String,
		required: true,
		unique: true,
		lowercase: true,
		trim: true,
	},
	passwordHash: {
		type: String,
		required: function () {
			return this.authProvider === "local";
		},
	},
	// 🔐 OAuth Google
	authProvider: {
		type: String,
		enum: ["local", "google"],
		default: "local",
	},
	googleId: {
		type: String,
		unique: true,
		sparse: true, // permet null/undefined sans conflit unique
	},
	role: {
		type: String,
		enum: ["admin", "developer"],
		default: "admin",
		immutable: true, // empêche toute modification du rôle
	},
	restaurantId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Restaurant",
		default: null,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
	// 🔐 Champs MFA (Multi-Factor Authentication)
	mfaEnabled: {
		type: Boolean,
		default: false,
	},
	mfaSecret: {
		type: String,
		default: null,
	},
	mfaBackupCodes: [
		{
			code: String,
			used: {
				type: Boolean,
				default: false,
			},
		},
	],
});

// 🔒 Middleware pour empêcher la création de plusieurs admins par restaurant
adminSchema.pre("save", async function (next) {
	// Autoriser plusieurs comptes si c'est un developer
	if (this.role === "developer") {
		return next();
	}

	// Vérifier s'il existe déjà un admin pour CE restaurant (pas tous les restaurants)
	if (this.restaurantId) {
		const existingAdmin = await this.constructor.findOne({
			role: "admin",
			restaurantId: this.restaurantId,
			_id: { $ne: this._id }, // Exclure le document actuel (pour les mises à jour)
		});

		if (existingAdmin) {
			const error = new Error(
				"Un admin existe déjà pour ce restaurant. Un seul admin par restaurant est autorisé."
			);
			error.status = 403;
			return next(error);
		}
	}

	next();
});

module.exports = mongoose.model("Admin", adminSchema);
