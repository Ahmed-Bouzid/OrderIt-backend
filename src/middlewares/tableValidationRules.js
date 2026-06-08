const { body } = require("express-validator");

// Validation règles pour création et modification
const tableValidationRules = [
	body("restaurantId")
		.exists()
		.isMongoId()
		.withMessage("restaurantId doit être un ID Mongo valide."),
	body("number")
		.exists()
		.isString()
		.trim()
		.notEmpty()
		.withMessage(
			"Le numéro de table est obligatoire et doit être une chaîne non vide."
		),
	body("qrCodeUrl")
		.optional({ values: "falsy" })
		.isURL()
		.withMessage("Le QR Code doit être une URL valide."),
];
module.exports = tableValidationRules;
