/**
 * tableAvailabilityService.js - Service intelligent de disponibilité par table
 * Logique : raisonne table par table avec détection précise des chevauchements horaires
 */

const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");

/**
 * Vérifie la disponibilité table par table pour un créneau donné
 * @param {Object} params - Paramètres de la requête
 * @param {String} params.restaurantId - ID du restaurant
 * @param {String} params.date - Date au format YYYY-MM-DD
 * @param {String} params.time - Heure au format HH:MM
 * @param {Number} params.people - Nombre de personnes
 * @returns {Object} Résultat avec table(s) suggérée(s) et alternatives
 */
async function checkTableAvailability({ restaurantId, date, time, people }) {
	try {
		console.log("🔍 [TABLE SERVICE] Analyse disponibilité table par table");
		console.log(`📅 Date: ${date} | ⏰ Heure: ${time} | 👥 Personnes: ${people}`);

		// 1. Récupérer le turnover du restaurant
		const restaurant = await Restaurant.findById(restaurantId);
		if (!restaurant) {
			throw new Error("Restaurant non trouvé");
		}
		const turnover = restaurant.turnoverTime || 120;
		console.log(`⏱️  Turnover configuré: ${turnover} min`);

		// 2. Calculer la fenêtre temporelle demandée
		const requestedStart = parseTime(time);
		const requestedEnd = requestedStart + turnover;
		console.log(
			`🕐 Créneau demandé: ${time} → ${formatMinutesToTime(requestedEnd)} (${turnover} min)`
		);

		// 3. Récupérer toutes les tables actives du restaurant
		const tables = await Table.find({
			restaurantId,
			status: { $ne: "unavailable" },
		}).lean();

		if (!tables || tables.length === 0) {
			console.log("❌ Aucune table disponible dans ce restaurant");
			return {
				status: "error",
				reason: "Aucune table disponible dans ce restaurant",
				availableTables: [],
				alternatives: [],
			};
		}
		console.log(`📊 ${tables.length} table(s) active(s) trouvée(s)`);

		// 4. Récupérer les réservations actives du jour
		const startOfDay = new Date(date);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setHours(23, 59, 59, 999);

		const reservations = await Reservation.find({
			restaurantId,
			reservationDate: { $gte: startOfDay, $lte: endOfDay },
			status: { $in: ["en attente", "ouverte"] },
			tableId: { $ne: null },
		}).lean();

		console.log(`📋 ${reservations.length} réservation(s) active(s) ce jour`);

		// 5. Analyser chaque table individuellement
		const availableTables = [];
		const occupiedTables = [];

		for (const table of tables) {
			// Filtrer les réservations de cette table spécifique
			const tableReservations = reservations.filter(
				(r) => r.tableId && r.tableId.toString() === table._id.toString()
			);

			let hasConflict = false;
			let conflictDetails = null;

			// Vérifier les chevauchements horaires
			for (const res of tableReservations) {
				const resStart = parseTime(res.reservationTime);
				const resEnd = resStart + turnover;

				// Chevauchement si :
				// - Réservation commence avant notre fin ET
				// - Réservation finit après notre début
				if (resStart < requestedEnd && resEnd > requestedStart) {
					hasConflict = true;
					const overlapStart = Math.max(resStart, requestedStart);
					const overlapEnd = Math.min(resEnd, requestedEnd);
					const overlapMinutes = overlapEnd - overlapStart;
					const overlapPercent = Math.round(
						(overlapMinutes / turnover) * 100
					);

					conflictDetails = {
						reservationId: res._id,
						clientName: res.clientName,
						reservationTime: res.reservationTime,
						people: res.nbPersonnes,
						overlapMinutes,
						overlapPercent,
						overlapStart: formatMinutesToTime(overlapStart),
						overlapEnd: formatMinutesToTime(overlapEnd),
					};

					console.log(
						`❌ Table ${table._id} occupée: ${res.clientName} (${res.reservationTime}) - overlap ${overlapPercent}%`
					);
					break;
				}
			}

			// Table disponible si :
			// - Pas de conflit horaire
			// - Capacité suffisante
			if (!hasConflict && table.capacity >= people) {
				const score = calculateTableScore(table.capacity, people);
				availableTables.push({
					tableId: table._id,
					capacity: table.capacity,
					position: table.position,
					score,
					waste: table.capacity - people,
				});
				console.log(
					`✅ Table ${table._id} disponible: ${table.capacity} places (score: ${score})`
				);
			} else if (hasConflict) {
				occupiedTables.push({
					tableId: table._id,
					capacity: table.capacity,
					conflict: conflictDetails,
				});
			} else if (table.capacity < people) {
				console.log(
					`⚠️  Table ${table._id} trop petite: ${table.capacity} < ${people}`
				);
			}
		}

		console.log(
			`📊 Résultat: ${availableTables.length} table(s) disponible(s), ${occupiedTables.length} occupée(s)`
		);

		// 6. DÉCISION : Table individuelle disponible
		if (availableTables.length > 0) {
			// Trier par score (meilleure table en premier)
			availableTables.sort((a, b) => b.score - a.score);
			const bestTable = availableTables[0];

			console.log(
				`🎯 Meilleure table: ${bestTable.tableId} (${bestTable.capacity} places, score ${bestTable.score})`
			);

			return {
				status: "ok",
				reason: `Table disponible (${bestTable.capacity} places)`,
				suggestedTableId: bestTable.tableId,
				suggestedCapacity: bestTable.capacity,
				waste: bestTable.waste,
				availableTables: availableTables.map((t) => ({
					tableId: t.tableId,
					capacity: t.capacity,
					score: t.score,
					waste: t.waste,
				})),
				isCombined: false,
				occupiedTables: occupiedTables.length,
				turnoverTime: turnover,
			};
		}

		// 7. DÉCISION : Tenter combinaison de tables
		console.log("🔗 Tentative de combinaison de tables...");
		const combination = findCombinedTables(
			tables,
			reservations,
			requestedStart,
			requestedEnd,
			people,
			turnover
		);

		if (combination) {
			console.log(
				`✅ Combinaison trouvée: ${combination.tables.length} tables (${combination.totalCapacity} places)`
			);

			return {
				status: "ok",
				reason: `Combinaison de ${combination.tables.length} tables (${combination.totalCapacity} places)`,
				suggestedTableIds: combination.tables.map((t) => t._id),
				suggestedCapacity: combination.totalCapacity,
				isCombined: true,
				combinedTables: combination.tables.map((t) => ({
					tableId: t._id,
					capacity: t.capacity,
				})),
				turnoverTime: turnover,
			};
		}

		// 8. DÉCISION : Aucune solution → chercher alternatives
		console.log("🔍 Recherche d'alternatives dans la journée...");
		const alternatives = await scanDayForAlternatives({
			tables,
			reservations,
			date,
			requestedStart,
			people,
			turnover,
		});

		console.log(`📋 ${alternatives.length} alternative(s) trouvée(s)`);

		return {
			status: "refused",
			reason: "Aucune table disponible à ce créneau",
			occupiedTables: occupiedTables.length,
			occupiedDetails: occupiedTables.slice(0, 3).map((t) => ({
				tableId: t.tableId,
				capacity: t.capacity,
				conflict: {
					clientName: t.conflict.clientName,
					time: t.conflict.reservationTime,
					overlapPercent: t.conflict.overlapPercent,
				},
			})),
			alternatives,
			turnoverTime: turnover,
		};
	} catch (error) {
		console.error("❌ [TABLE SERVICE] Erreur:", error);
		throw error;
	}
}

