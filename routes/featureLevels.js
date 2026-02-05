/**
 * Routes pour les niveaux fonctionnels (Feature Levels)
 * TODO: À implémenter si nécessaire
 */
const express = require("express");
const router = express.Router();

// Route placeholder
router.get("/", (req, res) => {
	res.json({
		success: true,
		message: "Feature Levels API - À implémenter",
		levels: [],
	});
});

module.exports = router;
