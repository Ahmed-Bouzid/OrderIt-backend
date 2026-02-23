const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Server = require("../models/Server");
const PasswordReset = require("../models/PasswordReset");
const RefreshTokenStore = require("../utils/RefreshTokenStore");
const router = express.Router();
const jwtBlacklist = require("../utils/jwtBlacklist");
const auth = require("../middlewares/auth");
const { loginLimiter, strictLimiter } = require("../middlewares/rateLimiter");
const validatePasswordComplexity = require("../middlewares/validatePasswordComplexity");
const { OAuth2Client } = require("google-auth-library");
const { sendPasswordResetEmail } = require("../services/emailService");

// POST /login - Authentification + génération tokens (PROTECTION BRUTE-FORCE)
router.post("/login", loginLimiter, async (req, res) => {
	try {
		const { email, password } = req.body;

		// 🕵️ LOG 1: Données reçues
		console.log(
			"🔑 [AUTH DEBUG] Tentative de connexion pour:",
			email?.substring(0, 3) + "***",
		);
		console.log(
			"🔑 [AUTH DEBUG] Mot de passe reçu:",
			password ? "OUI (" + password.length + " chars)" : "NON",
		);

		let user = await Admin.findOne({ email });
		let userType = "admin";

		// 🕵️ LOG 2: Recherche dans Admin
		console.log(
			"🔍 [AUTH DEBUG] Recherche dans Admin:",
			user ? "TROUVÉ" : "PAS TROUVÉ",
		);

		if (!user) {
			user = await Server.findOne({ email });
			userType = "server";

			// 🕵️ LOG 3: Recherche dans Server
			console.log(
				"🔍 [AUTH DEBUG] Recherche dans Server:",
				user ? "TROUVÉ" : "PAS TROUVÉ",
			);
		}

		if (!user) {
			// 🕵️ LOG 4: Utilisateur non trouvé
			console.log(
				"❌ [AUTH DEBUG] UTILISATEUR NON TROUVÉ pour email:",
				email?.substring(0, 3) + "***",
			);
			return res.status(401).json({ message: "Identifiants invalides." });
		}

		// 🕵️ LOG 5: Utilisateur trouvé
		console.log(
			"✅ [AUTH DEBUG] Utilisateur trouvé - Type:",
			userType,
			"Role:",
			user.role,
		);

		const validPassword = await bcrypt.compare(password, user.passwordHash);

		// 🕵️ LOG 6: Vérification mot de passe
		console.log(
			"🔐 [AUTH DEBUG] Mot de passe valide:",
			validPassword ? "OUI" : "NON",
		);
		console.log(
			"🔐 [AUTH DEBUG] Hash en DB:",
			user.passwordHash
				? "PRÉSENT (" + user.passwordHash.length + " chars)"
				: "ABSENT",
		);

		if (!validPassword) {
			console.log(
				"❌ [AUTH DEBUG] MOT DE PASSE INCORRECT pour:",
				email?.substring(0, 3) + "***",
			);
			return res.status(401).json({ message: "Identifiants invalides." });
		}

		// 🔒 VÉRIFICATION ABONNEMENT : Si restaurant désactivé, bloquer la connexion
		// ⚠️ Exception : Les développeurs peuvent toujours se connecter
		// 🚨 TEMPORAIREMENT DÉSACTIVÉ pour tests
		let restaurantCategory = "restaurant"; // Par défaut
		let restaurantFeatureOverrides = {}; // Par défaut : aucun override
		if (user.role !== "developer" && user.restaurantId) {
			const Restaurant = require("../models/Restaurant");
			const restaurant = await Restaurant.findById(user.restaurantId);

			// 🚨 COMMENTÉ TEMPORAIREMENT : Vérification d'abonnement désactivée
			/* if (restaurant && !restaurant.active) {
				console.log(
					`🚫 Connexion refusée - Restaurant désactivé: ${restaurant.name} (${user.email})`,
				);
				return res.status(403).json({
					message:
						"Restaurant désactivé - Veuillez procéder au paiement pour réactiver votre compte",
					code: "RESTAURANT_DISABLED",
					restaurantName: restaurant.name,
				});
			} */

			// 🍔 Récupérer la catégorie du restaurant (foodtruck, restaurant, snack, etc.)
			if (restaurant) {
				restaurantCategory = restaurant.category || "restaurant";
				console.log(
					"🍔 [AUTH] Category extraite du restaurant:",
					restaurantCategory,
					"pour restaurant:",
					restaurant.name,
				);
				// 🔧 Extraire les feature overrides (map MongoDB → objet plain)
				if (restaurant.featureOverrides && restaurant.featureOverrides.size > 0) {
					restaurantFeatureOverrides = Object.fromEntries(restaurant.featureOverrides);
				}
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

		// 🕵️ LOG 7: Variables d'environnement
		console.log(
			"🔧 [AUTH DEBUG] JWT_SECRET présent:",
			jwtSecret ? "OUI (" + jwtSecret.length + " chars)" : "NON",
		);
		console.log("🔧 [AUTH DEBUG] NODE_ENV:", process.env.NODE_ENV);

		if (!jwtSecret || jwtSecret.trim() === "") {
			console.error("❌ CRITICAL: JWT_SECRET is empty or undefined!");
			return res
				.status(500)
				.json({ message: "Server configuration error (JWT_SECRET missing)" });
		}

		const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
		console.log(
			"🔧 [AUTH DEBUG] REFRESH_TOKEN_SECRET présent:",
			refreshSecret ? "OUI (" + refreshSecret.length + " chars)" : "NON",
		);

		if (!refreshSecret || refreshSecret.trim() === "") {
			console.error("❌ CRITICAL: REFRESH_TOKEN_SECRET is empty or undefined!");
			return res.status(500).json({
				message: "Server configuration error (REFRESH_TOKEN_SECRET missing)",
			});
		}

		let accessToken, refreshToken;

		// 🕵️ LOG 8: Génération des tokens
		console.log(
			"🎫 [AUTH DEBUG] Payload pour les tokens:",
			JSON.stringify(payload, null, 2),
		);

		try {
			accessToken = jwt.sign(payload, jwtSecret, {
				expiresIn: "2h",
			});
			console.log(
				"✅ [AUTH DEBUG] AccessToken généré avec succès (" +
					accessToken.length +
					" chars)",
			);
		} catch (error) {
			console.error(
				"❌ [AUTH DEBUG] Erreur génération accessToken:",
				error.message,
			);
			console.error("JWT sign error details (accessToken):", error.message);
			throw error;
		}
		try {
			refreshToken = jwt.sign(payload, refreshSecret, {
				expiresIn: "7d",
			});
			console.log(
				"✅ [AUTH DEBUG] RefreshToken généré avec succès (" +
					refreshToken.length +
					" chars)",
			);
		} catch (error) {
			console.error(
				"❌ [AUTH DEBUG] Erreur génération refreshToken:",
				error.message,
			);
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
			featureOverrides: restaurantFeatureOverrides, // 🔧 Overrides fonctionnalités (developer mode)
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

		console.log(
			"🚀 [AUTH] Réponse envoyée au frontend - category:",
			response.category,
			"role:",
			response.role,
			"restaurantId:",
			response.restaurantId,
		);

		// 🕵️ LOG 9: Réponse finale
		console.log(
			"🎯 [AUTH DEBUG] SUCCÈS - Envoi de la réponse complète au frontend",
		);
		console.log(
			"🎯 [AUTH DEBUG] Taille de la réponse:",
			JSON.stringify(response).length + " chars",
		);

		return res.json(response);
	} catch (err) {
		// 🕵️ LOG 10: Erreur catch
		console.error("❌ [AUTH DEBUG] ERREUR CATCH - Détails complets:", err);
		console.error("❌ [AUTH DEBUG] Stack trace:", err.stack);
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
					{ expiresIn: "7d" },
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
			},
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
						err,
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
				user.passwordHash,
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
	},
);

// 🔐 POST /google-login - Authentification via Google OAuth
router.post("/google-login", loginLimiter, async (req, res) => {
	try {
		const { idToken } = req.body;

		if (!idToken) {
			return res.status(400).json({ message: "Token Google manquant" });
		}

		// Vérifier le token Google
		const googleClientId = process.env.GOOGLE_CLIENT_ID;
		if (!googleClientId) {
			console.error("❌ GOOGLE_CLIENT_ID non configuré");
			return res.status(500).json({ message: "Configuration OAuth manquante" });
		}

		const client = new OAuth2Client(googleClientId);
		let payload;

		try {
			const ticket = await client.verifyIdToken({
				idToken,
				audience: googleClientId,
			});
			payload = ticket.getPayload();
		} catch (verifyError) {
			console.error("❌ Token Google invalide:", verifyError.message);
			return res.status(401).json({ message: "Token Google invalide" });
		}

		const { sub: googleId, email, name } = payload;

		if (!email) {
			return res.status(400).json({ message: "Email Google manquant" });
		}

		console.log(`🔐 [GOOGLE AUTH] Tentative connexion: ${email}`);

		// Chercher user existant (Admin ou Server) par googleId ou email
		let user = await Admin.findOne({ $or: [{ googleId }, { email }] });
		let userType = "admin";

		if (!user) {
			user = await Server.findOne({ $or: [{ googleId }, { email }] });
			userType = "server";
		}

		// Si user existe avec email mais pas googleId, lier le compte
		if (user && !user.googleId) {
			user.googleId = googleId;
			user.authProvider = "google";
			await user.save();
			console.log(`🔗 [GOOGLE AUTH] Compte lié: ${email}`);
		}

		// Si user n'existe pas, créer un nouveau compte Admin
		if (!user) {
			// Générer serverId unique pour nouvel admin
			const lastAdmin = await Admin.findOne()
				.sort({ serverId: -1 })
				.select("serverId");
			const lastId = lastAdmin
				? parseInt(lastAdmin.serverId.replace("S", ""))
				: 0;
			const newServerId = `S${String(lastId + 1).padStart(4, "0")}`;

			user = await Admin.create({
				serverId: newServerId,
				name: name || email.split("@")[0],
				email,
				googleId,
				authProvider: "google",
				role: "admin",
				// passwordHash non requis pour OAuth
			});

			userType = "admin";
			console.log(`✅ [GOOGLE AUTH] Nouveau compte créé: ${email}`);
		}

		// Récupérer catégorie restaurant si applicable
		let restaurantCategory = "restaurant";
		let restaurantFeatureOverrides = {}; // Par défaut : aucun override
		if (user.role !== "developer" && user.restaurantId) {
			const Restaurant = require("../models/Restaurant");
			const restaurant = await Restaurant.findById(user.restaurantId);

			if (restaurant && !restaurant.active) {
				console.log(
					`🚫 Connexion refusée - Restaurant désactivé: ${restaurant.name}`,
				);
				return res.status(403).json({
					message: "Restaurant désactivé",
					code: "RESTAURANT_DISABLED",
					restaurantName: restaurant.name,
				});
			}

			if (restaurant) {
				restaurantCategory = restaurant.category || "restaurant";
				// 🔧 Extraire les feature overrides (map MongoDB → objet plain)
				if (restaurant.featureOverrides && restaurant.featureOverrides.size > 0) {
					restaurantFeatureOverrides = Object.fromEntries(restaurant.featureOverrides);
				}
			}
		}

		// Générer JWT SunnyGo
		const jwtPayload = {
			id: user._id,
			email: user.email,
			role: user.role,
			userType,
			restaurantId: user.restaurantId || null,
			category: restaurantCategory,
		};

		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret || jwtSecret.trim() === "") {
			console.error("❌ CRITICAL: JWT_SECRET is empty or undefined!");
			return res
				.status(500)
				.json({ message: "Configuration serveur manquante" });
		}

		const accessToken = jwt.sign(jwtPayload, jwtSecret, { expiresIn: "1h" });
		const refreshToken = jwt.sign(jwtPayload, jwtSecret, { expiresIn: "7d" });

		await RefreshTokenStore.add(refreshToken);

		console.log(`✅ [GOOGLE AUTH] Connexion réussie: ${email}`);

		res.status(200).json({
			message: "Connexion Google réussie",
			accessToken,
			refreshToken,
			user: {
				id: user._id,
				email: user.email,
				name: user.name,
				role: user.role,
				restaurantId: user.restaurantId,
				category: restaurantCategory,
				featureOverrides: restaurantFeatureOverrides, // 🔧 Overrides fonctionnalités
			},
		});
	} catch (err) {
		console.error("❌ [GOOGLE AUTH] Erreur:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// 📧 POST /forgot-password - Demande de réinitialisation de mot de passe
router.post("/forgot-password", strictLimiter, async (req, res) => {
	try {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({ message: "Email requis" });
		}

		const normalizedEmail = email.toLowerCase().trim();
		console.log(`🔐 [FORGOT-PASSWORD] Demande pour: ${normalizedEmail}`);

		// Chercher l'utilisateur (Admin ou Server)
		let user = await Admin.findOne({ email: normalizedEmail });
		let userType = "admin";

		if (!user) {
			user = await Server.findOne({ email: normalizedEmail });
			userType = "server";
		}

		// SÉCURITÉ: Toujours répondre succès même si email non trouvé (anti-énumération)
		if (!user) {
			console.log(`⚠️ [FORGOT-PASSWORD] Email non trouvé: ${normalizedEmail}`);
			return res.status(200).json({
				message:
					"Si cet email existe, un code de réinitialisation a été envoyé.",
			});
		}

		// Vérifier si l'utilisateur utilise OAuth (pas de mot de passe)
		if (user.authProvider === "google" && !user.passwordHash) {
			console.log(`⚠️ [FORGOT-PASSWORD] Compte OAuth: ${normalizedEmail}`);
			return res.status(200).json({
				message:
					"Si cet email existe, un code de réinitialisation a été envoyé.",
			});
		}

		// Créer le token de reset
		const resetDoc = await PasswordReset.createResetToken(
			normalizedEmail,
			user._id,
			userType,
		);

		console.log(`✅ [FORGOT-PASSWORD] Token généré pour: ${normalizedEmail}`);

		// Envoyer l'email
		const emailResult = await sendPasswordResetEmail(
			normalizedEmail,
			resetDoc.token,
		);

		if (!emailResult.success) {
			console.error(
				`❌ [FORGOT-PASSWORD] Échec envoi email: ${emailResult.error}`,
			);
			// Ne pas exposer l'erreur au client
		}

		res.status(200).json({
			message: "Si cet email existe, un code de réinitialisation a été envoyé.",
		});
	} catch (err) {
		console.error("❌ [FORGOT-PASSWORD] Erreur:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// 🔐 POST /reset-password - Réinitialiser le mot de passe avec le code
router.post(
	"/reset-password",
	strictLimiter,
	validatePasswordComplexity,
	async (req, res) => {
		try {
			const { email, token, newPassword } = req.body;

			if (!email || !token || !newPassword) {
				return res.status(400).json({
					message: "Email, code et nouveau mot de passe requis",
				});
			}

			const normalizedEmail = email.toLowerCase().trim();
			console.log(`🔐 [RESET-PASSWORD] Tentative pour: ${normalizedEmail}`);

			// Vérifier le token
			const verification = await PasswordReset.verifyToken(
				normalizedEmail,
				token,
			);

			if (!verification.valid) {
				// Incrémenter les tentatives échouées
				await PasswordReset.incrementAttempts(normalizedEmail);
				console.log(
					`⚠️ [RESET-PASSWORD] Token invalide pour: ${normalizedEmail}`,
				);
				return res.status(400).json({ message: verification.error });
			}

			// Trouver l'utilisateur
			let user;
			if (verification.userType === "admin") {
				user = await Admin.findById(verification.userId);
			} else {
				user = await Server.findById(verification.userId);
			}

			if (!user) {
				return res.status(404).json({ message: "Utilisateur non trouvé" });
			}

			// Hasher et sauvegarder le nouveau mot de passe
			const salt = await bcrypt.genSalt(10);
			user.passwordHash = await bcrypt.hash(newPassword, salt);
			await user.save();

			// Marquer le token comme utilisé
			await PasswordReset.markAsUsed(normalizedEmail, token);

			// Supprimer tous les tokens de reset pour cet email
			await PasswordReset.deleteMany({ email: normalizedEmail });

			console.log(
				`✅ [RESET-PASSWORD] Mot de passe réinitialisé pour: ${normalizedEmail}`,
			);

			res.status(200).json({
				message:
					"Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
			});
		} catch (err) {
			console.error("❌ [RESET-PASSWORD] Erreur:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// 🔍 POST /verify-reset-token - Vérifier si un token est valide (optionnel, pour UX)
router.post("/verify-reset-token", strictLimiter, async (req, res) => {
	try {
		const { email, token } = req.body;

		if (!email || !token) {
			return res.status(400).json({ message: "Email et code requis" });
		}

		const normalizedEmail = email.toLowerCase().trim();
		const verification = await PasswordReset.verifyToken(
			normalizedEmail,
			token,
		);

		if (!verification.valid) {
			await PasswordReset.incrementAttempts(normalizedEmail);
			return res
				.status(400)
				.json({ valid: false, message: verification.error });
		}

		res.status(200).json({ valid: true, message: "Code valide" });
	} catch (err) {
		console.error("❌ [VERIFY-RESET-TOKEN] Erreur:", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// TEMPORAIRE - GET /auth/accounting-summary pour test
router.get("/accounting-summary", auth, async (req, res) => {
	try {
		console.log("💰 [TEMP-ACCOUNTING] Test endpoint appelé");

		// Données de test basiques pour valider que l'endpoint fonctionne
		const testData = {
			success: true,
			data: {
				totalRevenue: 1234.56,
				totalOrders: 28,
				averageOrderValue: 44.09,
				topProduct: "Pizza Margherita",
				monthlyRevenue: 15678.9,
				period: "today",
				date: new Date().toISOString().split("T")[0],
			},
		};

		console.log("✅ [TEMP-ACCOUNTING] Données test retournées");
		res.json(testData);
	} catch (error) {
		console.error("❌ [TEMP-ACCOUNTING] Erreur:", error);
		res.status(500).json({
			success: false,
			message: "Erreur temporaire",
			error: error.message,
		});
	}
});

// Test endpoint simple
router.get("/test-simple", (req, res) => {
	res.json({ message: "Test simple fonctionne", timestamp: new Date() });
});

module.exports = router;
