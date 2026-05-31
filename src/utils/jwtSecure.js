/**
 * 🔐 Système JWT sécurisé avec refresh tokens
 *
 * OBJECTIFS SÉCURITÉ :
 * - Access tokens courts (15 min)
 * - Refresh tokens longs (7 jours)
 * - Rotation automatique des refresh tokens
 * - Invalidation côté serveur (blacklist)
 * - Protection contre vol de tokens
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const logger = require("./secureLogger");

// ✅ Configuration JWT sécurisée
const JWT_CONFIG = {
	// ✅ Access token court pour sécurité
	ACCESS_TOKEN_EXPIRES: "15m",

	// ✅ Refresh token plus long pour UX
	REFRESH_TOKEN_EXPIRES: "7d",

	// ✅ Algorithme sécurisé
	ALGORITHM: "HS256",

	// ✅ Issuer pour validation
	ISSUER: "SunnyGo-API",

	// ✅ Audience pour validation
	AUDIENCE: "SunnyGo-App",
};

// ✅ Store en mémoire pour les tokens révoqués (blacklist)
// TODO: En production, utiliser Redis pour la persistance
const revokedTokens = new Set();
const refreshTokenStore = new Map(); // refreshToken -> { userId, expiresAt, deviceId }

/**
 * 🔐 Génère une paire access + refresh tokens
 */
const generateTokenPair = (user, deviceId = null) => {
	try {
		// ✅ Payload minimal pour access token
		const accessPayload = {
			id: user._id || user.id,
			email: user.email,
			role: user.role,
			restaurantId: user.restaurantId || null,
			type: "access",
		};

		// ✅ Payload pour refresh token
		const refreshPayload = {
			id: user._id || user.id,
			email: user.email,
			type: "refresh",
			deviceId: deviceId || crypto.randomBytes(16).toString("hex"),
		};

		// ✅ Génération sécurisée
		const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
			expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRES,
			issuer: JWT_CONFIG.ISSUER,
			audience: JWT_CONFIG.AUDIENCE,
			algorithm: JWT_CONFIG.ALGORITHM,
		});

		const refreshToken = jwt.sign(
			refreshPayload,
			process.env.JWT_REFRESH_SECRET,
			{
				expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRES,
				issuer: JWT_CONFIG.ISSUER,
				audience: JWT_CONFIG.AUDIENCE,
				algorithm: JWT_CONFIG.ALGORITHM,
			},
		);

		// ✅ Stocker le refresh token avec métadonnées
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
		refreshTokenStore.set(refreshToken, {
			userId: user._id || user.id,
			expiresAt,
			deviceId: refreshPayload.deviceId,
		});

		logger.info("Nouvelle paire de tokens générée", { userId: user._id });

		return {
			accessToken,
			refreshToken,
			expiresIn: 900, // 15 minutes en secondes
			tokenType: "Bearer",
		};
	} catch (error) {
		logger.error("Erreur génération tokens:", error);
		throw new Error("Erreur génération tokens");
	}
};

/**
 * 🔐 Vérifie un access token
 */
const verifyAccessToken = (token) => {
	try {
		// ✅ Vérifier si le token n'est pas révoqué
		if (revokedTokens.has(token)) {
			throw new Error("Token révoqué");
		}

		// ✅ Vérification complète avec claims
		const decoded = jwt.verify(token, process.env.JWT_SECRET, {
			issuer: JWT_CONFIG.ISSUER,
			audience: JWT_CONFIG.AUDIENCE,
			algorithms: [JWT_CONFIG.ALGORITHM],
		});

		// ✅ Vérifier le type de token
		if (decoded.type !== "access") {
			throw new Error("Type de token invalide");
		}

		return decoded;
	} catch (error) {
		if (error.name === "TokenExpiredError") {
			throw new Error("Token expiré");
		} else if (error.name === "JsonWebTokenError") {
			throw new Error("Token invalide");
		} else {
			throw error;
		}
	}
};

/**
 * 🔐 Vérifie un refresh token
 */
