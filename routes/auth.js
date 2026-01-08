const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Server = require("../models/Server");
const RefreshTokenStore = require("../utils/RefreshTokenStore");
const router = express.Router();
const jwtBlacklist = require("../utils/jwtBlacklist");
const auth = require("../middlewares/auth");
const { loginLimiter, strictLimiter } = require("../middlewares/rateLimiter");
const validatePasswordComplexity = require("../middlewares/validatePasswordComplexity");

// POST /login - Authentification + génération tokens (PROTECTION BRUTE-FORCE)
router.post("/login", loginLimiter, async (req, res) => {
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

		// 🔒 VÉRIFICATION ABONNEMENT : Si restaurant désactivé, bloquer la connexion
		// ⚠️ Exception : Les développeurs peuvent toujours se connecter
	let restaurantCategory = "restaurant"; // Par défaut
	if (user.role !== "developer" && user.restaurantId) {
		const Restaurant = require("../models/Restaurant");
		const restaurant = await Restaurant.findById(user.restaurantId);

		if (restaurant && !restaurant.active) {
			console.log(
				`🚫 Connexion refusée - Restaurant désactivé: ${restaurant.name} (${user.email})`
			);
			return res.status(403).json({
				message:
					"Restaurant désactivé - Veuillez procéder au paiement pour réactiver votre compte",
				code: "RESTAURANT_DISABLED",
				restaurantName: restaurant.name,
			});
		}

		// 🍔 Récupérer la catégorie du restaurant (foodtruck, restaurant, snack, etc.)
		if (restaurant) {
			restaurantCategory = restaurant.category || "restaurant";
			console.log("🍔 [AUTH] Category extraite du restaurant:", restaurantCategory, "pour restaurant:", restaurant.name);
		}
	}

	const payload = {
		id: user._id,
		email: user.email,
		role: user.role,
		userType,
		restaurantId: user.restaurantId || null,
		category: restaurantCategory,
	};

	// === Vérification JWT_SECRET (sans logs sensibles) ===
	const jwtSecret = process.env.JWT_SECRET;
	if (!jwtSecret || jwtSecret.trim() === "") {
		console.error("❌ CRITICAL: JWT_SECRET is empty or undefined!");
		return res
			.status(500)
			.json({ message: "Server configuration error (JWT_SECRET missing)" });
	}

	const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
	if (!refreshSecret || refreshSecret.trim() === "") {
		console.error("❌ CRITICAL: REFRESH_TOKEN_SECRET is empty or undefined!");
		return res.status(500).json({
			message: "Server configuration error (REFRESH_TOKEN_SECRET missing)",
		});
	}

	let accessToken, refreshToken;
	try {
		accessToken = jwt.sign(payload, jwtSecret, {
			expiresIn: "2h",
		});
	} catch (error) {
		console.error("JWT sign error details (accessToken):", error.message);
		throw error;
	}
	try {
		refreshToken = jwt.sign(payload, refreshSecret, {
			expiresIn: "7d",
		});
	} catch (error) {
		console.error("JWT sign error details (refreshToken):", error.message);
		throw error;
	}

	// Stockage en base du refresh token avec expiration TTL gérée par MongoDB
	await RefreshTokenStore.add(refreshToken, payload, 7 * 24 * 3600);

	// Cookie sécurisé pour le refresh token
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
	});

	// ⭐ Construire la réponse avec serverId si c'est un serveur
	const response = {
		accessToken,
		refreshToken, // ⭐ IMPORTANT: Envoyer le refreshToken aussi au frontend (AsyncStorage)
		userId: user._id,
		email: user.email,
		role: user.role,
		userType,
		restaurantId: user.restaurantId || null,
		category: restaurantCategory, // 🍔 Catégorie du restaurant (foodtruck, restaurant, etc.)
	};

	// ⭐ Si c'est un serveur, ajouter serverId et tableId
	if (userType === "server") {
		response.serverId = user._id.toString();
		if (user.tableId) {
			response.tableId = user.tableId.toString();
		}
	}

	// ⭐ Si c'est un developer, ajouter la liste des restaurants
	if (user.role === "developer") {
		const Restaurant = require("../models/Restaurant");
		const restaurants = await Restaurant.find()
			.select("_id name email phone address")
			.lean();
		response.restaurants = restaurants;
		response.isDeveloper = true;
	}

	console.log("🚀 [AUTH] Réponse envoyée au frontend - category:", response.category, "role:", response.role, "restaurantId:", response.restaurantId);
	return res.json(response);
	} catch (err) {
		console.error("Erreur login:", err);
		return res.status(500).json({ message: "Erreur server." });
	}
});

