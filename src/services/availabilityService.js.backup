/**
 * availabilityService.js - Service intelligent pour calcul de disponibilité
 * Analyse les réservations et propose des créneaux alternatifs
 */

const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");

/**
 * Vérifie la disponibilité d'un créneau et propose des alternatives
 * @param {Object} params - Paramètres de la requête
 * @param {String} params.restaurantId - ID du restaurant
 * @param {String} params.date - Date au format YYYY-MM-DD
 * @param {String} params.time - Heure au format HH:MM
 * @param {Number} params.people - Nombre de personnes
 * @returns {Object} Résultat avec statut et alternatives
 */
async function checkAvailability({ restaurantId, date, time, people }) {
	try {
		// 1. Récupérer le turnover configuré (par défaut 120 min)
		const restaurant = await Restaurant.findById(restaurantId);
		const turnoverTime = restaurant?.turnoverTime || 120; // minutes

		// 2. Récupérer toutes les tables du restaurant
		const tables = await Table.find({
			restaurantId,
			status: { $ne: "unavailable" },
		}).lean();

		if (!tables.length) {
			return {
				status: "error",
				message: "Aucune table disponible dans ce restaurant",
				alternatives: [],
			};
		}

		// 3. Calculer la capacité totale
		const totalCapacity = tables.reduce((sum, t) => sum + (t.capacity || 4), 0);

		// 4. Récupérer les réservations du jour
		const startOfDay = new Date(date);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setHours(23, 59, 59, 999);

		const reservations = await Reservation.find({
			restaurantId,
			reservationDate: { $gte: startOfDay, $lte: endOfDay },
			status: { $in: ["en attente", "ouverte"] },
		})
			.populate("tableId", "capacity")
			.lean();

		// 5. Construire les intervalles occupés
		const requestedTime = parseTime(time);
		const requestedEnd = requestedTime + turnoverTime;

		const conflicts = [];
		const occupiedIntervals = reservations.map((res) => {
			const resTime = parseTime(res.reservationTime);
			const resEnd = resTime + turnoverTime;

			const overlap = checkOverlap(
				requestedTime,
				requestedEnd,
				resTime,
				resEnd
			);

			if (overlap.hasOverlap) {
				conflicts.push({
					reservation: res,
					overlapType: overlap.type,
					overlapMinutes: overlap.minutes,
				});
			}

			return {
				start: resTime,
				end: resEnd,
				people: res.nbPersonnes || 1,
				tableCapacity: res.tableId?.capacity || 4,
			};
		});

		// 6. Analyser le statut du créneau demandé
		const occupiedSeats = conflicts.reduce(
			(sum, c) => sum + (c.reservation.nbPersonnes || 0),
			0
		);
		const availableSeats = totalCapacity - occupiedSeats;

		let status = "ok";
		let risk = "low";
		let reason = "";

		if (availableSeats < people) {
			status = "refused";
			risk = "high";
			reason = `Capacité insuffisante : ${availableSeats} places disponibles pour ${people} personnes`;
		} else if (conflicts.length > 0) {
			const hasFullOverlap = conflicts.some((c) => c.overlapType === "full");
			if (hasFullOverlap) {
				status = "warning";
				risk = "medium";
				reason = `Créneau risqué : ${conflicts.length} réservation(s) proche(s)`;
			} else {
				status = "warning";
				risk = "low";
				reason = `Possible mais avec ${conflicts.length} réservation(s) à proximité`;
			}
		} else {
			reason = "Créneau disponible";
		}

		// 7. Si refusé ou risqué, calculer des alternatives
		let alternatives = [];
		if (status === "refused" || status === "warning") {
			alternatives = findAlternatives({
				date,
				requestedTime,
				turnoverTime,
				people,
				occupiedIntervals,
				totalCapacity,
			});
		}

		return {
			status,
			risk,
			reason,
			availableSeats,
			totalCapacity,
			conflicts: conflicts.map((c) => ({
				time: formatMinutesToTime(parseTime(c.reservation.reservationTime)),
				people: c.reservation.nbPersonnes,
				overlapType: c.overlapType,
			})),
			alternatives,
			turnoverTime,
		};
	} catch (error) {
		console.error("❌ Erreur checkAvailability:", error);
		throw error;
	}
}

/**
 * Trouve les meilleurs créneaux alternatifs
 */
function findAlternatives({
	date,
	requestedTime,
	turnoverTime,
	people,
	occupiedIntervals,
	totalCapacity,
}) {
	const alternatives = [];
	const openingTime = 11 * 60; // 11h00
	const closingTime = 23 * 60; // 23h00
	const checkInterval = 30; // Vérifier tous les 30 min

	// Parcourir la journée par tranches de 30 min
	for (let time = openingTime; time <= closingTime; time += checkInterval) {
		if (Math.abs(time - requestedTime) < 30) continue; // Skip le créneau demandé

		const endTime = time + turnoverTime;

		// Calculer les places occupées à ce créneau
		let occupiedSeats = 0;
		let hasOverlap = false;

		for (const interval of occupiedIntervals) {
			const overlap = checkOverlap(time, endTime, interval.start, interval.end);
			if (overlap.hasOverlap) {
				occupiedSeats += interval.people;
				hasOverlap = true;
			}
		}

		const availableSeats = totalCapacity - occupiedSeats;

		// Si suffisamment de places, c'est une alternative
		if (availableSeats >= people) {
			const distanceMinutes = Math.abs(time - requestedTime);
			let risk = "low";

			if (hasOverlap) {
				risk = occupiedSeats > totalCapacity * 0.7 ? "medium" : "low";
			}

			alternatives.push({
				time: formatMinutesToTime(time),
				risk,
				availableSeats,
				distanceMinutes,
				score: calculateScore(distanceMinutes, risk, availableSeats),
			});
		}
	}

	// Trier par score (meilleur d'abord) et limiter à 5
	return alternatives
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map(({ time, risk, availableSeats, distanceMinutes }) => ({
			time,
			risk,
			availableSeats,
			distanceMinutes,
		}));
}

/**
 * Calcule un score pour classer les alternatives
 */
function calculateScore(distanceMinutes, risk, availableSeats) {
	let score = 1000;

	// Pénalité distance (plus c'est loin, moins c'est bon)
	score -= distanceMinutes * 2;

	// Pénalité risque
	if (risk === "medium") score -= 100;
	if (risk === "high") score -= 300;

	// Bonus places disponibles
	score += availableSeats * 5;

	return score;
}

/**
 * Vérifie le chevauchement entre deux intervalles
 */
function checkOverlap(start1, end1, start2, end2) {
	const hasOverlap = start1 < end2 && end1 > start2;

	if (!hasOverlap) {
		return { hasOverlap: false, type: "none", minutes: 0 };
	}

	const overlapStart = Math.max(start1, start2);
	const overlapEnd = Math.min(end1, end2);
	const minutes = overlapEnd - overlapStart;

	const duration1 = end1 - start1;
	const duration2 = end2 - start2;
	const overlapRatio = minutes / Math.min(duration1, duration2);

	let type = "partial";
	if (overlapRatio > 0.8) {
		type = "full";
	} else if (overlapRatio > 0.5) {
		type = "significant";
	}

	return { hasOverlap: true, type, minutes };
}

/**
 * Parse HH:MM en minutes depuis minuit
 */
function parseTime(timeStr) {
	if (!timeStr) return 0;
	const [hours, minutes] = timeStr.split(":").map(Number);
	return hours * 60 + (minutes || 0);
}

/**
 * Formate les minutes en HH:MM
 */
function formatMinutesToTime(minutes) {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

module.exports = {
	checkAvailability,
};
