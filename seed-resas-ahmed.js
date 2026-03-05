#!/usr/bin/env node
/**
 * Génère 10 réservations de test pour "Chez Ahmed" (aujourd'hui)
 * → variété d'heures, de statuts et de tables pour tester le mode Resa
 * Usage : node seed-resas-ahmed.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const Reservation = require("./models/Reservation");
const Table = require("./models/Table");

const RESTAURANT_ID = "686af511bb4cba684ff3b72e";

async function seed() {
	console.log("🔌 Connexion MongoDB...");
	await mongoose.connect(process.env.MONGO_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	});
	console.log("✅ Connecté");

	// Récupérer les tables du resto
	const tables = await Table.find({ restaurantId: RESTAURANT_ID }).lean();
	if (!tables.length) {
		console.error(
			"❌ Aucune table trouvée pour ce restaurant. Créez-en d'abord.",
		);
		process.exit(1);
	}
	console.log(
		`📋 ${tables.length} table(s) trouvée(s) : ${tables.map((t) => `T${t.number}`).join(", ")}`,
	);

	// Helpers
	const today = new Date();
	today.setSeconds(0, 0);

	const atHour = (h, m = 0) => {
		const d = new Date(today);
		d.setHours(h, m, 0, 0);
		return d;
	};

	const now = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

	// tableId cyclé sur les tables disponibles
	const tid = (i) => tables[i % tables.length]._id;

	const resas = [
		// ── PASSÉES / EN COURS ──────────────────────────────────────────────────
		{
			tableId: tid(0),
			clientName: "Martin Sophie",
			nbPersonnes: 2,
			reservationDate: atHour(12, 0),
			reservationTime: "12:00",
			status: "ouverte", // ← EN COURS rouge
			notes: "Anniversaire",
		},
		{
			tableId: tid(1),
			clientName: "Dupont Jean",
			nbPersonnes: 4,
			reservationDate: atHour(12, 30),
			reservationTime: "12:30",
			status: "ouverte", // ← EN COURS rouge
		},
		{
			tableId: tid(2),
			clientName: "Bernard Alice",
			nbPersonnes: 3,
			reservationDate: atHour(13, 0),
			reservationTime: "13:00",
			status: "en attente", // ← passée non-ouverte = EN COURS rouge
		},
		{
			tableId: tid(3),
			clientName: "Moreau Luc",
			nbPersonnes: 6,
			reservationDate: atHour(now.getHours(), now.getMinutes() - 10),
			reservationTime: hhmm(atHour(now.getHours(), now.getMinutes() - 10)),
			status: "en attente", // ← juste passée = EN COURS rouge
			notes: "Menu végétarien",
		},

		// ── FUTURES ─────────────────────────────────────────────────────────────
		{
			tableId: tid(0),
			clientName: "Leroy Emma",
			nbPersonnes: 2,
			reservationDate: atHour(now.getHours() + 1, 0),
			reservationTime: hhmm(atHour(now.getHours() + 1, 0)),
			status: "en attente", // ← FUTUR bleu
		},
		{
			tableId: tid(1),
			clientName: "Garcia Pablo",
			nbPersonnes: 5,
			reservationDate: atHour(now.getHours() + 1, 30),
			reservationTime: hhmm(atHour(now.getHours() + 1, 30)),
			status: "en attente", // ← FUTUR bleu
		},
		{
			tableId: tid(2),
			clientName: "Petit Claire",
			nbPersonnes: 2,
			reservationDate: atHour(now.getHours() + 2, 0),
			reservationTime: hhmm(atHour(now.getHours() + 2, 0)),
			status: "en attente",
			notes: "Allergie gluten",
		},
		{
			tableId: tid(3),
			clientName: "Laurent Marc",
			nbPersonnes: 8,
			reservationDate: atHour(19, 0),
			reservationTime: "19:00",
			status: "en attente",
		},
		{
			tableId: tid(0),
			clientName: "Simon Nathalie",
			nbPersonnes: 3,
			reservationDate: atHour(20, 0),
			reservationTime: "20:00",
			status: "en attente",
			notes: "Table fenêtre si possible",
		},

		// ── SANS TABLE (resa flottante pour tester) ───────────────────────────
		{
			tableId: null,
			clientName: "Robert Thomas",
			nbPersonnes: 2,
			reservationDate: atHour(20, 30),
			reservationTime: "20:30",
			status: "en attente",
		},
	];

	// Supprimer les resas de test déjà créées pour ce resto aujourd'hui (pour rejouer)
	const startOfDay = new Date(today);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(today);
	endOfDay.setHours(23, 59, 59, 999);

	const deleted = await Reservation.deleteMany({
		restaurantId: RESTAURANT_ID,
		reservationDate: { $gte: startOfDay, $lte: endOfDay },
		clientName: { $in: resas.map((r) => r.clientName) },
	});
	if (deleted.deletedCount) {
		console.log(
			`🗑  ${deleted.deletedCount} ancienne(s) resa(s) de test supprimée(s)`,
		);
	}

	// Insertion
	const docs = resas.map((r) => ({
		...r,
		restaurantId: RESTAURANT_ID,
		reservationSource: "Sur place",
	}));

	const created = await Reservation.insertMany(docs);
	console.log(`\n✅ ${created.length} réservations créées :\n`);

	created.forEach((r) => {
		const tableLabel = r.tableId
			? `Table ${tables.find((t) => t._id.equals(r.tableId))?.number ?? r.tableId}`
			: "Sans table";
		console.log(
			`  [${r.status.padEnd(10)}] ${r.reservationTime.padEnd(6)}  ${r.clientName.padEnd(20)}  ${r.nbPersonnes}p  ${tableLabel}`,
		);
	});

	await mongoose.disconnect();
	console.log("\n🔌 Déconnecté. Bonne démo !");
}

seed().catch((err) => {
	console.error("❌", err);
	process.exit(1);
});
