const { body } = require("express-validator");

// Validation création/maj server
const serverValidationRules = [
	body("name").notEmpty().withMessage("Le nom est obligatoire."),
	body("email").isEmail().withMessage("Email invalide."),
	body("password")
		.optional()
		.isLength({ min: 6 })
		.withMessage("Le mot de passe doit contenir au moins 6 caractères."),
	body("role").optional().isIn(["server", "manager", "admin"]),
	body("restaurantId").notEmpty().withMessage("restaurantId est requis"),
];

module.exports = serverValidationRules;
