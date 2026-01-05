module.exports = function checkRoles(allowedRoles) {
	return (req, res, next) => {
		try {
			console.log("🔐 [CHECK ROLES] Vérification rôle:", {
				url: req.originalUrl,
				method: req.method,
				userId: req.user?.id,
				userEmail: req.user?.email,
				userRole: req.user?.role,
				allowedRoles: allowedRoles
			});

			if (!req.user) {
				console.warn("❌ [CHECK ROLES] req.user manquant - authentification requise");
				return res.status(401).json({ message: "Authentification requise." });
			}

			if (!req.user.role) {
				console.warn("❌ [CHECK ROLES] Rôle utilisateur manquant dans req.user");
				return res.status(403).json({ message: "Rôle utilisateur manquant." });
			}

			// ✅ Harmonisation rôle "server" <-> "server"
			let userRole = req.user.role;
			if (userRole === "server") userRole = "server";

			if (!allowedRoles.includes(userRole)) {
				console.warn(`❌ [CHECK ROLES] Accès refusé - Rôle ${req.user.role} pas dans [${allowedRoles.join(', ')}]`);
				return res.status(403).json({
					message: "Accès refusé : rôle utilisateur insuffisant.",
					role: req.user.role,
					allowedRoles,
				});
			}

			console.log("✅ [CHECK ROLES] Accès autorisé pour le rôle:", userRole);
			next();
		} catch (error) {
			console.error("❌ [CHECK ROLES] Erreur dans checkRoles:", error);
			res.status(500).json({ message: "Erreur server interne." });
		}
	};
};
