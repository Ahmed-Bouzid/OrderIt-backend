/**
 * Script pour créer 15 réservations pour "Chez Ahmed" – aujourd'hui entre 18h30 et 21h
 * Usage: cd backend && node scripts/seedResasAhmed.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");

const RESTAURANT_ID = "686af511bb4cba684ff3b72e";

// Tables disponibles
const TABLES = [
	"686af692bb4cba684ff3b757", // T1
	"686af69cbb4cba684ff3b760", // T3
	"686af69ebb4cba684ff3b762", // T5
	"686af69fbb4cba684ff3b763", // T6
	"686af6a0bb4cba684ff3b764", // T7
	"686af6a1bb4cba684ff3b765", // T8
	"695a3d0b2295faf8ca9f3012", // T9
	"686af6a3bb4cba684ff3b767", // T10
	"686af6a5bb4cba684ff3b769", // T12
	"69a9225133d1af5404a8f2a3", // T13
	"69a9225233d1af5404a8f2a7", // T15
	"69a9225333d1af5404a8f2a9", // T16
	"69a9169133d1af5404a8e774", // T17
	"69a92c3686311811f8f676fb", // T18
	"69a98a5986311811f8f6c258", // T20
];

// Serveurs
const SERVERS = [
	"69ab70afb5a0383625c3b77a", // Karim
	"69ab70afb5a0383625c3b77d", // Yasmine
	"69ab70afb5a0383625c3b780", // Mehdi
	"69ab70afb5a0383625c3b783", // Sofia
	"69ab70b0b5a0383625c3b786", // Nabil
];

// Date d'aujourd'hui à minuit UTC
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

function makeTime(hour, minute) {
	const d = new Date(today);
	d.setUTCHours(hour, minute, 0, 0);
	return d;
}

const reservations = [
	{
		clientName: "Famille Benali",
		phone: "06 12 34 56 78",
		nbPersonnes: 5,
		reservationTime: "18:30",
		reservationDate: makeTime(18, 30),
		tableId: TABLES[0],
		serverId: SERVERS[0],
		restrictions: "Halal",
		notes: "Anniversaire de la grand-mère",
	},
	{
		clientName: "Rachid Mezouar",
		phone: "06 23 45 67 89",
		nbPersonnes: 2,
		reservationTime: "18:30",
		reservationDate: makeTime(18, 30),
		tableId: TABLES[1],
		serverId: SERVERS[1],
		allergies: "Fruits de mer",
	},
	{
		clientName: "Aïcha & Youssef",
		phone: "06 34 56 78 90",
		nbPersonnes: 2,
		reservationTime: "18:45",
		reservationDate: makeTime(18, 45),
		tableId: TABLES[2],
		serverId: SERVERS[2],
		notes: "Demande coin tranquille",
	},
	{
		clientName: "Groupe Nassim",
		phone: "06 45 67 89 01",
		nbPersonnes: 6,
		reservationTime: "19:00",
		reservationDate: makeTime(19, 0),
		tableId: TABLES[14], // T20 (6 places)
		serverId: SERVERS[3],
		restrictions: "Végétarien",
		notes: "Repas d'affaires",
	},
	{
		clientName: "Leïla Boudjemaa",
		phone: "06 56 78 90 12",
		nbPersonnes: 3,
		reservationTime: "19:00",
		reservationDate: makeTime(19, 0),
		tableId: TABLES[3],
		serverId: SERVERS[4],
		allergies: "Gluten",
	},
	{
		clientName: "Samir Kaci",
		phone: "06 67 89 01 23",
		nbPersonnes: 2,
		reservationTime: "19:15",
		reservationDate: makeTime(19, 15),
		tableId: TABLES[4],
		serverId: SERVERS[0],
	},
	{
		clientName: "Fatima Zeroual",
		phone: "06 78 90 12 34",
		nbPersonnes: 4,
		reservationTime: "19:30",
		reservationDate: makeTime(19, 30),
		tableId: TABLES[5],
		serverId: SERVERS[1],
		restrictions: "Sans porc",
		allergies: "Arachides",
		notes: "Enfant en bas-âge, chaise haute",
	},
	{
		clientName: "Omar Hadj",
		phone: "06 89 01 23 45",
		nbPersonnes: 2,
		reservationTime: "19:30",
		reservationDate: makeTime(19, 30),
		tableId: TABLES[6],
		serverId: SERVERS[2],
	},
	{
		clientName: "Les Belkacem",
		phone: "06 90 12 34 56",
		nbPersonnes: 4,
		reservationTime: "19:45",
		reservationDate: makeTime(19, 45),
		tableId: TABLES[7],
		serverId: SERVERS[3],
		notes: "Client régulier, table habituelle",
	},
	{
		clientName: "Mina Ait-Ahmed",
		phone: "07 01 23 45 67",
		nbPersonnes: 2,
		reservationTime: "20:00",
		reservationDate: makeTime(20, 0),
		tableId: TABLES[8],
		serverId: SERVERS[4],
		allergies: "Lactose",
	},
	{
		clientName: "Djamel Rahmani",
		phone: "07 12 34 56 78",
		nbPersonnes: 3,
		reservationTime: "20:00",
		reservationDate: makeTime(20, 0),
		tableId: TABLES[9],
		serverId: SERVERS[0],
		restrictions: "Halal",
	},
	{
		clientName: "Couple Meziane",
		phone: "07 23 45 67 89",
		nbPersonnes: 2,
		reservationTime: "20:15",
		reservationDate: makeTime(20, 15),
		tableId: TABLES[10],
		serverId: SERVERS[1],
		notes: "Demande en mariage – dessert spécial !",
	},
	{
		clientName: "Nadia Ferhat",
		phone: "07 34 56 78 90",
		nbPersonnes: 1,
		reservationTime: "20:30",
		reservationDate: makeTime(20, 30),
		tableId: TABLES[11],
		serverId: SERVERS[2],
		restrictions: "Végan",
	},
	{
		clientName: "Hicham Talbi",
		phone: "07 45 67 89 01",
		nbPersonnes: 4,
		reservationTime: "20:45",
		reservationDate: makeTime(20, 45),
		tableId: TABLES[12],
		serverId: SERVERS[3],
		allergies: "Noix, sésame",
	},
	{
		clientName: "Famille Slimani",
		phone: "07 56 78 90 12",
		nbPersonnes: 5,
		reservationTime: "21:00",
		reservationDate: makeTime(21, 0),
		tableId: TABLES[13],
		serverId: SERVERS[4],
		restrictions: "Halal",
		notes: "Fête de fin d'études",
	},
];

async function main() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		let created = 0;
		for (const resa of reservations) {
			const newResa = new Reservation({
				...resa,
				restaurantId: RESTAURANT_ID,
				status: "en attente",
				reservationSource: "À distance",
				isPresent: false,
			});
			await newResa.save();
			console.log(
				`✅ ${resa.reservationTime} — ${resa.clientName} (${resa.nbPersonnes} pers.)`,
			);
			created++;
		}

		console.log(`\n🎉 ${created} réservations créées pour aujourd'hui !`);
	} catch (err) {
		console.error("❌ Erreur:", err.message);
	} finally {
		await mongoose.connection.close();
		process.exit(0);
	}
}

main();
