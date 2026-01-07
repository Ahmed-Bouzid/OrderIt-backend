/**
 * 🔐 Middleware de validation de complexité des mots de passe
 * Appliqué sur signup, création de serveur, changement de mot de passe
 *
 * Règles:
 * - Minimum 8 caractères
 * - Au moins 1 majuscule
 * - Au moins 1 chiffre
 * - Au moins 1 caractère spécial (@$!%*?&)
 */
const validatePasswordComplexity = (req, res, next) => {
	const { password } = req.body;

	if (!password) {
		return res.status(400).json({
			message: "Le mot de passe est obligatoire",
		});
	}

	// Vérifications de complexité
	const minLength = 8;
	const hasUppercase = /[A-Z]/.test(password);
	const hasLowercase = /[a-z]/.test(password);
	const hasNumber = /[0-9]/.test(password);
	const hasSpecialChar = /[@$!%*?&]/.test(password);

	const errors = [];

	if (password.length < minLength) {
		errors.push(`Minimum ${minLength} caractères`);
	}
	if (!hasUppercase) {
		errors.push("Au moins 1 majuscule");
	}
	if (!hasLowercase) {
		errors.push("Au moins 1 minuscule");
	}
	if (!hasNumber) {
		errors.push("Au moins 1 chiffre");
	}
	if (!hasSpecialChar) {
		errors.push("Au moins 1 caractère spécial (@$!%*?&)");
	}

	if (errors.length > 0) {
		return res.status(400).json({
			message: "Mot de passe trop faible",
			errors,
			hint:
				"Exemple de mot de passe fort: MonMotDePasse123!",
		});
	}

	next();
};

module.exports = validatePasswordComplexity;
