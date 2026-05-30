/**
 * Seed reservations for TODAY for a given restaurant.
 * Creates 5 "en attente", 5 "terminée", 5 "annulée".
 *
 * Usage:
 *   node backend/scripts/seedTodayReservations.js <restaurantId>
 *   node backend/scripts/seedTodayReservations.js 686af511bb4cba684ff3b72e
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Reservation = require("../models/Reservation");

const FIRST_NAMES = [
	"Lucas", "Emma", "Hugo", "Léa", "Nathan",
	"Chloé", "Ethan", "Manon", "Louis", "Camille",
	"Jules", "Sarah", "Adam", "Inès", "Raphaël",
];
const LAST_NAMES = [
	"Martin", "Bernard", "Dubois", "Thomas", "Robert",
	"Petit", "Moreau", "Laurent", "Simon", "Michel",
	"Lefebvre", "Leroy", "Roux", "David", "Bertrand",
];

const PHONE_PREFIXES = ["06", "07"];
const SOURCES = ["Sur place", "À distance"];

function pad(n) {
	return String(n).padStart(2, "0");
}

function randomPhone() {
	const prefix = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
	let rest = "";
	for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
	return prefix + rest;
}

function randomTime() {
	// Heures de service: 11:30 à 22:30 par tranches de 15 min
	const startMinutes = 11 * 60 + 30;
	const endMinutes = 22 * 60 + 30;
	const slots = Math.floor((endMinutes - startMinutes) / 15);
	const slot = Math.floor(Math.random() * (slots + 1));
	const total = startMinutes + slot * 15;
	const h = Math.floor(total / 60);
	const m = total % 60;
	return `${pad(h)}:${pad(m)}`;
}

function buildReservation({ restaurantId, status, index, today }) {
	const firstName = FIRST_NAMES[(index * 3) % FIRST_NAMES.length];
	const lastName = LAST_NAMES[(index * 5) % LAST_NAMES.length];
	const time = randomTime();
	const [hh, mm] = time.split(":").map(Number);

	const reservationDate = new Date(today);
	reservationDate.setHours(hh, mm, 0, 0);

	const nbPersonnes = 1 + Math.floor(Math.random() * 6); // 1 à 6

	const base = {
		restaurantId,
		clientName: `${firstName} ${lastName}`,
		phone: randomPhone(),
		nbPersonnes,
		reservationDate,
		reservationTime: time,
		reservationSource: SOURCES[index % SOURCES.length],
		status,
		notes: `Seed test (${status})`,
		openedBy: "SeedScript",
		auditLog: [
			{
				timestamp: new Date(),
				action: "created",
				userType: "system",
				userName: "SeedScript",
				message: `Réservation seed (${status})`,
			},
		],
	};

	if (status === "terminée") {
		const total = 20 + Math.floor(Math.random() * 80); // 20-99 €
		base.totalAmount = total;
		base.paidAmount = total;
		base.remainingAmount = 0;
		base.isPresent = false;
		base.dishStatus = "Terminé";
		base.paymentMethod = Math.random() > 0.5 ? "Carte" : "Espèces";
		base.arrivalTime = new Date(reservationDate.getTime());
		base.auditLog.push({
			timestamp: new Date(),
			action: "payment",
			userType: "system",
			userName: "SeedScript",
			message: "Paiement complet (seed)",
		});
	} else if (status === "annulée") {
		base.canceled = true;
		base.canceledAt = new Date();
		base.isPresent = false;
		base.auditLog.push({
			timestamp: new Date(),
			action: "cancelled",
			userType: "system",
			userName: "SeedScript",
			message: "Réservation annulée (seed)",
		});
	} else {
		// en attente
		base.isPresent = false;
		base.dishStatus = "En attente";
	}

	return base;
}

async function main() {
	const restaurantId = process.argv[2];
	if (!restaurantId) {
		console.error("❌ Usage: node seedTodayReservations.js <restaurantId>");
		process.exit(1);
	}
	if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
		console.error("❌ restaurantId invalide:", restaurantId);
		process.exit(1);
	}
	if (!process.env.MONGO_URI) {
		console.error("❌ MONGO_URI manquant dans backend/.env");
		process.exit(1);
	}

	await mongoose.connect(process.env.MONGO_URI);
	console.log("✅ Connecté à MongoDB");

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const STATUSES = ["en attente", "terminée", "annulée"];
	const COUNT_PER_STATUS = 5;

	const docs = [];
	STATUSES.forEach((status) => {
		for (let i = 0; i < COUNT_PER_STATUS; i++) {
			docs.push(buildReservation({ restaurantId, status, index: i, today }));
		}
	});

	console.log(`📝 Insertion de ${docs.length} réservations pour ${today.toISOString().slice(0, 10)}...`);

	// Insert one-by-one to respect pre('save') middleware (insertMany skip hooks).
	const created = [];
	for (const data of docs) {
		const r = new Reservation(data);
		await r.save();
		created.push(r);
	}

	const summary = created.reduce((acc, r) => {
		acc[r.status] = (acc[r.status] || 0) + 1;
		return acc;
	}, {});

	console.log("✅ Insertion terminée:");
	Object.entries(summary).forEach(([k, v]) => console.log(`   - ${k}: ${v}`));

	await mongoose.disconnect();
	console.log("👋 Déconnecté");
}

main().catch(async (err) => {
	console.error("❌ Erreur:", err);
	try { await mongoose.disconnect(); } catch (_) {}
	process.exit(1);
});
