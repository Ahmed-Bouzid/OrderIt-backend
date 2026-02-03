/**
 * 🔐 Routes MFA (Multi-Factor Authentication)
 * Gestion de l'activation, vérification et backup codes pour TOTP
 */
const express = require("express");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const router = express.Router();
const auth = require("../middlewares/auth");
const Admin = require("../models/Admin");
const Server = require("../models/Server");
const { strictLimiter } = require("../middlewares/rateLimiter");

/**
 * POST /mfa/setup - Générer un secret TOTP et un QR code
 * Étape 1 : L'utilisateur demande à activer le MFA
 */
router.post("/setup", auth, async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.userType;

		// Récupérer l'utilisateur
		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ message: "Utilisateur non trouvé" });
		}

		// Si MFA déjà activé, refuser (désactiver d'abord)
		if (user.mfaEnabled) {
			return res.status(400).json({
				message: "MFA déjà activé. Désactivez-le d'abord pour le reconfigurer.",
			});
		}

		// Générer un nouveau secret TOTP
		const secret = speakeasy.generateSecret({
			name: `SunnyGo (${user.email})`,
			issuer: "SunnyGo Restaurant",
			length: 32,
		});

		// Générer un QR code pour Google Authenticator / Authy
		const qrCodeDataURL = await QRCode.toDataURL(secret.otpauth_url);

		// Générer 10 backup codes (usage unique)
		const backupCodes = [];
		for (let i = 0; i < 10; i++) {
			const code = crypto.randomBytes(4).toString("hex").toUpperCase();
			backupCodes.push(code);
		}

		// Sauvegarder temporairement (pas encore activé)
		user.mfaSecret = secret.base32;
		user.mfaBackupCodes = backupCodes.map((code) => ({
			code,
			used: false,
		}));
		await user.save();

		res.json({
			message: "Secret MFA généré. Scannez le QR code et validez avec un code.",
			secret: secret.base32, // Pour entrée manuelle
			qrCode: qrCodeDataURL,
			backupCodes, // IMPORTANT : Sauvegarder ces codes (affiché 1 seule fois)
		});
	} catch (error) {
		console.error("❌ Erreur setup MFA:", error);
		res.status(500).json({ message: "Erreur lors de la configuration MFA" });
	}
});

/**
 * POST /mfa/verify-setup - Vérifier le code TOTP et activer le MFA
 * Étape 2 : L'utilisateur entre le code à 6 chiffres pour confirmer
 */
router.post("/verify-setup", auth, strictLimiter, async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.userType;
		const { code } = req.body;

		if (!code || code.length !== 6) {
			return res.status(400).json({
				message: "Code invalide (6 chiffres requis)",
			});
		}

		// Récupérer l'utilisateur
		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user || !user.mfaSecret) {
			return res.status(400).json({
				message: "Aucun setup MFA en cours. Appelez /mfa/setup d'abord.",
			});
		}

		// Vérifier le code TOTP
		const verified = speakeasy.totp.verify({
			secret: user.mfaSecret,
			encoding: "base32",
			token: code,
			window: 2, // Plus de marge pour le setup initial
		});

		if (!verified) {
			return res.status(403).json({
				message: "Code MFA incorrect. Vérifiez l'heure de votre appareil.",
			});
		}

		// Activer le MFA définitivement
		user.mfaEnabled = true;
		await user.save();

		console.log(`✅ MFA activé pour ${user.email} (${user.role})`);

		res.json({
			message: "MFA activé avec succès !",
			mfaEnabled: true,
		});
	} catch (error) {
		console.error("❌ Erreur vérification setup MFA:", error);
		res.status(500).json({ message: "Erreur lors de la vérification MFA" });
	}
});

/**
 * POST /mfa/verify - Vérifier un code MFA (pour usage général)
 * Utilisé après le login pour valider l'accès
 */
