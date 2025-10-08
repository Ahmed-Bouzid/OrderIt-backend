const express = require("express");
const router = express.Router();
const Table = require("../models/Table");
const { body, validationResult } = require("express-validator");

const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const tableValidationRules = require("../middlewares/tableValidationRules");
const tableUpdateValidationRules = require("../middlewares/tableUpdateValidationRules");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");

// POST / - création table (admin)

router.post(
	"/",
	auth,
	checkRoles(["admin"]),
	checkUserRestaurantBody("restaurantId"), // <-- ajouté ici
	tableValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
			const { restaurantId, number, qrCodeUrl } = req.body;

			const table = new Table({ restaurantId, number, qrCodeUrl });
			await table.save();
			res.status(201).json(table);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// GET /restaurant/:restaurantId - lister tables
router.get(
	"/restaurant/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const tables = await Table.find({
				restaurantId: req.params.restaurantId,
			}).maxTimeMS(10000);
			if (!tables.length) {
				return res.status(404).json({ message: "Aucune table trouvée." });
			}
			res.json(tables);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// PUT /:id - modifier table (admin)
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	tableUpdateValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		// On filtre les champs autorisés
		const allowedFields = ["number", "qrCodeUrl"];
		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);

		try {
			const updated = await Table.findByIdAndUpdate(req.params.id, updates, {
				new: true,
			});
			if (!updated) {
				return res.status(404).json({ message: "Table non trouvée." });
			}
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

// DELETE /:id - supprimer table (admin)
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const deleted = await Table.findByIdAndDelete(req.params.id);
			if (!deleted) {
				return res.status(404).json({ message: "Table non trouvée." });
			}
			res.json({ message: "Table supprimée." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server" });
		}
	}
);

module.exports = router;
