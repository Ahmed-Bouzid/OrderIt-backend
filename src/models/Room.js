const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
			maxlength: 100,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 255,
			default: "",
		},
		tableIds: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Table",
			},
		],
		order: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
	},
);

// Index compound pour lookup par restaurant
roomSchema.index({ restaurantId: 1, order: 1 });

module.exports = mongoose.model("Room", roomSchema);
