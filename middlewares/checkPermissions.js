// middlewares/checkPermissions.js
module.exports = function (requiredPermissions = []) {
	return (req, res, next) => {
		const user = req.user; // fourni par le middleware auth

		if (!user) {
			return res.status(401).json({ message: "Utilisateur non authentifié." });
		}

		// Vérifier que l'utilisateur a au moins une des permissions requises
		const hasPermission = requiredPermissions.every((perm) =>
			user.permissions?.includes(perm)
		);

		if (!hasPermission) {
			return res
				.status(403)
				.json({ message: "Accès refusé : permissions pas suffisantes." });
		}

		next();
	};
};