/**
 * Calcule un score pour prioriser les tables
 * Objectif : privilégier la table la plus petite suffisante (éviter le gaspillage)
 */
function calculateTableScore(tableCapacity, requestedPeople) {
	if (tableCapacity < requestedPeople) return 0;

	const waste = tableCapacity - requestedPeople;

	// Perfect match = score maximal
	if (waste === 0) return 1000;
	if (waste === 1) return 800;
	if (waste === 2) return 600;

	// Plus le gaspillage est important, plus le score diminue
	return Math.max(0, 400 - waste * 20);
}

/**
 * Trouve une combinaison de tables pour les grands groupes
 */
function findCombinedTables(
	tables,
	reservations,
	reqStart,
	reqEnd,
	people,
	turnover
) {
	// 1. Identifier toutes les tables libres au créneau
	const freeTables = tables.filter((table) => {
		const tableRes = reservations.filter(
			(r) =>
				r.tableId && r.tableId.toString() === table._id.toString()
		);

		for (const res of tableRes) {
			const resStart = parseTime(res.reservationTime);
			const resEnd = resStart + turnover;
			if (resStart < reqEnd && resEnd > reqStart) {
				return false; // Table occupée
			}
		}
		return true; // Table libre
	});

	if (freeTables.length === 0) {
		console.log("❌ Aucune table libre pour combinaison");
		return null;
	}

	console.log(`🔗 ${freeTables.length} table(s) libre(s) pour combinaison`);

	// 2. Trier par capacité croissante (prendre les plus petites d'abord)
	freeTables.sort((a, b) => a.capacity - b.capacity);

	// 3. Construire la combinaison
	const combination = [];
	let totalCapacity = 0;

	for (const table of freeTables) {
		combination.push(table);
		totalCapacity += table.capacity;

		console.log(
			`🔗 Ajout table ${table._id} (${table.capacity} places) → Total: ${totalCapacity}`
		);

		if (totalCapacity >= people) {
			console.log(`✅ Combinaison suffisante: ${totalCapacity} >= ${people}`);
			return {
				tables: combination,
				totalCapacity,
			};
		}
	}

	console.log(
		`❌ Combinaison insuffisante: ${totalCapacity} < ${people} (même en utilisant toutes les tables)`
	);
	return null; // Pas assez même en combinant tout
}

/**
 * Scan la journée pour trouver des créneaux alternatifs
 */
async function scanDayForAlternatives({
	tables,
	reservations,
	date,
	requestedStart,
	people,
	turnover,
}) {
	const alternatives = [];
	const openingTime = 11 * 60; // 11h00
	const closingTime = 23 * 60; // 23h00
	const interval = 30; // Vérifier tous les 30 min

	for (let time = openingTime; time <= closingTime; time += interval) {
		// Skip le créneau demandé (±30 min)
		if (Math.abs(time - requestedStart) < 30) continue;

		const endTime = time + turnover;

		// Chercher une table disponible à ce créneau
		const availableTable = tables.find((table) => {
			if (table.capacity < people) return false;

			const tableRes = reservations.filter(
				(r) =>
					r.tableId &&
					r.tableId.toString() === table._id.toString()
			);

			for (const res of tableRes) {
				const resStart = parseTime(res.reservationTime);
				const resEnd = resStart + turnover;
				if (resStart < endTime && resEnd > time) {
					return false; // Occupée
				}
			}
			return true; // Libre
		});

		if (availableTable) {
			const distanceMinutes = Math.abs(time - requestedStart);
			alternatives.push({
				time: formatMinutesToTime(time),
				tableId: availableTable._id,
				capacity: availableTable.capacity,
				distanceMinutes,
				risk: "low",
			});

			if (alternatives.length >= 5) break; // Limiter à 5
		}
	}

	return alternatives;
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
	checkTableAvailability,
};
