const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
	{
		token: { type: String, required: true, unique: true },
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			refPath: "userType",
		},
		userType: { type: String, required: true, enum: ["Admin", "Server"] },
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: true }
);

// Index TTL pour suppression automatique quand expiresAt est dépassé
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
