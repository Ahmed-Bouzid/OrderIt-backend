/**
 * 🔐 Middleware de vérification MFA (Multi-Factor Authentication)
 * Appliqué sur les routes sensibles nécessitant une double authentification
 *
 * Fonctionnement:
 * 1. Vérifie que l'utilisateur a activé le MFA
 * 2. Vérifie le code TOTP (6 chiffres) fourni dans le header X-MFA-Code
 * 3. Autorise l'accès seulement si le code est valide
 */
const speakeasy = require("speakeasy");
const Admin = require("../models/Admin");
const Server = require("../models/Server");

/**
 * Middleware pour vérifier le code MFA sur les routes sensibles
 */
const verifyMFA = async (req, res, next) => {
	try {
		// Récupérer l'utilisateur depuis req.user (défini par le middleware auth)
		const userId = req.user?.id;
		const userType = req.user?.userType;

		if (!userId || !userType) {
			return res.status(401).json({
				message: "Non authentifié",
			});
		}

		// Récupérer l'utilisateur depuis la DB
		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				message: "Utilisateur non trouvé",
			});
		}

		// Si MFA non activé pour cet utilisateur, passer (optionnel)
		// ⚠️ Pour forcer MFA sur admin/developer, décommenter ci-dessous :
		/*
		if (!user.mfaEnabled && (user.role === "admin" || user.role === "developer")) {
			return res.status(403).json({
				message: "MFA obligatoire pour ce rôle",
				code: "MFA_REQUIRED",
			});
		}
		*/

		// Si MFA non activé, passer (MFA optionnel)
		if (!user.mfaEnabled) {
			return next();
		}

		// Récupérer le code MFA depuis le header
		const mfaCode = req.headers["x-mfa-code"];

		if (!mfaCode) {
			return res.status(403).json({
				message: "Code MFA requis",
				code: "MFA_CODE_REQUIRED",
			});
		}

		// Vérifier le code TOTP
		const verified = speakeasy.totp.verify({
			secret: user.mfaSecret,
			encoding: "base32",
			token: mfaCode,
			window: 1, // Accepte 1 code avant/après (30s de marge)
		});

		if (!verified) {
			// Log tentative échouée pour monitoring
			console.warn(`⚠️ Tentative MFA échouée pour ${user.email} (${userId})`);

			return res.status(403).json({
				message: "Code MFA invalide",
				code: "MFA_INVALID",
			});
		}

		// Code MFA valide, continuer
		console.log(`✅ MFA validé pour ${user.email}`);
		next();
	} catch (error) {
		console.error("❌ Erreur vérification MFA:", error);
		res.status(500).json({
			message: "Erreur vérification MFA",
		});
	}
};

/**
 * Middleware pour vérifier qu'un utilisateur a bien activé le MFA (obligatoire)
 * Utilisé pour forcer l'activation sur admin/developer
 */
const requireMFAEnabled = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		const userType = req.user?.userType;

		if (!userId || !userType) {
			return res.status(401).json({
				message: "Non authentifié",
			});
		}

		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				message: "Utilisateur non trouvé",
			});
		}

		// Forcer MFA pour admin/developer
		if (
			!user.mfaEnabled &&
			(user.role === "admin" || user.role === "developer")
		) {
			return res.status(403).json({
				message:
					"Activation MFA obligatoire pour ce rôle. Configurez MFA dans les paramètres.",
				code: "MFA_SETUP_REQUIRED",
			});
		}

		next();
	} catch (error) {
		console.error("❌ Erreur vérification MFA activé:", error);
		res.status(500).json({
			message: "Erreur vérification MFA",
		});
	}
};

module.exports = { verifyMFA, requireMFAEnabled };
