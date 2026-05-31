/**
 * slotGenerator.js
 * Génère les créneaux de réservation disponibles pour un restaurant / un jour donné.
 *
 * Algorithme :
 * 1. Charger restaurant (openingHours, turnoverTime, category) + tables avec leur capacité
 * 2. Filtrer les tables éligibles par capacité (>= guests si fourni)
 * 3. Charger les réservations actives du jour (en attente + ouverte) avec leur tableId
 * 4. Générer tous les créneaux possibles entre open et (close - duration) par pas de stepMinutes
 * 5. Pour chaque créneau, compter les réservations qui chevauchent ET occupent une table éligible
 * 6. availableTables = tablesEligibles - occupiedEligibles
 * 7. Filtrer les créneaux à 0 dispo
 *
 * Réutilise parseTimeToDate et timeSlotsOverlap de tableAvailabilityChecker.
 */

const Reservation = require("../models/Reservation");
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");
const {
	parseTimeToDate,
	timeSlotsOverlap,
} = require("./tableAvailabilityChecker");

/**
 * Génère la liste brute des créneaux (strings "HH:MM") entre open et close.
 * Le dernier créneau possible est celui dont la fin (+ duration) ne dépasse pas closeTime.
 *
 * @param {string} openTime  - "HH:MM"
 * @param {string} closeTime - "HH:MM"
 * @param {number} duration  - durée de la réservation en minutes
 * @param {number} step      - pas entre créneaux en minutes (défaut 15)
 * @returns {string[]} - ex: ["12:00", "12:15", "12:30", ...]
 */
function generateRawSlots(openTime, closeTime, duration, step = 15) {
	const [openH, openM] = openTime.split(":").map(Number);
	const [closeH, closeM] = closeTime.split(":").map(Number);

	const openMinutes = openH * 60 + openM;
	const closeMinutes = closeH * 60 + closeM;

	// Le dernier créneau doit finir au plus tard à closeTime
	const lastStart = closeMinutes - duration;

	if (lastStart < openMinutes) return []; // durée > amplitude d'ouverture

	const slots = [];
	for (let m = openMinutes; m <= lastStart; m += step) {
		const h = Math.floor(m / 60);
		const min = m % 60;
		slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
	}
	return slots;
}

/**
 * Calcule les créneaux disponibles pour un restaurant et une date donnés.
 * Si `guests` est fourni, seules les tables pouvant accueillir ce nombre de convives sont comptées.
 *
 * @param {Object} params
 * @param {string} params.restaurantId
 * @param {Date|string} params.date        - date du jour à analyser (ISO ou Date)
 * @param {number}  [params.stepMinutes]   - pas en minutes (défaut 15)
 * @param {boolean} [params.includeZero]   - inclure les créneaux à 0 dispo (défaut false)
 * @param {number}  [params.guests]        - nb de convives — filtre les tables par capacité
 *
 * @returns {Promise<Array<{ time: string, availableTables: number, totalTables: number }>>}
 */
async function getAvailableSlotsForDay({
	restaurantId,
	date,
	stepMinutes = 15,
	includeZero = false,
	guests = 0,
}) {
	// 1. Charger restaurant
	const restaurant = await Restaurant.findById(restaurantId).select(
		"turnoverTime openingHours category",
	);

	if (!restaurant) return [];

	// Les foodtrucks n'ont pas de gestion de tables fixes
	if (restaurant.category === "foodtruck") return [];

	const duration = restaurant.turnoverTime || 120;
	const openTime = restaurant.openingHours?.open || "12:00";
	const closeTime = restaurant.openingHours?.close || "22:00";

	// 2. Charger les tables actives AVEC leur capacité
	const allTables = await Table.find({
		restaurantId,
		status: { $ne: "unavailable" },
	})
		.select("_id capacity")
		.lean();

	if (allTables.length === 0) return [];

	// Filtrer les tables éligibles selon le nombre de convives demandé
	const eligibleTables =
		guests > 0
			? allTables.filter((t) => (t.capacity || 0) >= guests)
			: allTables;

	if (eligibleTables.length === 0) return []; // aucune table ne peut accueillir ce groupe

	const eligibleIds = new Set(eligibleTables.map((t) => t._id.toString()));
	const totalEligible = eligibleTables.length;

	// 3. Charger les réservations actives du jour avec leur tableId
	const baseDate = new Date(date);
	const startOfDay = new Date(baseDate);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(baseDate);
	endOfDay.setHours(23, 59, 59, 999);

	const activeReservations = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: startOfDay, $lte: endOfDay },
		status: { $in: ["pending", "confirmed"] },
		reservationTime: { $exists: true, $ne: "" },
	})
		.select("reservationTime reservationDate tableId")
		.lean();


	// Pré-calculer les plages + tableId de chaque réservation (une seule fois)
	const reservationRanges = activeReservations.map((r) => {
		const start = parseTimeToDate(
			new Date(r.reservationDate),
			r.reservationTime,
		);
		const end = new Date(start.getTime() + duration * 60 * 1000);
		return {
			start,
			end,
			tableId: r.tableId ? r.tableId.toString() : null,
		};
	});

	// 4. Générer et évaluer chaque créneau
	const rawSlots = generateRawSlots(openTime, closeTime, duration, stepMinutes);

	const result = rawSlots.map((slotTime) => {
		const slotStart = parseTimeToDate(new Date(baseDate), slotTime);
		const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

		// Compter les résas en overlap qui occupent une table éligible :
		// - résas sans tableId spécifique → occupent "une table quelconque" (décompte conservateur)
		// - résas avec tableId → compte seulement si ce tableId est dans la liste éligible
		const occupiedEligible = reservationRanges.filter(({ start, end, tableId }) => {
			if (!timeSlotsOverlap(slotStart, slotEnd, start, end)) return false;
			if (!tableId) return true; // table inconnue → pessimiste
			return eligibleIds.has(tableId);
		}).length;

		const availableTables = Math.max(0, totalEligible - occupiedEligible);

		return {
			time: slotTime,
			availableTables,
			totalTables: totalEligible,
			isAvailable: availableTables > 0,
		};
	});

	// 5. Filtrer les créneaux complets sauf si includeZero
	const filtered = includeZero
		? result
		: result.filter((s) => s.availableTables > 0);


	return filtered;
}

module.exports = { getAvailableSlotsForDay, generateRawSlots };
