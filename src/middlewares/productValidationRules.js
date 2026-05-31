const { body } = require("express-validator");

const productValidationRules = [
	body("name").notEmpty().withMessage("Le nom est obligatoire."),
	body("price")
		.isFloat({ gt: 0 })
		.withMessage("Le prix doit être un nombre positif."),
	body("category").optional().isString(),
	body("description").optional().isString(),
	body("image")
		.optional()
		.isURL()
		.withMessage("L'image doit être une URL valide."),
	body("available").optional().isBoolean(),
];

module.exports = productValidationRules;
