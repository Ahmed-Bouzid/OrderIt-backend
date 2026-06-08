const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Room = require("../models/Room");
const Table = require("../models/Table");
const auth = require("../middlewares/auth");

// ────────────────────────────────────────────
// GET /rooms/restaurant/:restaurantId
// Liste toutes les salles d'un restaurant (auth requise)
// ────────────────────────────────────────────
router.get("/restaurant/:restaurantId", auth, async (req, res) => {
	try {
		const { restaurantId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
			return res.status(400).json({ message: "restaurantId invalide" });
		}

		const rooms = await Room.find({ restaurantId })
			.sort({ order: 1, createdAt: 1 })
			.populate("tableIds", "number capacity status position size sizeW sizeH");

		res.json(rooms);
	} catch (err) {
		console.error("[Rooms] GET /restaurant/:restaurantId", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────
// POST /rooms
// Créer une salle
// Body: { restaurantId, name, description?, order? }
// ────────────────────────────────────────────
router.post("/", auth, async (req, res) => {
	try {
		const { restaurantId, name, description, order } = req.body;

		if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
			return res.status(400).json({ message: "restaurantId invalide" });
		}
		if (!name || name.trim() === "") {
			return res.status(400).json({ message: "name est requis" });
		}

		// Vérifier que l'utilisateur appartient au restaurant
		if (
			req.user.restaurantId &&
			req.user.restaurantId.toString() !== restaurantId.toString()
		) {
			return res.status(403).json({ message: "Accès non autorisé" });
		}

		const room = new Room({
			restaurantId,
			name: name.trim(),
			description: description?.trim() || "",
			order: order ?? 0,
		});

		await room.save();
		res.status(201).json(room);
	} catch (err) {
		console.error("[Rooms] POST /", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────
// PATCH /rooms/:id
// Modifier nom, description, order
// ────────────────────────────────────────────
router.patch("/:id", auth, async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "ID invalide" });
		}

		const room = await Room.findById(id);
		if (!room) {
			return res.status(404).json({ message: "Salle non trouvée" });
		}

		// Vérification accès restaurant
		if (
			req.user.restaurantId &&
			req.user.restaurantId.toString() !== room.restaurantId.toString()
		) {
			return res.status(403).json({ message: "Accès non autorisé" });
		}

		const { name, description, order } = req.body;
		if (name !== undefined) room.name = name.trim();
		if (description !== undefined) room.description = description.trim();
		if (order !== undefined) room.order = order;

		await room.save();
		res.json(room);
	} catch (err) {
		console.error("[Rooms] PATCH /:id", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────
// DELETE /rooms/:id
// Supprimer une salle (ne supprime pas les tables, juste la salle)
// ────────────────────────────────────────────
router.delete("/:id", auth, async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "ID invalide" });
		}

		const room = await Room.findById(id);
		if (!room) {
			return res.status(404).json({ message: "Salle non trouvée" });
		}

		if (
			req.user.restaurantId &&
			req.user.restaurantId.toString() !== room.restaurantId.toString()
		) {
			return res.status(403).json({ message: "Accès non autorisé" });
		}

		await Room.findByIdAndDelete(id);
		res.json({ message: "Salle supprimée", id });
	} catch (err) {
		console.error("[Rooms] DELETE /:id", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────
// POST /rooms/:id/tables
// Assigner des tables à la salle
// Body: { tableIds: ["id1", "id2"] }
// ────────────────────────────────────────────
router.post("/:id/tables", auth, async (req, res) => {
	try {
		const { id } = req.params;
		const { tableIds } = req.body;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "ID invalide" });
		}
		if (!Array.isArray(tableIds)) {
			return res.status(400).json({ message: "tableIds doit être un tableau" });
		}

		// Valider tous les IDs
		const invalidIds = tableIds.filter((tid) => !mongoose.Types.ObjectId.isValid(tid));
		if (invalidIds.length > 0) {
			return res.status(400).json({ message: "Certains tableIds sont invalides" });
		}

		const room = await Room.findById(id);
		if (!room) {
			return res.status(404).json({ message: "Salle non trouvée" });
		}

		if (
			req.user.restaurantId &&
			req.user.restaurantId.toString() !== room.restaurantId.toString()
		) {
			return res.status(403).json({ message: "Accès non autorisé" });
		}

		// Vérifier que toutes les tables appartiennent au même restaurant
		const tables = await Table.find({
			_id: { $in: tableIds },
			restaurantId: room.restaurantId,
		});

		if (tables.length !== tableIds.length) {
			return res.status(400).json({
				message: "Certaines tables n'appartiennent pas à ce restaurant",
			});
		}

		// Ajouter sans doublons
		const existingSet = new Set(room.tableIds.map((t) => t.toString()));
		for (const tid of tableIds) {
			if (!existingSet.has(tid.toString())) {
				room.tableIds.push(tid);
			}
		}

		await room.save();

		const populated = await room.populate("tableIds", "number capacity status position size sizeW sizeH");
		res.json(populated);
	} catch (err) {
		console.error("[Rooms] POST /:id/tables", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

// ────────────────────────────────────────────
// DELETE /rooms/:id/tables/:tableId
// Retirer une table d'une salle
// ────────────────────────────────────────────
router.delete("/:id/tables/:tableId", auth, async (req, res) => {
	try {
		const { id, tableId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(tableId)) {
			return res.status(400).json({ message: "ID invalide" });
		}

		const room = await Room.findById(id);
		if (!room) {
			return res.status(404).json({ message: "Salle non trouvée" });
		}

		if (
			req.user.restaurantId &&
			req.user.restaurantId.toString() !== room.restaurantId.toString()
		) {
			return res.status(403).json({ message: "Accès non autorisé" });
		}

		room.tableIds = room.tableIds.filter((t) => t.toString() !== tableId.toString());
		await room.save();

		res.json({ message: "Table retirée de la salle", room });
	} catch (err) {
		console.error("[Rooms] DELETE /:id/tables/:tableId", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

module.exports = router;