// POST /refresh - Rafraîchissement du token d'accès via refresh token (PROTECTION)
router.post("/refresh", strictLimiter, async (req, res) => {
	try {
		// ⭐ Accepter le refresh token depuis les cookies OU le body
		const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

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
					expiresIn: "2h", // ⭐ Augmenté de 15m à 2h pour plus de confort
				});

				const newRefreshToken = jwt.sign(
					payload,
					process.env.REFRESH_TOKEN_SECRET,
					{ expiresIn: "7d" }
				);

				// Supprime l'ancien refresh token et ajoute le nouveau
				await RefreshTokenStore.remove(refreshToken);
				await RefreshTokenStore.add(newRefreshToken, payload, 7 * 24 * 3600);

				// ⭐ Garder le cookie pour les navigateurs web, mais aussi retourner le token en JSON
				res.cookie("refreshToken", newRefreshToken, {
					httpOnly: true,
					secure: process.env.NODE_ENV === "production",
					sameSite: "strict",
					maxAge: 7 * 24 * 60 * 60 * 1000,
				});

				// ⭐ Retourner les deux tokens en JSON pour React Native
				return res.json({
					accessToken: newAccessToken,
					refreshToken: newRefreshToken,
				});
			}
		);
	} catch (err) {
		console.error("Erreur refresh token:", err);
		return res.status(500).json({ message: "Erreur server." });
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
		res.status(500).json({ message: "Erreur server lors de la déconnexion." });
	}
});

// POST /change-password - Modifier son propre mot de passe (avec validation complexité)
router.post(
	"/change-password",
	auth,
	validatePasswordComplexity,
	async (req, res) => {
		try {
			const { currentPassword, newPassword } = req.body;
			const userId = req.user.id;
			const userType = req.user.userType;

			// Validations
			if (!currentPassword || !newPassword) {
				return res.status(400).json({
					message:
						"Le mot de passe actuel et le nouveau mot de passe sont requis.",
				});
			}

			if (newPassword.length < 6) {
				return res.status(400).json({
					message:
						"Le nouveau mot de passe doit contenir au moins 6 caractères.",
				});
			}

			// Trouver l'utilisateur selon son type
			let user;
			if (userType === "admin") {
				user = await Admin.findById(userId);
			} else {
				user = await Server.findById(userId);
			}

			if (!user) {
				return res.status(404).json({ message: "Utilisateur non trouvé." });
			}

			// Vérifier le mot de passe actuel
			const validPassword = await bcrypt.compare(
				currentPassword,
				user.passwordHash
			);
			if (!validPassword) {
				return res
					.status(401)
					.json({ message: "Mot de passe actuel incorrect." });
			}

			// Hasher et sauvegarder le nouveau mot de passe
			const salt = await bcrypt.genSalt(10);
			const newPasswordHash = await bcrypt.hash(newPassword, salt);

			user.passwordHash = newPasswordHash;
			await user.save();

			console.log(`✅ Mot de passe modifié pour ${user.email}`);
			res.status(200).json({ message: "Mot de passe modifié avec succès." });
		} catch (err) {
			console.error("Erreur change-password:", err);
			res.status(500).json({ message: "Erreur serveur." });
		}
	}
);

module.exports = router;
