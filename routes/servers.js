const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const checkRoles = require("../middlewares/checkRoles");
const checkAdmin = require("../middlewares/checkAdmin");
const adminValidation = require("../middlewares/adminValidation");
const serverValidationRules = require("../middlewares/serverValidationRules");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");
const createServerValidation = require("../middlewares/createServerValidation");
const validatePasswordComplexity = require("../middlewares/validatePasswordComplexity");
const auth = require("../middlewares/auth");
const Server = require("../models/Server");
const Restaurant = require("../models/Restaurant");
const Admin = require("../models/Admin");
const router = express.Router();

// === Route pour création du premier admin (sans auth) ===
router.post("/admin", adminValidation, async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ errors: errors.array() });
	}

	try {
		const existingAdmin = await Admin.findOne();
		if (existingAdmin) {
			return res.status(403).json({ message: "Un admin existe déjà." });
		}

		const { email, password, name, serverId } = req.body;
		const passwordHash = await bcrypt.hash(password, 10);

		const newAdmin = new Admin({
			name,
			email,
			passwordHash,
			serverId,
			role: "admin",
		});

		await newAdmin.save();

		res.status(201).json({ message: "Premier admin créé avec succès." });
	} catch (err) {
		console.error("Erreur création admin :", err);
		res.status(500).json({ message: "Erreur server." });
	}
});

// === Route login pour admin et server ===
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

		// Access token (aligné avec /auth/login pour cohérence)
		const accessToken = jwt.sign(
			{
				id: user._id,
				email: user.email,
				role: user.role,
				userType,
				restaurantId: user.restaurantId || null,
			},
			process.env.JWT_SECRET,
			{ expiresIn: "2h" }, // ⭐ Augmenté de 15m à 2h pour cohérence avec /auth/login
		); // Refresh token (long)
		const refreshToken = jwt.sign(
			{ id: user._id },
			process.env.REFRESH_TOKEN_SECRET,
			{ expiresIn: "7d" },
		);

		// Envoi refreshToken dans cookie HttpOnly
		res.cookie("refreshToken", refreshToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 7 * 24 * 60 * 60 * 1000,
		});

		res.json({
			accessToken,
			userId: user._id,
			email: user.email,
			role: user.role,
			userType,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: "Erreur server." });
	}
});

// === Middleware global d’authentification pour les routes suivantes ===
router.use(auth);

// === Création d'un server (admin uniquement) avec validation mot de passe ===
router.post(
	"/",
	auth,
	checkRoles(["admin"]),
	checkUserRestaurantBody("restaurantId"), // <-- ajouté ici
	createServerValidation,
	validatePasswordComplexity,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { name, email, password, role, restaurantId, serverId } = req.body;

			// Vérifier si email déjà utilisé
			const exists = await Server.findOne({ email });
			if (exists) {
				return res.status(409).json({ message: "Email déjà utilisé." });
			}

			// Vérifier que le restaurant existe
			const restaurantExists = await Restaurant.findById(restaurantId);
			if (!restaurantExists) {
				return res
					.status(400)
					.json({ message: "restaurantId invalide : restaurant non trouvé." });
			}

			// Hash du mot de passe
			const passwordHash = await bcrypt.hash(password, 10);

			const newServer = new Server({
				name,
				email,
				passwordHash,
				role: role || "server",
				restaurantId,
				serverId,
			});

			await newServer.save();

			await Restaurant.findByIdAndUpdate(restaurantId, {
				$push: { servers: newServer._id },
			});

			res.status(201).json({ message: "server créé.", server: newServer });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// === Liste des servers d’un restaurant (admin uniquement) ===
router.get(
	"/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "server"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const servers = await Server.find({
				restaurantId: req.params.restaurantId,
			}).select("-passwordHash");
			res.json(servers);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// === Modification d’un server (admin uniquement) ===
router.put(
	"/:serverId",
	validateObjectIds(["serverId"]),
	checkRoles(["admin", "restaurant"]),
	checkAdmin,
	serverValidationRules,
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { password, ...updateData } = req.body;

			// Filtrer uniquement les champs modifiables
			const allowedFields = ["name", "email", "role", "serverId"];
			const filteredUpdates = Object.fromEntries(
				Object.entries(updateData).filter(([key]) =>
					allowedFields.includes(key),
				),
			);

			// Si mot de passe modifié, re-hasher
			if (password) {
				filteredUpdates.passwordHash = await bcrypt.hash(password, 10);
			}

			const updatedServer = await Server.findByIdAndUpdate(
				req.params.serverId,
				filteredUpdates,
				{ new: true },
			).select("-passwordHash");

			if (!updatedServer) {
				return res.status(404).json({ message: "server non trouvé." });
			}

			res.json({ message: "server modifié.", server: updatedServer });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

// === Suppression d’un server (admin uniquement) ===
router.delete(
	"/:serverId",
	validateObjectIds(["serverId"]),
	checkRoles(["admin"]),
	checkAdmin,
	async (req, res) => {
		try {
			const deleted = await Server.findByIdAndDelete(req.params.serverId);
			if (!deleted) {
				return res.status(404).json({ message: "server non trouvé." });
			}
			res.json({ message: "server supprimé." });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur server." });
		}
	},
);

module.exports = router;