const verifyRefreshToken = (token) => {
	try {
		// ✅ Vérifier si le token n'est pas révoqué
		if (revokedTokens.has(token)) {
			throw new Error("Refresh token révoqué");
		}

		// ✅ Vérifier s'il existe dans le store
		if (!refreshTokenStore.has(token)) {
			throw new Error("Refresh token inconnu");
		}

		// ✅ Vérification JWT
		const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
			issuer: JWT_CONFIG.ISSUER,
			audience: JWT_CONFIG.AUDIENCE,
			algorithms: [JWT_CONFIG.ALGORITHM],
		});

		// ✅ Vérifier le type
		if (decoded.type !== "refresh") {
			throw new Error("Type de token invalide");
		}

		// ✅ Vérifier l'expiration côté store
		const tokenData = refreshTokenStore.get(token);
		if (new Date() > tokenData.expiresAt) {
			refreshTokenStore.delete(token);
			throw new Error("Refresh token expiré");
		}

		return { decoded, tokenData };
	} catch (error) {
		if (error.name === "TokenExpiredError") {
			refreshTokenStore.delete(token);
			throw new Error("Refresh token expiré");
		} else if (error.name === "JsonWebTokenError") {
			throw new Error("Refresh token invalide");
		} else {
			throw error;
		}
	}
};

/**
 * 🔐 Renouvelle les tokens avec rotation du refresh token
 */
const refreshTokens = async (oldRefreshToken, getUserById) => {
	try {
		const { decoded, tokenData } = verifyRefreshToken(oldRefreshToken);

		// ✅ Récupérer l'utilisateur actuel (pour infos à jour)
		const user = await getUserById(decoded.id);
		if (!user) {
			throw new Error("Utilisateur non trouvé");
		}

		// ✅ Révoquer l'ancien refresh token (rotation)
		revokeToken(oldRefreshToken);

		// ✅ Générer nouvelle paire avec même deviceId
		const tokens = generateTokenPair(user, tokenData.deviceId);

		logger.info("Tokens renouvelés avec succès", {
			userId: user._id,
			deviceId: tokenData.deviceId,
		});

		return tokens;
	} catch (error) {
		logger.error("Erreur renouvellement tokens:", error);
		revokeToken(oldRefreshToken); // Sécurité: révoquer en cas d'erreur
		throw error;
	}
};

/**
 * 🔐 Révoque un token (blacklist)
 */
const revokeToken = (token) => {
	try {
		revokedTokens.add(token);

		// ✅ Si c'est un refresh token, le supprimer du store
		if (refreshTokenStore.has(token)) {
			refreshTokenStore.delete(token);
		}

		logger.info("Token révoqué avec succès");
	} catch (error) {
		logger.error("Erreur révocation token:", error);
	}
};

/**
 * 🔐 Révoque tous les tokens d'un utilisateur (logout global)
 */
const revokeAllUserTokens = (userId) => {
	try {
		let revokedCount = 0;

		// ✅ Supprimer tous les refresh tokens de cet utilisateur
		for (const [token, data] of refreshTokenStore.entries()) {
			if (data.userId === userId) {
				refreshTokenStore.delete(token);
				revokedTokens.add(token);
				revokedCount++;
			}
		}

		logger.info("Tous les tokens utilisateur révoqués", {
			userId,
			tokensRevoked: revokedCount,
		});
	} catch (error) {
		logger.error("Erreur révocation tokens utilisateur:", error);
	}
};

/**
 * 🧹 Nettoyage périodique des tokens expirés
 */
const cleanupExpiredTokens = () => {
	const now = new Date();
	let cleanedCount = 0;

	for (const [token, data] of refreshTokenStore.entries()) {
		if (now > data.expiresAt) {
			refreshTokenStore.delete(token);
			revokedTokens.delete(token);
			cleanedCount++;
		}
	}

	if (cleanedCount > 0) {
		logger.info("Nettoyage tokens expirés", { tokensCleanedUp: cleanedCount });
	}
};

// ✅ Nettoyage automatique toutes les heures
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

module.exports = {
	generateTokenPair,
	verifyAccessToken,
	verifyRefreshToken,
	refreshTokens,
	revokeToken,
	revokeAllUserTokens,
	cleanupExpiredTokens,
	JWT_CONFIG,
};
