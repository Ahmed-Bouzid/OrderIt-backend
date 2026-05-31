const { body } = require("express-validator");

const adminValidationRules = [
	body("name").notEmpty().withMessage("Le nom est obligatoire."),
	body("email").isEmail().withMessage("Email invalide."),
	body("password")
		.notEmpty()
		.withMessage("Le mot de passe est obligatoire.")
		.isLength({ min: 6 })
		.withMessage("Le mot de passe doit contenir au moins 6 caractères."),
	body("serverId").notEmpty().withMessage("serverId est requis."),
	body("role")
		.equals("admin")
		.withMessage("Le rôle doit obligatoirement être 'admin'."),
];

module.exports = adminValidationRules;
