const express = require("express");
const router = express.Router();
const Table = require("../models/Table");
const validateObjectIds = require("../middlewares/validateObjectId");

// GET /client-tables/:tableId/guests - récupérer uniquement les guests d'une table (public)
router.get(
	"/:tableId/guests",
	validateObjectIds(["tableId"]),
	async (req, res) => {
		console.log(
			`[CLIENT-END][API] GET /client-tables/${req.params.tableId}/guests appelée`
		);
		try {
			const table = await Table.findById(req.params.tableId).select(
				"guests number isAvailable"
			);
			if (!table) {
				return res.status(404).json({ message: "Table non trouvée" });
			}
			console.log("📋 [CLIENT-TABLES] Guests récupérés:", {
				tableId: req.params.tableId,
				number: table.number,
				guests: table.guests,
				isAvailable: table.isAvailable,
			});
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
