/**
 * tableAvailabilityChecker.js
 * Calcule la disponibilité des tables en fonction des créneaux horaires
 * Une table est OQP si une réservation active existe dans la plage [heure-2h, heure+2h]
 */

const Reservation = require("../models/Reservation");
const { RESERVATION_STATUS } = require("../constants/reservationStatus");

/**
 * Parse une heure au format "HH:MM" et retourne un objet Date avec cette heure
 * @param {Date} baseDate - Date de base
 * @param {string} timeString - Heure au format "HH:MM"
 * @returns {Date}
 */
function parseTimeToDate(baseDate, timeString) {
	if (!timeString) return baseDate;

	const [hours, minutes] = timeString.split(":").map(Number);
	const date = new Date(baseDate);
	date.setHours(hours, minutes, 0, 0);
	return date;
}

/**
 * Vérifie si deux créneaux horaires se chevauchent
 * startA < endB AND endA > startB
 * Couvre les cas limites : 18:30–19:30 vs 19:00–20:00 → overlap
 * @param {Date} start1
 * @param {Date} end1
 * @param {Date} start2
 * @param {Date} end2
 * @returns {boolean}
 */
function timeSlotsOverlap(start1, end1, start2, end2) {
	return start1 < end2 && end1 > start2;
}

/**
 * Vérifie si le créneau demandé est complet pour le restaurant.
 * Compare le nombre de réservations actives en overlap avec le nombre total de tables.
 *
 * Robuste car :
 * - Compte toutes les résas actives (avec ou sans tableId assigné)
 * - Utilise restaurant.turnoverTime pour calculer la durée de chaque créneau
 * - Ignore les foodtrucks (open seating, pas de notion de tables fixes)
 *
 * @param {Object} params
 * @param {string} params.restaurantId
 * @param {Date|string} params.reservationDate
 * @param {string} params.reservationTime - format "HH:MM"
 * @param {string} [params.excludeReservationId] - ID à exclure (cas modification)
 * @returns {Promise<{
 *   allowed: boolean,
 *   occupiedCount: number,
 *   totalTables: number,
 *   duration: number
 * }>}
 */
async function checkOverbooking({
	restaurantId,
	reservationDate,
	reservationTime,
	excludeReservationId = null,
}) {
	const Restaurant = require("../models/Restaurant");
	const Table = require("../models/Table");

	// Sans date/heure on ne peut pas calculer — on laisse passer
	if (!reservationDate || !reservationTime) {
		return { allowed: true, occupiedCount: 0, totalTables: 0, duration: 0 };
	}

	// Charger le restaurant pour le turnoverTime et la catégorie
	const restaurant = await Restaurant.findById(restaurantId).select(
		"turnoverTime category",
	);

	// Les foodtrucks ont une gestion différente (file d'attente, pas de tables fixes)
	if (restaurant?.category === "foodtruck") {
		return { allowed: true, occupiedCount: 0, totalTables: 0, duration: 0 };
	}

	const duration = restaurant?.turnoverTime || 120;

	// Compter les tables actives (exclure les tables hors service)
	const totalTables = await Table.countDocuments({
		restaurantId,
		status: { $ne: "unavailable" },
	});

	// Pas de tables configurées → on laisse passer (restaurant non encore configuré)
	if (totalTables === 0) {
		return { allowed: true, occupiedCount: 0, totalTables: 0, duration };
	}

	// Créneau demandé
	const requestedStart = parseTimeToDate(
		new Date(reservationDate),
		reservationTime,
	);
	const requestedEnd = new Date(
		requestedStart.getTime() + duration * 60 * 1000,
	);

	// Bornes du jour pour limiter la requête MongoDB
	const startOfDay = new Date(reservationDate);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(reservationDate);
	endOfDay.setHours(23, 59, 59, 999);

	// Toutes les réservations actives du jour avec une heure définie
	const activeReservations = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: startOfDay, $lte: endOfDay },
		status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED] },
		reservationTime: { $exists: true, $ne: "" },
		...(excludeReservationId && { _id: { $ne: excludeReservationId } }),
	}).select("reservationTime reservationDate");

	// Compter celles qui chevauchent le créneau demandé
	let overlappingCount = 0;
	for (const resa of activeReservations) {
		const resaStart = parseTimeToDate(
			new Date(resa.reservationDate),
			resa.reservationTime,
		);
		const resaEnd = new Date(resaStart.getTime() + duration * 60 * 1000);

		if (timeSlotsOverlap(requestedStart, requestedEnd, resaStart, resaEnd)) {
			overlappingCount++;
		}
	}

	const allowed = overlappingCount < totalTables;


	return { allowed, occupiedCount: overlappingCount, totalTables, duration };
}

