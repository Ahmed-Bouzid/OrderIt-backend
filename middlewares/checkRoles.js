module.exports = function checkRoles(allowedRoles) {
	return (req, res, next) => {
		try {
			if (!req.user) {
				if (process.env.NODE_ENV !== "production")
					console.warn(
						"[checkRoles] Authentification requise - req.user manquant"
					);
				return res.status(401).json({ message: "Authentification requise." });
			}

			if (!req.user.role) {
				if (process.env.NODE_ENV !== "production")
					console.warn("[checkRoles] Rôle utilisateur manquant");
				return res.status(403).json({ message: "Rôle utilisateur manquant." });
			}

			// ✅ Harmonisation rôle "server" <-> "server"
			let userRole = req.user.role;
			if (userRole === "server") userRole = "server";

			if (!allowedRoles.includes(userRole)) {
				if (process.env.NODE_ENV !== "production")
					console.warn(
						`[checkRoles] Accès refusé pour le rôle: ${req.user.role}`
					);
				return res.status(403).json({
					message: "Accès refusé : rôle utilisateur insuffisant.",
					role: req.user.role,
					allowedRoles,
				});
			}

			next();
		} catch (error) {
			console.error("Erreur dans checkRoles:", error);
			res.status(500).json({ message: "Erreur server interne." });
		}
	};
};
