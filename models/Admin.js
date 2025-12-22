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
		required: true,
	},
	role: {
		type: String,
		enum: ["admin"],
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
});

// 🔒 Middleware pour empêcher la création de plusieurs admins
adminSchema.pre("save", async function (next) {
	const existingAdmin = await this.constructor.findOne();
	if (existingAdmin) {
		const error = new Error("Un seul admin est autorisé dans le système.");
		error.status = 403;
		return next(error);
	}
	next();
});

module.exports = mongoose.model("Admin", adminSchema);
