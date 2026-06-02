// Rôles super-utilisateurs : accès complet à toutes les routes, quelle que soit la liste allowedRoles
const SUPER_ROLES = ["admin", "developer"];

module.exports = function checkRoles(allowedRoles) {
	return (req, res, next) => {
		try {
			if (!req.user) {
				return res.status(401).json({ message: "Authentification requise." });
			}

			if (!req.user.role) {
				return res.status(403).json({ message: "Rôle utilisateur manquant." });
			}

			const userRole = req.user.role;

			// admin et developer bypasse tous les checks de rôle (rôles les plus élevés)
			if (SUPER_ROLES.includes(userRole)) {
				return next();
			}

			if (!allowedRoles.includes(userRole)) {
				return res.status(403).json({
					message: "Accès refusé : rôle utilisateur insuffisant.",
				});
			}

			next();
		} catch (error) {
			console.error("Erreur checkRoles:", error);
			res.status(500).json({ message: "Erreur server interne." });
		}
	};
};
