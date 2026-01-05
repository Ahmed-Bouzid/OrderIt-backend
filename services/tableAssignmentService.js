const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");

/**
 * Analyse si une table est disponible pour un créneau horaire donné
 * @param {String} tableId - ID de la table
 * @param {Date} date - Date de la réservation
 * @param {String} startTime - Heure de début (format "HH:MM")
 * @param {Number} turnoverTime - Temps de rotation en minutes (default: 120)
 * @param {String} excludeReservationId - ID de réservation à exclure
 * @returns {Promise<Boolean>}
 */
async function isTableAvailable(
	tableId,
	date,
	startTime,
	turnoverTime = 120,
	excludeReservationId = null
) {
	// Construire les bornes du créneau
	const startDate = new Date(date);
	const [hours, minutes] = startTime.split(":");
	startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

	const endDate = new Date(startDate);
	endDate.setMinutes(endDate.getMinutes() + turnoverTime);

	// Trouver toutes les réservations sur cette table pour ce jour
	const dateStart = new Date(date);
	dateStart.setHours(0, 0, 0, 0);
	const dateEnd = new Date(date);
	dateEnd.setHours(23, 59, 59, 999);

	const query = {
		tableId: tableId,
		reservationDate: { $gte: dateStart, $lte: dateEnd },
		status: { $in: ["en attente", "ouverte"] },
	};

	if (excludeReservationId) {
		query._id = { $ne: excludeReservationId };
	}

	const reservations = await Reservation.find(query);

	// Vérifier les chevauchements
	for (const resa of reservations) {
		const resaStart = new Date(resa.reservationDate);
		const [rHours, rMinutes] = (resa.reservationTime || "00:00").split(":");
		resaStart.setHours(parseInt(rHours), parseInt(rMinutes), 0, 0);

		const resaEnd = new Date(resaStart);
		resaEnd.setMinutes(resaEnd.getMinutes() + turnoverTime);

		// Chevauchement si [start1, end1] ∩ [start2, end2] ≠ ∅
		if (startDate < resaEnd && endDate > resaStart) {
			return false; // Chevauchement détecté
		}
	}

	return true; // Table disponible
}

/**
 * Compte combien de fois une table est utilisée dans la journée
 * @param {String} tableId - ID de la table
 * @param {Date} date - Date à analyser
 * @returns {Promise<Number>}
 */
async function getTableUsageCount(tableId, date) {
	const dateStart = new Date(date);
	dateStart.setHours(0, 0, 0, 0);
	const dateEnd = new Date(date);
	dateEnd.setHours(23, 59, 59, 999);

	const count = await Reservation.countDocuments({
		tableId: tableId,
		reservationDate: { $gte: dateStart, $lte: dateEnd },
		status: { $in: ["en attente", "ouverte"] },
	});

	return count;
}

/**
 * Attribution automatique des tables pour une date donnée
 * @param {String} restaurantId - ID du restaurant
 * @param {Date} date - Date pour l'attribution
 * @returns {Promise<Object>}
 */
async function autoAssignTables(restaurantId, date) {
	console.log("🤖 [AUTO-ASSIGN] Début attribution automatique pour", date);

	try {
		// Récupérer le turnover time du restaurant (default: 120min)
		const restaurant = await Restaurant.findById(restaurantId);
		const turnoverTime = restaurant?.turnoverTime || 120;

		// 1️⃣ Récupérer toutes les réservations sans table pour cette date
		const dateStart = new Date(date);
		dateStart.setHours(0, 0, 0, 0);
		const dateEnd = new Date(date);
		dateEnd.setHours(23, 59, 59, 999);

		const unassignedReservations = await Reservation.find({
			restaurantId: restaurantId,
			reservationDate: { $gte: dateStart, $lte: dateEnd },
			tableId: { $exists: false }, // Pas de table assignée
			status: { $in: ["en attente", "ouverte"] },
		}).sort({ reservationTime: 1 }); // Trier par heure croissante

		console.log(
			`📊 [AUTO-ASSIGN] ${unassignedReservations.length} réservations sans table`
		);

		if (unassignedReservations.length === 0) {
			return {
				status: "info",
				message: "Toutes les réservations ont déjà une table",
				assignedCount: 0,
				unassignedCount: 0,
				details: [],
			};
		}

		// 2️⃣ Récupérer toutes les tables actives du restaurant
		const tables = await Table.find({
			restaurantId: restaurantId,
			status: { $in: ["available", "occupied"] }, // Exclure unavailable
		});

		console.log(`🪑 [AUTO-ASSIGN] ${tables.length} tables disponibles`);

		const results = {
			assigned: [],
			unassigned: [],
		};

		// 3️⃣ Pour chaque réservation, trouver la meilleure table
		for (const reservation of unassignedReservations) {
			const nbPersonnes = reservation.nbPersonnes || 1;
			const reservationTime = reservation.reservationTime || "12:00";

			// Filtrer les tables avec capacité suffisante
			const suitableTables = tables.filter(
				(table) => table.capacity >= nbPersonnes
			);

			if (suitableTables.length === 0) {
				console.log(
					`❌ [AUTO-ASSIGN] Aucune table assez grande pour ${nbPersonnes} personnes`
				);
				results.unassigned.push({
					reservationId: reservation._id,
					clientName: reservation.clientName,
					reason: "no_table_with_sufficient_capacity",
				});
				continue;
			}

			// Vérifier la disponibilité de chaque table
			const availableTables = [];
			for (const table of suitableTables) {
				const isAvailable = await isTableAvailable(
					table._id,
					date,
					reservationTime,
					turnoverTime
				);

				if (isAvailable) {
					const usageCount = await getTableUsageCount(table._id, date);
					availableTables.push({
						table,
						usageCount,
					});
				}
			}

			if (availableTables.length === 0) {
				console.log(
					`❌ [AUTO-ASSIGN] Aucune table disponible pour ${reservation.clientName} à ${reservationTime}`
				);
				results.unassigned.push({
					reservationId: reservation._id,
					clientName: reservation.clientName,
					reason: "no_available_table_at_time",
				});
				continue;
			}

			// Choisir la meilleure table (plus petite suffisante, puis moins utilisée)
			availableTables.sort((a, b) => {
				// 1. Préférer la plus petite table suffisante
				if (a.table.capacity !== b.table.capacity) {
					return a.table.capacity - b.table.capacity;
				}
				// 2. En cas d'égalité, préférer la moins utilisée
				return a.usageCount - b.usageCount;
			});

			const bestTable = availableTables[0].table;

			// Attribuer la table
			reservation.tableId = bestTable._id;
			await reservation.save();

			console.log(
				`✅ [AUTO-ASSIGN] ${reservation.clientName} → ${bestTable.number}`
			);

			results.assigned.push({
				reservationId: reservation._id,
				clientName: reservation.clientName,
				tableName: bestTable.number,
				tableId: bestTable._id,
			});
		}

		return {
			status: "success",
			assignedCount: results.assigned.length,
			unassignedCount: results.unassigned.length,
			details: {
				assigned: results.assigned,
				unassigned: results.unassigned,
			},
		};
	} catch (error) {
		console.error("❌ [AUTO-ASSIGN] Erreur:", error);
		throw error;
	}
}

module.exports = {
	autoAssignTables,
	isTableAvailable,
	getTableUsageCount,
};