/**
 * Récupère les tables disponibles pour une date/heure donnée
 * @param {string} restaurantId - ID du restaurant
 * @param {Date} reservationDate - Date de la réservation
 * @param {string} reservationTime - Heure au format "HH:MM"
 * @param {number} duration - Durée en minutes (défaut: 120 = 2h)
 * @param {string} excludeReservationId - ID d'une réservation à exclure (pour modification)
 * @returns {Promise<Array>} - Liste des IDs de tables disponibles
 */
async function getAvailableTableIds({
	restaurantId,
	reservationDate,
	reservationTime,
	duration = 120,
	excludeReservationId = null,
}) {
	try {

		// Si pas de date/heure, on ne peut pas déterminer la disponibilité
		if (!reservationDate || !reservationTime) {
			return [];
		}

		// Parser la date et l'heure de début
		const requestedStart = parseTimeToDate(
			new Date(reservationDate),
			reservationTime,
		);
		const requestedEnd = new Date(
			requestedStart.getTime() + duration * 60 * 1000,
		);


		// Récupérer toutes les réservations actives du restaurant pour ce jour
		const startOfDay = new Date(reservationDate);
		startOfDay.setHours(0, 0, 0, 0);

		const endOfDay = new Date(reservationDate);
		endOfDay.setHours(23, 59, 59, 999);

		const activeReservations = await Reservation.find({
			restaurantId,
			reservationDate: {
				$gte: startOfDay,
				$lte: endOfDay,
			},
			status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED] },
			...(excludeReservationId && { _id: { $ne: excludeReservationId } }),
		}).select("tableId reservationDate reservationTime");


		// Construire la liste des tables occupées pour ce créneau
		const occupiedTableIds = new Set();

		for (const resa of activeReservations) {
			if (!resa.tableId || !resa.reservationTime) continue;

			// Calculer le créneau de la réservation existante
			const resaStart = parseTimeToDate(
				new Date(resa.reservationDate),
				resa.reservationTime,
			);
			const resaEnd = new Date(resaStart.getTime() + duration * 60 * 1000);

			// Vérifier si les créneaux se chevauchent
			if (timeSlotsOverlap(requestedStart, requestedEnd, resaStart, resaEnd)) {
				occupiedTableIds.add(resa.tableId.toString());
			}
		}

		// Retourner le Set converti en Array pour faciliter l'usage
		const occupiedIds = Array.from(occupiedTableIds);

		return occupiedIds;
	} catch (error) {
		console.error("❌ [AVAILABILITY] Erreur calcul disponibilité:", error);
		return [];
	}
}

/**
 * Enrichit une liste de tables avec leur statut de disponibilité
 * @param {Array} tables - Liste des tables
 * @param {Array} occupiedTableIds - IDs des tables occupées
 * @returns {Array} - Tables enrichies avec isAvailable
 */
function enrichTablesWithAvailability(tables, occupiedTableIds) {
	return tables.map((table) => {
		const tableId = table._id.toString();
		const isAvailable = !occupiedTableIds.includes(tableId);

		return {
			...(table.toObject ? table.toObject() : table),
			isAvailable,
		};
	});
}

module.exports = {
	checkOverbooking,
	getAvailableTableIds,
	enrichTablesWithAvailability,
	parseTimeToDate,
	timeSlotsOverlap,
};
