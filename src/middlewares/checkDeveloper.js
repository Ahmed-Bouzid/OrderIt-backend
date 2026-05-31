/**
 * Middleware pour vérifier que l'utilisateur a le rôle "developer"
 */
const checkDeveloper = (req, res, next) => {
	try {
		// req.user est injecté par le middleware auth
		if (!req.user) {
			return res.status(401).json({ message: "Non authentifié" });
		}

		if (req.user.role !== "developer") {
			return res.status(403).json({
				message: "Accès réservé aux développeurs",
				requiredRole: "developer",
				yourRole: req.user.role,
			});
		}

		next();
	} catch (error) {
		console.error("❌ Erreur middleware checkDeveloper:", error);
		res.status(500).json({ message: "Erreur serveur" });
	}
};

module.exports = checkDeveloper;
