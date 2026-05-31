const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");
const { RESERVATION_STATUS, ACTIVE_STATUSES } = require("../constants/reservationStatus");

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
	excludeReservationId = null,
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
		status: { $in: ACTIVE_STATUSES },
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
		status: { $in: ACTIVE_STATUSES },
	});

	return count;
}

/**
 * Attribution automatique des tables pour une date donnée (avec réassignation)
 * @param {String} restaurantId - ID du restaurant
 * @param {Date} date - Date pour l'attribution
 * @returns {Promise<Object>}
 */
async function autoAssignTables(restaurantId, date) {
	try {
		// Récupérer le turnover time du restaurant (default: 120min)
		const restaurant = await Restaurant.findById(restaurantId);
		const turnoverTime = restaurant?.turnoverTime || 120;

		// 1️⃣ Récupérer TOUTES les réservations du jour (avec et sans table)
		const dateStart = new Date(date);
		dateStart.setHours(0, 0, 0, 0);
		const dateEnd = new Date(date);
		dateEnd.setHours(23, 59, 59, 999);

		const allReservations = await Reservation.find({
			restaurantId: restaurantId,
			reservationDate: { $gte: dateStart, $lte: dateEnd },
			status: { $in: ACTIVE_STATUSES },
		});

		const unassignedCount = allReservations.filter((r) => !r.tableId).length;

		if (allReservations.length === 0) {
			return {
				status: "info",
				message: "Aucune réservation pour ce jour",
				assignedCount: 0,
				unassignedCount: 0,
				reassignedCount: 0,
				details: [],
			};
		}

		// 2️⃣ Récupérer toutes les tables actives du restaurant

		// Charger TOUTES les tables
		const allTablesDirect = await Table.find({ restaurantId: restaurantId });

		// Filtrer en JavaScript pour exclure seulement "unavailable"
		const tables = allTablesDirect.filter((t) => t.status !== "unavailable");

		// 3️⃣ Sauvegarder les anciennes attributions pour traçabilité
		const oldAssignments = new Map();
		allReservations.forEach((r) => {
			if (r.tableId) {
				oldAssignments.set(r._id.toString(), r.tableId.toString());
			}
		});

		// 4️⃣ RÉINITIALISER toutes les tables (permettre réassignation)
		for (const reservation of allReservations) {
			reservation.tableId = undefined;
		}

		// 5️⃣ Trier les réservations par priorité
		allReservations.sort((a, b) => {
			// 1. Plus grandes réservations en premier
			if (b.nbPersonnes !== a.nbPersonnes) {
				return b.nbPersonnes - a.nbPersonnes;
			}
			// 2. Puis par ordre chronologique
			const timeA = a.reservationTime || "00:00";
			const timeB = b.reservationTime || "00:00";
			return timeA.localeCompare(timeB);
		});

		const results = {
			assigned: [],
			unassigned: [],
			reassigned: [],
		};

		// 6️⃣ Attribution optimisée
		// 6️⃣ Attribution optimisée
		for (const reservation of allReservations) {
			const nbPersonnes = reservation.nbPersonnes || 1;
			const reservationTime = reservation.reservationTime || "12:00";
			const resaId = reservation._id.toString();
			const hadTable = oldAssignments.has(resaId);

			// Filtrer les tables avec capacité suffisante
			const suitableTables = tables.filter(
				(table) => table.capacity >= nbPersonnes,
			);

			if (suitableTables.length === 0) {
				results.unassigned.push({
					reservationId: reservation._id,
					clientName: reservation.clientName,
					nbPersonnes: nbPersonnes,
					time: reservationTime,
					reason: "no_table_with_sufficient_capacity",
				});
				continue;
			}

			// Vérifier la disponibilité de chaque table (en excluant cette réservation)
			const availableTables = [];
			for (const table of suitableTables) {
				// Vérifier si cette table est libre pour ce créneau
				// Prendre en compte TOUTES les réservations qui ont maintenant un tableId
				// (y compris celles qu'on vient d'assigner dans cette boucle)
				const isAvailable = await isTableAvailableForReservations(
					table._id,
					date,
					reservationTime,
					turnoverTime,
					allReservations.filter(
						(r) => r.tableId && r._id.toString() !== reservation._id.toString(),
					),
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
				results.unassigned.push({
					reservationId: reservation._id,
					clientName: reservation.clientName,
					nbPersonnes: nbPersonnes,
					time: reservationTime,
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

			// Vérifier si c'est une réassignation
			if (hadTable) {
				if (oldAssignments.get(resaId) !== bestTable._id.toString()) {
					results.reassigned.push({
						reservationId: reservation._id,
						clientName: reservation.clientName,
						oldTableId: oldAssignments.get(resaId),
						newTableId: bestTable._id,
						newTableName: bestTable.number,
					});
				}
			} else {
				results.assigned.push({
					reservationId: reservation._id,
					clientName: reservation.clientName,
					tableName: bestTable.number,
					tableId: bestTable._id,
				});
			}
		}

		// 7️⃣ Sauvegarder toutes les réservations (nouvelles attributions + réassignations)
		for (const reservation of allReservations) {
			await reservation.save();
		}

		const finalResult = {
			status: "success",
			assignedCount: results.assigned.length,
			reassignedCount: results.reassigned.length,
			unassignedCount: results.unassigned.length,
			details: {
				assigned: results.assigned,
				reassigned: results.reassigned,
				unassigned: results.unassigned,
			},
		};

		return finalResult;
	} catch (error) {
		console.error("❌ [AUTO-ASSIGN] Erreur:", error);
		throw error;
	}
}

/**
 * Vérifie si une table est disponible en vérifiant les conflits avec une liste de réservations
 * (version optimisée pour l'attribution globale)
 */
async function isTableAvailableForReservations(
	tableId,
	date,
	startTime,
	turnoverTime,
	reservationsWithTables,
) {
	// Construire les bornes du créneau
	const startDate = new Date(date);
	const [hours, minutes] = startTime.split(":");
	startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

	const endDate = new Date(startDate);
	endDate.setMinutes(endDate.getMinutes() + turnoverTime);

	// Vérifier les chevauchements avec les réservations déjà attribuées
	for (const resa of reservationsWithTables) {
		if (resa.tableId?.toString() !== tableId.toString()) continue;

		const resaStart = new Date(resa.reservationDate);
		const [rHours, rMinutes] = (resa.reservationTime || "00:00").split(":");
		resaStart.setHours(parseInt(rHours), parseInt(rMinutes), 0, 0);

		const resaEnd = new Date(resaStart);
		resaEnd.setMinutes(resaEnd.getMinutes() + turnoverTime);

		// Chevauchement si [start1, end1] ∩ [start2, end2] ≠ ∅
		if (startDate < resaEnd && endDate > resaStart) {
			return false;
		}
	}

	return true;
}

module.exports = {
	autoAssignTables,
	isTableAvailable,
	isTableAvailableForReservations,
	getTableUsageCount,
};