router.post("/verify", auth, strictLimiter, async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.userType;
		const { code } = req.body;

		if (!code || code.length !== 6) {
			return res.status(400).json({
				message: "Code invalide (6 chiffres requis)",
			});
		}

		// Récupérer l'utilisateur
		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user || !user.mfaEnabled) {
			return res.status(400).json({
				message: "MFA non activé pour cet utilisateur",
			});
		}

		// Vérifier le code TOTP
		const verified = speakeasy.totp.verify({
			secret: user.mfaSecret,
			encoding: "base32",
			token: code,
			window: 1,
		});

		if (verified) {
			return res.json({
				message: "Code MFA valide",
				valid: true,
			});
		}

		// Si code TOTP invalide, essayer avec les backup codes
		const backupCodeMatch = user.mfaBackupCodes.find(
			(bc) => bc.code === code.toUpperCase() && !bc.used
		);

		if (backupCodeMatch) {
			// Marquer le backup code comme utilisé
			backupCodeMatch.used = true;
			await user.save();

			console.log(`✅ Backup code utilisé pour ${user.email}`);

			return res.json({
				message: "Backup code valide (usage unique)",
				valid: true,
				warning:
					"Ce code ne peut être utilisé qu'une fois. Il vous reste " +
					user.mfaBackupCodes.filter((bc) => !bc.used).length +
					" backup codes.",
			});
		}

		// Code invalide
		console.warn(`⚠️ Code MFA invalide pour ${user.email}`);
		res.status(403).json({
			message: "Code MFA invalide",
			valid: false,
		});
	} catch (error) {
		console.error("❌ Erreur vérification MFA:", error);
		res.status(500).json({ message: "Erreur lors de la vérification MFA" });
	}
});

/**
 * POST /mfa/disable - Désactiver le MFA (requiert le mot de passe)
 */
router.post("/disable", auth, strictLimiter, async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.userType;
		const { password, mfaCode } = req.body;

		if (!password) {
			return res.status(400).json({
				message: "Mot de passe requis pour désactiver le MFA",
			});
		}

		// Récupérer l'utilisateur
		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user || !user.mfaEnabled) {
			return res.status(400).json({
				message: "MFA non activé",
			});
		}

		// Vérifier le mot de passe
		const bcrypt = require("bcrypt");
		const validPassword = await bcrypt.compare(password, user.passwordHash);

		if (!validPassword) {
			return res.status(403).json({
				message: "Mot de passe incorrect",
			});
		}

		// Vérifier le code MFA une dernière fois (sécurité)
		if (mfaCode) {
			const verified = speakeasy.totp.verify({
				secret: user.mfaSecret,
				encoding: "base32",
				token: mfaCode,
				window: 1,
			});

			if (!verified) {
				return res.status(403).json({
					message: "Code MFA incorrect",
				});
			}
		}

		// Désactiver le MFA
		user.mfaEnabled = false;
		user.mfaSecret = null;
		user.mfaBackupCodes = [];
		await user.save();

		console.log(`⚠️ MFA désactivé pour ${user.email}`);

		res.json({
			message: "MFA désactivé avec succès",
			mfaEnabled: false,
		});
	} catch (error) {
		console.error("❌ Erreur désactivation MFA:", error);
		res.status(500).json({ message: "Erreur lors de la désactivation MFA" });
	}
});

/**
 * GET /mfa/status - Obtenir le statut MFA de l'utilisateur
 */
router.get("/status", auth, async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.userType;

		const User = userType === "admin" ? Admin : Server;
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ message: "Utilisateur non trouvé" });
		}

		res.json({
			mfaEnabled: user.mfaEnabled || false,
			backupCodesRemaining: user.mfaBackupCodes
				? user.mfaBackupCodes.filter((bc) => !bc.used).length
				: 0,
		});
	} catch (error) {
		console.error("❌ Erreur récupération statut MFA:", error);
		res.status(500).json({ message: "Erreur récupération statut MFA" });
	}
});

module.exports = router;
