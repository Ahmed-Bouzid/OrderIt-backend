const express = require("express");
const router = express.Router();
const Table = require("../models/Table");
const validateObjectIds = require("../middlewares/validateObjectId");

// GET /client-tables/:tableId/guests - récupérer uniquement les guests d'une table (public)
router.get(
	"/:tableId/guests",
	validateObjectIds(["tableId"]),
	async (req, res) => {
		try {
			const table = await Table.findById(req.params.tableId).select(
				"guests number isAvailable"
			);
			if (!table) {
				return res.status(404).json({ message: "Table non trouvée" });
			}
			res.json({
				guests: table.guests,
				number: table.number,
				isAvailable: table.isAvailable,
			});
		} catch (err) {
			console.error("Erreur récupération guests:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
