const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Server = require("../models/Server");
const RefreshTokenStore = require("../utils/RefreshTokenStore");
const router = express.Router();
const jwtBlacklist = require("../utils/jwtBlacklist");

// POST /login - Authentification + génération tokens
router.post("/login", async (req, res) => {
	try {
		const { email, password } = req.body;

		let user = await Admin.findOne({ email });
		let userType = "admin";

		if (!user) {
			user = await Server.findOne({ email });
			userType = "server";
		}

		if (!user) {
			return res.status(401).json({ message: "Identifiants invalides." });
		}

		const validPassword = await bcrypt.compare(password, user.passwordHash);
		if (!validPassword) {
			return res.status(401).json({ message: "Identifiants invalides." });
		}

		const payload = {
			id: user._id,
			email: user.email,
			role: user.role,
			userType,
			restaurantId: user.restaurantId || null,
		};

		const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
			expiresIn: "15m",
		});

		const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
			expiresIn: "7d",
		});

		// Stockage en base du refresh token avec expiration TTL gérée par MongoDB
		await RefreshTokenStore.add(refreshToken, payload, 7 * 24 * 3600);

		// Cookie sécurisé pour le refresh token
		res.cookie("refreshToken", refreshToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
		});

		return res.json({
			accessToken,
			userId: user._id,
			email: user.email,
			role: user.role,
			userType,
		});
	} catch (err) {
		console.error("Erreur login:", err);
		return res.status(500).json({ message: "Erreur serveur." });
	}
});

// POST /refresh - Rafraîchissement du token d'accès via refresh token
router.post("/refresh", async (req, res) => {
	try {
		const refreshToken = req.cookies?.refreshToken;
		if (!refreshToken)
			return res.status(401).json({ message: "Token manquant." });

		const exists = await RefreshTokenStore.exists(refreshToken);
		if (!exists) return res.status(403).json({ message: "Token invalide." });

		jwt.verify(
			refreshToken,
			process.env.REFRESH_TOKEN_SECRET,
			async (err, decoded) => {
				if (err)
					return res.status(403).json({ message: "Token expiré ou invalide." });

				let user = await Admin.findById(decoded.id);
				if (!user) user = await Server.findById(decoded.id);
				if (!user)
					return res.status(404).json({ message: "Utilisateur non trouvé." });

				const payload = {
					id: user._id,
					email: user.email,
					role: user.role,
					userType: user instanceof Admin ? "admin" : "server",
					restaurantId: user.restaurantId || null,
				};

				const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, {
					expiresIn: "15m",
				});

				const newRefreshToken = jwt.sign(
					payload,
					process.env.REFRESH_TOKEN_SECRET,
					{ expiresIn: "7d" }
				);

				// Supprime l’ancien refresh token et ajoute le nouveau
				await RefreshTokenStore.remove(refreshToken);
				await RefreshTokenStore.add(newRefreshToken, payload, 7 * 24 * 3600);

				res.cookie("refreshToken", newRefreshToken, {
					httpOnly: true,
					secure: process.env.NODE_ENV === "production",
					sameSite: "strict",
					maxAge: 7 * 24 * 60 * 60 * 1000,
				});

				return res.json({ accessToken: newAccessToken });
			}
		);
	} catch (err) {
		console.error("Erreur refresh token:", err);
		return res.status(500).json({ message: "Erreur serveur." });
	}
});

// POST /logout - Supprime le refresh token et nettoie le cookie

router.post("/logout", async (req, res) => {
	try {
		const refreshToken = req.cookies?.refreshToken;
		const authHeader = req.headers.authorization || "";
		const token = authHeader.startsWith("Bearer ")
			? authHeader.split(" ")[1]
			: null;

		if (refreshToken) {
			await RefreshTokenStore.remove(refreshToken);
			res.clearCookie("refreshToken", {
				httpOnly: true,
				secure: process.env.NODE_ENV === "production",
				sameSite: "strict",
			});
		}

		if (token) {
			try {
				jwt.verify(token, process.env.JWT_SECRET);
				// Si pas d’erreur => token valide, on le blacklist
				await jwtBlacklist.add(token);
			} catch (err) {
				if (err.name === "TokenExpiredError") {
					console.log("JWT déjà expiré, pas besoin de blacklist");
				} else {
					console.error(
						"Erreur lors de la vérification du JWT dans logout :",
						err
					);
				}
			}
		}

		res.status(200).json({ message: "Déconnexion réussie." });
	} catch (err) {
		console.error("Erreur logout :", err);
		res.status(500).json({ message: "Erreur serveur lors de la déconnexion." });
	}
});

module.exports = router;
