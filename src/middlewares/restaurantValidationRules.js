const { body } = require("express-validator");

const restaurantValidationRules = [
	body("name").notEmpty().withMessage("Le nom est obligatoire."),
	body("email").isEmail().withMessage("Email invalide."),
	body("password")
		.isLength({ min: 6 })
		.withMessage("Le mot de passe doit contenir au moins 6 caractères."),
	body("role")
		.optional()
		.isIn(["admin", "restaurant"])
		.withMessage("Role invalide."),
];
module.exports = restaurantValidationRules;
