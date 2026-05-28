const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema({
	restaurantId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Restaurant",
		required: true,
	},
	serverId: {
		type: String,
		required: true,
		unique: true, // pour garantir unicité
		trim: true,
	},
	name: {
		type: String,
		required: true,
	},
	email: {
		type: String,
		required: true,
		unique: true,
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
		enum: ["server", "manager", "admin"],
		default: "server",
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
	avatar: {
		type: String,
		default: null,
	},
});

module.exports = mongoose.model("Server", serverSchema);
