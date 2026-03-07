/**
 * seedReservationsCucina.js - Fausses réservations pour Lacucinadinini
 * Restaurant ID : 6970ef6594abf8bacd9d804d
 * Usage: node scripts/seedReservationsCucina.js
 */

const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
require("dotenv").config();

const RESTAURANT_ID = "6970ef6594abf8bacd9d804d";

// Dates : aujourd'hui (5 mars 2026) + 2 jours
const d0 = "2026-03-05"; // Aujourd'hui — resa "ouverte" (en cours)
const d1 = "2026-03-05"; // Aujourd'hui — resa "en attente" (à venir ce soir)
const d2 = "2026-03-06"; // Demain
const d3 = "2026-03-07"; // Après-demain

const reservations = [
	// ────── EN COURS (ouverte) ──────
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "ouverte",
		clientName: "Marco Ferretti",
		phone: "0612345678",
		nbPersonnes: 2,
		reservationDate: new Date(`${d0}T18:30:00.000Z`),
		reservationTime: "18:30",
		reservationSource: "Sur place",
		allergies: "",
		restrictions: "",
		notes: "Couple, anniversaire",
		dishStatus: "En cours",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: true,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "ouverte",
		clientName: "Elena Bianchi",
		phone: "0698765432",
		nbPersonnes: 4,
		reservationDate: new Date(`${d0}T18:45:00.000Z`),
		reservationTime: "18:45",
		reservationSource: "À distance",
		allergies: "Fruits de mer",
		restrictions: "Végétarien",
		notes: "Table ronde préférée",
		dishStatus: "En cours",
		paymentMethod: "Espèces",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: true,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "ouverte",
		clientName: "Giuseppe Romano",
		phone: "0654321987",
		nbPersonnes: 3,
		reservationDate: new Date(`${d0}T19:00:00.000Z`),
		reservationTime: "19:00",
		reservationSource: "Sur place",
		allergies: "",
		restrictions: "",
		notes: "Repas d'affaires",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: true,
		canceled: false,
	},

	// ────── EN ATTENTE — ce soir ──────
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Laura Conti",
		phone: "0677889900",
		nbPersonnes: 2,
		reservationDate: new Date(`${d1}T19:30:00.000Z`),
		reservationTime: "19:30",
		reservationSource: "À distance",
		allergies: "Gluten",
		restrictions: "",
		notes: "",
		dishStatus: "En attente",
		paymentMethod: "Autre",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Luca Mancini",
		phone: "0611223344",
		nbPersonnes: 5,
		reservationDate: new Date(`${d1}T19:30:00.000Z`),
		reservationTime: "19:30",
		reservationSource: "Sur place",
		allergies: "",
		restrictions: "Sans porc",
		notes: "Groupe famille",
		dishStatus: "En attente",
		paymentMethod: "Espèces",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Chiara Esposito",
		phone: "0622334455",
		nbPersonnes: 2,
		reservationDate: new Date(`${d1}T20:00:00.000Z`),
		reservationTime: "20:00",
		reservationSource: "À distance",
		allergies: "Lactose",
		restrictions: "",
		notes: "Demande une bougie sur la table",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Antonio Ricci",
		phone: "0633445566",
		nbPersonnes: 6,
		reservationDate: new Date(`${d1}T20:00:00.000Z`),
		reservationTime: "20:00",
		reservationSource: "Sur place",
		allergies: "Arachides",
		restrictions: "",
		notes: "Réservation VIP",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Valentina De Luca",
		phone: "0644556677",
		nbPersonnes: 2,
		reservationDate: new Date(`${d1}T20:30:00.000Z`),
		reservationTime: "20:30",
		reservationSource: "À distance",
		allergies: "",
		restrictions: "Vegan",
		notes: "",
		dishStatus: "En attente",
		paymentMethod: "Autre",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Francesco Moretti",
		phone: "0655667788",
		nbPersonnes: 3,
		reservationDate: new Date(`${d1}T21:00:00.000Z`),
		reservationTime: "21:00",
		reservationSource: "Sur place",
		allergies: "",
		restrictions: "",
		notes: "Dernier service",
		dishStatus: "En attente",
		paymentMethod: "Espèces",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},

	// ────── DEMAIN (6 mars) ──────
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Alessia Ferrari",
		phone: "0666778899",
		nbPersonnes: 4,
		reservationDate: new Date(`${d2}T19:00:00.000Z`),
		reservationTime: "19:00",
		reservationSource: "À distance",
		allergies: "",
		restrictions: "",
		notes: "Repas de travail",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Roberto Costa",
		phone: "0677889900",
		nbPersonnes: 2,
		reservationDate: new Date(`${d2}T19:30:00.000Z`),
		reservationTime: "19:30",
		reservationSource: "Sur place",
		allergies: "Gluten",
		restrictions: "",
		notes: "",
		dishStatus: "En attente",
		paymentMethod: "Autre",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Martina Russo",
		phone: "0688990011",
		nbPersonnes: 8,
		reservationDate: new Date(`${d2}T20:00:00.000Z`),
		reservationTime: "20:00",
		reservationSource: "À distance",
		allergies: "",
		restrictions: "Végétarien",
		notes: "Fête d'anniversaire, grande table ronde souhaitée",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},

	// ────── APRÈS-DEMAIN (7 mars) ──────
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Paolo Gallo",
		phone: "0699001122",
		nbPersonnes: 2,
		reservationDate: new Date(`${d3}T19:00:00.000Z`),
		reservationTime: "19:00",
		reservationSource: "Sur place",
		allergies: "Fruits à coque",
		restrictions: "",
		notes: "",
		dishStatus: "En attente",
		paymentMethod: "Espèces",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
	{
		restaurantId: RESTAURANT_ID,
		orderIds: [],
		status: "en attente",
		clientName: "Sofia Lombardi",
		phone: "0610112233",
		nbPersonnes: 3,
		reservationDate: new Date(`${d3}T20:00:00.000Z`),
		reservationTime: "20:00",
		reservationSource: "À distance",
		allergies: "",
		restrictions: "",
		notes: "Réservation confirmée par email",
		dishStatus: "En attente",
		paymentMethod: "Carte",
		totalAmount: 0,
		paidAmount: 0,
		remainingAmount: 0,
		isPresent: false,
		canceled: false,
	},
];

async function seedReservationsCucina() {
	try {
		await mongoose.connect(process.env.MONGO_URI);


		const result = await Reservation.insertMany(reservations);

		// Récapitulatif par jour
		const byDay = {};
		result.forEach((r) => {
			const day = r.reservationDate.toISOString().split("T")[0];
			if (!byDay[day]) byDay[day] = [];
			byDay[day].push(r);
		});

		Object.entries(byDay)
			.sort(([a], [b]) => a.localeCompare(b))
			.forEach(([day, list]) => {
				const label = new Date(day).toLocaleDateString("fr-FR", {
					weekday: "long",
					day: "numeric",
					month: "long",
				});
				list
					.sort((a, b) => a.reservationTime.localeCompare(b.reservationTime))
					.forEach((r) => {
						const icon = r.status === "ouverte" ? "🟢" : "🔵";
					});
			});

		const totalPeople = result.reduce((s, r) => s + r.nbPersonnes, 0);

		await mongoose.connection.close();
	} catch (error) {
		console.error("❌ Erreur :", error);
		process.exit(1);
	}
}

seedReservationsCucina();
