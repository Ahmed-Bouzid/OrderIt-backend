/**
 * tableAvailabilityChecker.js
 * Calcule la disponibilité des tables en fonction des créneaux horaires
 * Une table est OQP si une réservation active existe dans la plage [heure-2h, heure+2h]
 */

const Reservation = require("../models/Reservation");

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
 * @param {Date} start1 - Début créneau 1
 * @param {Date} end1 - Fin créneau 1
 * @param {Date} start2 - Début créneau 2
 * @param {Date} end2 - Fin créneau 2
 * @returns {boolean}
 */
function timeSlotsOverlap(start1, end1, start2, end2) {
	return start1 < end2 && start2 < end1;
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
		console.log("🔍 [AVAILABILITY] Vérification disponibilité tables:", {
			restaurantId,
			date: reservationDate,
			time: reservationTime,
			duration,
		});

		// Si pas de date/heure, on ne peut pas déterminer la disponibilité
		if (!reservationDate || !reservationTime) {
			console.log(
				"⚠️ [AVAILABILITY] Date ou heure manquante - retour tableau vide"
			);
			return [];
		}

		// Parser la date et l'heure de début
		const requestedStart = parseTimeToDate(
			new Date(reservationDate),
			reservationTime
		);
		const requestedEnd = new Date(
			requestedStart.getTime() + duration * 60 * 1000
		);

		console.log("📅 [AVAILABILITY] Créneau demandé:", {
			start: requestedStart.toISOString(),
			end: requestedEnd.toISOString(),
		});

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
			status: { $in: ["en attente", "ouverte"] }, // Réservations actives uniquement
			...(excludeReservationId && { _id: { $ne: excludeReservationId } }),
		}).select("tableId reservationDate reservationTime");

		console.log(
			`📊 [AVAILABILITY] ${activeReservations.length} réservations actives trouvées`
		);

		// Construire la liste des tables occupées pour ce créneau
		const occupiedTableIds = new Set();

		for (const resa of activeReservations) {
			if (!resa.tableId || !resa.reservationTime) continue;

			// Calculer le créneau de la réservation existante
			const resaStart = parseTimeToDate(
				new Date(resa.reservationDate),
				resa.reservationTime
			);
			const resaEnd = new Date(resaStart.getTime() + duration * 60 * 1000);

			// Vérifier si les créneaux se chevauchent
			if (timeSlotsOverlap(requestedStart, requestedEnd, resaStart, resaEnd)) {
				occupiedTableIds.add(resa.tableId.toString());
				console.log(`❌ [AVAILABILITY] Table ${resa.tableId} occupée:`, {
					resaStart: resaStart.toISOString(),
					resaEnd: resaEnd.toISOString(),
				});
			}
		}

		// Retourner le Set converti en Array pour faciliter l'usage
		const occupiedIds = Array.from(occupiedTableIds);
		console.log(
			`✅ [AVAILABILITY] ${occupiedIds.length} tables occupées pour ce créneau`
		);

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
	getAvailableTableIds,
	enrichTablesWithAvailability,
	parseTimeToDate,
	timeSlotsOverlap,
};
