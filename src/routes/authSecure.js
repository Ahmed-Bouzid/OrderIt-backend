/**
 * 🔐 Routes d'authentification sécurisées avec refresh tokens
 *
 * ENDPOINTS :
 * - POST /auth-secure/login - Login avec nouvelle paire de tokens
 * - POST /auth-secure/refresh - Renouvellement des tokens
 * - POST /auth-secure/logout - Révocation des tokens
 * - POST /auth-secure/logout-all - Révocation globale utilisateur
 */

const express = require("express");
const bcrypt = require("bcrypt");
const {
	generateTokenPair,
	refreshTokens,
	revokeToken,
	revokeAllUserTokens,
} = require("../utils/jwtSecure");
const {
	asyncHandler,
	createError,
} = require("../middlewares/secureErrorHandler");
const authSecure = require("../middlewares/authSecure");
const Admin = require("../models/Admin");
const Server = require("../models/Server");
const logger = require("../utils/secureLogger");
const rateLimiter = require("../middlewares/rateLimiter");

const router = express.Router();

/**
 * 🔐 Login sécurisé avec nouvelle paire de tokens
 */
router.post(
	"/login",
	rateLimiter,
	asyncHandler(async (req, res) => {
		const { email, password, deviceId } = req.body;

		if (!email || !password) {
			throw createError(
				"Email et mot de passe requis",
				400,
				"MISSING_CREDENTIALS",
			);
		}

		// ✅ Chercher utilisateur (Admin ou Server)
		let user = await Admin.findOne({ email });
		let userType = "admin";

		if (!user) {
			user = await Server.findOne({ email });
			userType = "server";
		}

		if (!user) {
			logger.security("Tentative login email inexistant", { email });
			throw createError("Identifiants invalides", 401, "INVALID_CREDENTIALS");
		}

		// ✅ Vérifier mot de passe
		const isValidPassword = await bcrypt.compare(password, user.password);
		if (!isValidPassword) {
			logger.security("Tentative login mot de passe incorrect", {
				email,
				userId: user._id,
			});
			throw createError("Identifiants invalides", 401, "INVALID_CREDENTIALS");
		}

		// ✅ Générer nouvelle paire de tokens
		const tokens = generateTokenPair(user, deviceId);

		logger.info("Login réussi avec nouveau système JWT", {
			userId: user._id,
			email,
			userType,
		});

		res.json({
			success: true,
			message: "Authentification réussie",
			user: {
				id: user._id,
				email: user.email,
				role: user.role,
				restaurantId: user.restaurantId,
			},
			tokens: {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresIn: tokens.expiresIn,
				tokenType: tokens.tokenType,
			},
		});
	}),
);

/**
 * 🔐 Renouvellement des tokens
 */
router.post(
	"/refresh",
	asyncHandler(async (req, res) => {
		const { refreshToken } = req.body;

		if (!refreshToken) {
			throw createError("Refresh token requis", 400, "MISSING_REFRESH_TOKEN");
		}

		// ✅ Fonction pour récupérer un utilisateur par ID
		const getUserById = async (userId) => {
			let user = await Admin.findById(userId);
			if (!user) {
				user = await Server.findById(userId);
			}
			return user;
		};

		// ✅ Renouveler les tokens avec rotation
		const newTokens = await refreshTokens(refreshToken, getUserById);

		logger.info("Tokens renouvelés avec succès");

		res.json({
			success: true,
			message: "Tokens renouvelés",
			tokens: {
				accessToken: newTokens.accessToken,
				refreshToken: newTokens.refreshToken,
				expiresIn: newTokens.expiresIn,
				tokenType: newTokens.tokenType,
			},
		});
	}),
);

/**
 * 🔐 Logout (révocation d'un token)
 */
router.post(
	"/logout",
	authSecure,
	asyncHandler(async (req, res) => {
		const { refreshToken } = req.body;

		if (refreshToken) {
			revokeToken(refreshToken);
		}

		logger.info("Logout réussi", { userId: req.user.id });

		res.json({
			success: true,
			message: "Déconnexion réussie",
		});
	}),
);

/**
 * 🔐 Logout global (révocation de tous les tokens utilisateur)
 */
router.post(
	"/logout-all",
	authSecure,
	asyncHandler(async (req, res) => {
		revokeAllUserTokens(req.user.id);

		logger.info("Logout global réussi", { userId: req.user.id });

		res.json({
			success: true,
			message: "Déconnexion globale réussie",
		});
	}),
);

/**
 * 🔍 Vérification du statut d'authentification
 */
router.get("/me", authSecure, (req, res) => {
	res.json({
		success: true,
		user: {
			id: req.user.id,
			email: req.user.email,
			role: req.user.role,
			restaurantId: req.user.restaurantId,
		},
	});
});

module.exports = router;
