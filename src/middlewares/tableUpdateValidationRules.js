const { body } = require("express-validator");

// Validation règles modification : number, qrCodeUrl, capacity, status, position, size

const tableUpdateValidationRules = [
	body("number")
		.optional()
		.isString()
		.trim()
		.notEmpty()
		.withMessage("Le numéro de table doit être une chaîne non vide."),
	body("qrCodeUrl")
		.optional({ values: "falsy" })
		.isURL()
		.withMessage("Le QR Code doit être une URL valide."),
	body("capacity")
		.optional()
		.isInt({ min: 1, max: 50 })
		.withMessage("La capacité doit être un entier entre 1 et 50."),
	body("status")
		.optional()
		.isString()
		.withMessage("Le statut doit être une chaîne."),
	body("position")
		.optional()
		.isObject()
		.withMessage("La position doit être un objet."),
	body("position.x")
		.optional()
		.isFloat({ min: -1000, max: 10000 })
		.withMessage("position.x doit être un nombre entre -1000 et 10000."),
	body("position.y")
		.optional()
		.isFloat({ min: -1000, max: 10000 })
		.withMessage("position.y doit être un nombre entre -1000 et 10000."),
	body("size")
		.optional()
		.isFloat({ min: 0.5, max: 2.5 })
		.withMessage("La taille doit être un nombre entre 0.5 et 2.5."),
	body("sizeW")
		.optional()
		.isFloat({ min: 0.5, max: 3 })
		.withMessage("sizeW doit être un nombre entre 0.5 et 3."),
	body("sizeH")
		.optional()
		.isFloat({ min: 0.5, max: 3 })
		.withMessage("sizeH doit être un nombre entre 0.5 et 3."),
];
module.exports = tableUpdateValidationRules;
