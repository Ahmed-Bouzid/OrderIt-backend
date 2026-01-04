const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema({
	name: { type: String, required: true },
	email: { type: String, required: true, unique: true },
	passwordHash: { type: String, required: true },
	phone: String,
	address: String,
	role: {
		type: String,
		enum: ["admin", "manager"],
		default: "admin",
	},
	servers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Server" }],
	createdAt: { type: Date, default: Date.now },
	products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
	// Assistant de réservations - Durée moyenne d'occupation (en minutes)
	turnoverTime: { type: Number, default: 120, min: 30, max: 300 },
});

module.exports = mongoose.model("Restaurant", restaurantSchema);
