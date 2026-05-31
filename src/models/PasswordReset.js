/**
 * 🔐 PasswordReset Model - SunnyGo
 * Stocke les tokens de réinitialisation de mot de passe avec expiration automatique
 *
 * Le TTL MongoDB supprime automatiquement les documents expirés
 */

const mongoose = require("mongoose");

const PasswordResetSchema = new mongoose.Schema(
	{
		// Email de l'utilisateur
		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
			index: true,
		},

		// Token de réinitialisation (6 chiffres pour mobile-friendly)
		token: {
			type: String,
			required: true,
			index: true,
		},

		// Type d'utilisateur (admin ou server)
		userType: {
			type: String,
			enum: ["admin", "server"],
			required: true,
		},

		// ID de l'utilisateur
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			refPath: "userType",
		},

		// Date de création (pour TTL)
		createdAt: {
			type: Date,
			default: Date.now,
			expires: 3600, // TTL: suppression automatique après 1 heure (3600 secondes)
		},

		// Nombre de tentatives de vérification (protection brute-force)
		attempts: {
			type: Number,
			default: 0,
			max: 5, // Maximum 5 tentatives
		},

		// Utilisé ou non
		used: {
			type: Boolean,
			default: false,
		},
	},
	{
		timestamps: false, // On utilise createdAt manuellement pour le TTL
	},
);

// Index composé pour recherche rapide
PasswordResetSchema.index({ email: 1, token: 1 });

// Méthode statique: générer un token de 6 chiffres
PasswordResetSchema.statics.generateToken = function () {
	return Math.floor(100000 + Math.random() * 900000).toString();
};

// Méthode statique: créer un nouveau reset token
PasswordResetSchema.statics.createResetToken = async function (
	email,
	userId,
	userType,
) {
	// Supprimer les anciens tokens pour cet email
	await this.deleteMany({ email });

	// Créer un nouveau token
	const token = this.generateToken();

	const resetDoc = await this.create({
		email,
		token,
		userId,
		userType,
	});

	return resetDoc;
};

// Méthode statique: vérifier un token
PasswordResetSchema.statics.verifyToken = async function (email, token) {
	const resetDoc = await this.findOne({
		email: email.toLowerCase().trim(),
		token,
		used: false,
	});

	if (!resetDoc) {
		return { valid: false, error: "Token invalide ou expiré" };
	}

	// Vérifier le nombre de tentatives
	if (resetDoc.attempts >= 5) {
		await resetDoc.deleteOne();
		return {
			valid: false,
			error: "Trop de tentatives, veuillez redemander un code",
		};
	}

	return {
		valid: true,
		userId: resetDoc.userId,
		userType: resetDoc.userType,
		resetDoc,
	};
};

// Méthode statique: incrémenter les tentatives
PasswordResetSchema.statics.incrementAttempts = async function (email) {
	await this.updateOne(
		{ email: email.toLowerCase().trim(), used: false },
		{ $inc: { attempts: 1 } },
	);
};

// Méthode statique: marquer comme utilisé
PasswordResetSchema.statics.markAsUsed = async function (email, token) {
	await this.updateOne({ email, token }, { $set: { used: true } });
};

const PasswordReset = mongoose.model("PasswordReset", PasswordResetSchema);

module.exports = PasswordReset;
