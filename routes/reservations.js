const express = require("express");
const router = express.Router();
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const { body, validationResult } = require("express-validator");

const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const validateObjectIds = require("../middlewares/validateObjectId");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const checkUserRestaurantBody = require("../middlewares/checkUserRestaurantBody");

// Validation simple pour réservation
const reservationValidationRules = require("../middlewares/reservationValidationRules");

// POST / - création réservation (admin / serveur)
router.post(
	"/",
	auth,
	checkRoles(["admin", "serveur", "server"]),
	checkUserRestaurantBody("restaurantId"),
	reservationValidationRules, // <- tes règles de validation
	async (req, res) => {
		// <- ici tu mets la vérification des erreurs
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const formattedErrors = errors.array().map((err) => ({
				field: err.param,
				message: err.msg,
			}));
			return res.status(400).json({ errors: formattedErrors });
		}

		try {
			const reservation = new Reservation(req.body);
			await reservation.save();
			res.status(201).json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// GET /:id - récupérer une réservation
router.get(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "serveur"]),
	async (req, res) => {
		try {
			const reservation = await Reservation.findById(req.params.id);
			if (!reservation)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json(reservation);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

router.get("/", auth, checkRoles(["admin", "serveur"]), async (req, res) => {
	try {
		const reservations = await Reservation.find();
		res.json(reservations);
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// PUT /:id - modifier réservation
router.put(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "serveur"]),
	reservationValidationRules,
	async (req, res) => {
		// <- vérification des erreurs
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const formattedErrors = errors.array().map((err) => ({
				field: err.param,
				message: err.msg,
			}));
			return res.status(400).json({ errors: formattedErrors });
		}

		const allowedFields = [
			"tableId",
			"clientName",
			"reservationDate",
			"reservationTime",
			"nbPersonnes",
			"allergies",
			"restrictions",
			"notes",
			"server",
			"orderSummary",
			"dishStatus",
			"paymentMethod",
			"totalAmount",
		];

		const updates = Object.fromEntries(
			Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
		);

		try {
			const updated = await Reservation.findByIdAndUpdate(
				req.params.id,
				updates,
				{ new: true }
			);
			if (!updated)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);
//PUT status annulé
// PUT /reservations/:id/toggle
router.put(
	"/:id/toggle",
	auth,
	checkRoles(["admin", "serveur"]),
	async (req, res) => {
		console.log("Tentative toggle, ID :", req.params.id);
		try {
			const reservation = await Reservation.findById(req.params.id);
			if (!reservation) {
				console.log("Réservation introuvable dans la DB");
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			const newStatus =
				reservation.dishStatus === "Annulé" ? "En attente" : "Annulé";

			const updated = await Reservation.findByIdAndUpdate(
				req.params.id,
				{ dishStatus: newStatus },
				{ new: true }
			);

			console.log("Réservation mise à jour :", updated);
			res.json(updated);
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// DELETE /:id - supprimer réservation
router.delete(
	"/:id",
	auth,
	validateObjectIds(["id"]),
	checkRoles(["admin", "serveur"]),
	async (req, res) => {
		try {
			const deleted = await Reservation.findByIdAndDelete(req.params.id);
			if (!deleted)
				return res.status(404).json({ message: "Réservation non trouvée" });
			res.json({ message: "Réservation supprimée" });
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

// GET /restaurant/:restaurantId - toutes les réservations d'un restaurant avec filtres et pagination
router.get(
	"/restaurant/:restaurantId",
	auth,
	validateObjectIds(["restaurantId"]),
	checkRoles(["admin", "serveur"]),
	checkUserRestaurant("restaurantId"),
	async (req, res) => {
		try {
			const tables = await Table.find({
				restaurantId: req.params.restaurantId,
			});
			const tableIds = tables.map((t) => t._id);

			const {
				date,
				clientName,
				server,
				page = 1,
				limit = 20,
				sortBy = "reservationDate",
				order = "asc",
			} = req.query;

			const filter = { tableId: { $in: tableIds } };

			if (date) filter.reservationDate = date;
			if (clientName) filter.clientName = { $regex: clientName, $options: "i" };
			if (server) filter.server = server;

			const sortOrder = order === "asc" ? 1 : -1;

			const reservations = await Reservation.find(filter)
				.sort({ [sortBy]: sortOrder })
				.skip((page - 1) * limit)
				.limit(Number(limit));

			const total = await Reservation.countDocuments(filter);

			res.json({
				total,
				page: Number(page),
				limit: Number(limit),
				reservations,
			});
		} catch (err) {
			console.error(err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	}
);

module.exports = router;
