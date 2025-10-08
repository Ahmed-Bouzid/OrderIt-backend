//Validation complète pour création server, incluant restaurantId dans le body
const serverValidationRules = require("../middlewares/serverValidationRules");

const { body } = require("express-validator");

const createServerValidation = [
	body("name").notEmpty().withMessage("Le nom est obligatoire."),
	body("email").isEmail().withMessage("Email invalide."),
	body("password")
		.isLength({ min: 6 })
		.withMessage("Le mot de passe doit faire au moins 6 caractères."),
	body("serverId").notEmpty().withMessage("serverId est obligatoire."),
	body("restaurantId")
		.notEmpty()
		.withMessage("restaurantId est obligatoire.")
		.isMongoId()
		.withMessage("restaurantId invalide."),
	body("role")
		.optional()
		.isIn(["admin", "restaurant", "server"])
		.withMessage("Rôle invalide."),
	...serverValidationRules,
];

module.exports = createServerValidation;
