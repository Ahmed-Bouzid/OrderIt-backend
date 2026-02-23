const mongoose = require("mongoose");

function validateOrder(req, res, next) {
	const { tableId, items, total, restaurantId, status } = req.body;

	// tableId optionnel (commandes fast-food sans table)
	if (tableId && !mongoose.Types.ObjectId.isValid(tableId)) {
		return res.status(400).json({ message: "tableId invalide." });
	}
	if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
		return res.status(400).json({ message: "restaurantId invalide." });
	}
	if (!items || items.length === 0) {
		return res.status(400).json({ message: "Produit(s) requis." });
	}
	if (typeof total !== "number" || total <= 0) {
		return res
			.status(400)
			.json({ message: "total doit être un nombre positif." });
	}

	// Vérification status
	const validStatuses = ["pending", "in_progress", "completed", "cancelled"];
	if (status && !validStatuses.includes(status)) {
		return res.status(400).json({
			message: `Status invalide. Valeurs autorisées : ${validStatuses.join(
				", ",
			)}`,
		});
	}

	next();
}

module.exports = validateOrder;
