const { body } = require("express-validator");

// Validation règles modification : uniquement number et qrCodeUrl

const tableUpdateValidationRules = [
	body("number")
		.optional()
		.isString()
		.trim()
		.notEmpty()
		.withMessage("Le numéro de table doit être une chaîne non vide."),
	body("qrCodeUrl")
		.optional()
		.isURL()
		.withMessage("Le QR Code doit être une URL valide."),
];
module.exports = tableUpdateValidationRules;
