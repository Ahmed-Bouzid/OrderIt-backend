const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");
const { loginLimiter } = require("../middlewares/rateLimiter");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || null;
const ADMIN_UNLOCK_EXPIRES_IN = process.env.ADMIN_UNLOCK_EXPIRES_IN || "15m";

function isAdminAuthConfigured() {
	return Boolean(process.env.JWT_SECRET && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));
}

async function verifyAdminPassword(password) {
	if (ADMIN_PASSWORD_HASH) {
		return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
	}

	if (!ADMIN_PASSWORD) {
		return false;
	}

	const expected = Buffer.from(ADMIN_PASSWORD, "utf8");
	const provided = Buffer.from(password, "utf8");

	if (expected.length !== provided.length) {
		return false;
	}

	return crypto.timingSafeEqual(expected, provided);
}

function requireAdminUnlock(req, res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ")
		? authHeader.split(" ")[1]
		: null;

	if (!token) {
		return res.status(401).json({ error: "Authentification admin requise" });
	}

	if (!process.env.JWT_SECRET) {
		return res.status(503).json({ error: "Configuration admin indisponible" });
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);

		if (decoded.scope !== "admin-unlock" || decoded.role !== "admin") {
			return res.status(403).json({ error: "Token admin invalide" });
		}

		req.adminUnlock = decoded;
		next();
	} catch (error) {
		return res.status(403).json({ error: "Token admin invalide ou expiré" });
	}
}

/**
 * POST /api/admin-auth/verify-password
 * Vérifie le mot de passe admin
 * Body: { password: string }
 * Response: { success: boolean }
 */
router.post("/verify-password", loginLimiter, async (req, res) => {
	try {
		if (!isAdminAuthConfigured()) {
			return res.status(503).json({ error: "Configuration admin indisponible" });
		}

		const { password } = req.body;

		if (!password) {
			return res.status(400).json({ error: "Mot de passe requis" });
		}

		const isValidPassword = await verifyAdminPassword(password);

		if (isValidPassword) {
			const token = jwt.sign(
				{
					role: "admin",
					scope: "admin-unlock",
				},
				process.env.JWT_SECRET,
				{ expiresIn: ADMIN_UNLOCK_EXPIRES_IN },
			);

			return res.json({
				success: true,
				token,
				tokenType: "Bearer",
				expiresIn: ADMIN_UNLOCK_EXPIRES_IN,
			});
		} else {
			return res.status(401).json({ success: false, error: "Mot de passe incorrect" });
		}
	} catch (error) {
		console.error("Erreur verify-password:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * GET /api/admin-auth/restaurants
 * Récupère tous les restaurants (après authentification admin)
 * Response: [{ _id, name }, ...]
 */
router.get("/restaurants", requireAdminUnlock, async (req, res) => {
	try {
		const restaurants = await Restaurant.find({}, { _id: 1, name: 1 });
		res.json(restaurants);
	} catch (error) {
		console.error("Erreur restaurants:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * GET /api/admin-auth/restaurants/:restaurantId/tables
 * Récupère toutes les tables d'un restaurant
 * Response: [{ _id, number }, ...]
 */
router.get("/restaurants/:restaurantId/tables", requireAdminUnlock, async (req, res) => {
	try {
		const { restaurantId } = req.params;

		if (!restaurantId.match(/^[0-9a-f]{24}$/i)) {
			return res.status(400).json({ error: "ID restaurant invalide" });
		}

		const tables = await Table.find(
			{ restaurantId },
			{ _id: 1, number: 1 }
		);

		res.json(tables);
	} catch (error) {
		console.error("Erreur tables:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

module.exports = router;
