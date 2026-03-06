/**
 * reservationAI.js
 *
 * 9 fonctions d'intelligence artificielle pour la gestion des réservations.
 * Aucune dépendance externe — tout est calculé localement à partir de MongoDB.
 *
 * 1. generateSmartSlots         — Créneaux disponibles enrichis d'un score d'occupation
 * 2. suggestAlternativeSlots    — Alternatives ±3 jours / ±2h si créneau complet
 * 3. autoAssignTable            — Table optimale (capacité, rotations, gaspillage minimal)
 * 4. buildHeatmap               — Matrice jour × créneau de l'affluence historique
 * 5. detectGaps                 — Trous inutilisables entre deux réservations
 * 6. getSmartDuration           — Durée recommandée selon taille du groupe + historique
 * 7. getWaitingList             — Liste d'attente triée par priorité
 *    promoteFromWaitingList     — Promotion automatique quand une table se libère
 * 8. predictAffluence           — Prédiction d'occupation pour une date cible
 * 9. recommendStrategicSlots    — Créneaux sous-exploités à promouvoir
 */

const Reservation = require("../models/Reservation");
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");
const {
	getAvailableSlotsForDay,
	generateRawSlots,
} = require("./slotGenerator");
const {
	parseTimeToDate,
	timeSlotsOverlap,
} = require("./tableAvailabilityChecker");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNES
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:MM" → minutes depuis minuit */
function timeToMin(hhmm) {
	const [h, m] = (hhmm || "00:00").split(":").map(Number);
	return h * 60 + m;
}

/** Bornes d'une journée */
function dayBounds(date) {
	const d = new Date(date);
	const start = new Date(d);
	start.setHours(0, 0, 0, 0);
	const end = new Date(d);
	end.setHours(23, 59, 59, 999);
	return { start, end };
}

/** Charge restaurant + paramètres essentiels */
async function loadRestaurant(restaurantId) {
	return Restaurant.findById(restaurantId)
		.select("turnoverTime openingHours category name")
		.lean();
}

const DAY_NAMES = [
	"Dimanche",
	"Lundi",
	"Mardi",
	"Mercredi",
	"Jeudi",
	"Vendredi",
	"Samedi",
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. GÉNÉRATION AUTOMATIQUE DE CRÉNEAUX
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne les créneaux disponibles d'une journée, enrichis d'un score d'occupation
 * et d'un label lisible ("Disponible", "Animé", "Presque complet", "Complet").
 *
 * Connexion : wrapper de getAvailableSlotsForDay (slotGenerator.js).
 *
 * Exemple d'usage : NewReservationModal affiche les créneaux colorés selon l'affluence.
 *   → L'utilisateur voit d'un coup d'œil les créneaux calmes vs saturés.
 *
 * @param {string} restaurantId
 * @param {Date|string} date
 * @param {number} guests - 0 = tous les créneaux
 * @returns {Array<{ time, availableTables, totalTables, occupancyRate, label }>}
 */
async function generateSmartSlots(restaurantId, date, guests = 0) {
	const slots = await getAvailableSlotsForDay({
		restaurantId,
		date,
		stepMinutes: 15,
		includeZero: true,
		guests,
	});

	return slots.map((s) => {
		const occupancyRate =
			s.totalTables > 0
				? Math.round(
						((s.totalTables - s.availableTables) / s.totalTables) * 100,
					)
				: 0;

		let label = "Disponible";
		if (s.availableTables === 0) label = "Complet";
		else if (occupancyRate >= 80) label = "Presque complet";
		else if (occupancyRate >= 50) label = "Animé";

		return { ...s, occupancyRate, label };
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUGGESTIONS D'HORAIRES SI CRÉNEAU COMPLET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quand un créneau est complet, recherche les meilleures alternatives ±3 jours / ±2h.
 * Trie par score de proximité (même jour + même heure = score le plus bas = meilleur).
 *
 * Algorithme :
 *  - Pour chaque offset -3…+3 jours et chaque créneau disponible ce jour-là
 *  - distanceScore = dayOffset × 200 + abs(timeDelta en min)
 *  - Retourne les 8 meilleures options
 *
 * Exemple d'usage : modal "Créneau complet ?" propose automatiquement le prochain dispo
 *   → Évite que le client raccroche, réduit le taux d'abandon.
 *
 * @param {string} restaurantId
 * @param {Date|string} requestedDate
 * @param {string} requestedTime  "HH:MM"
 * @param {number} guests
 * @returns {Array<{ date, time, availableTables, distanceScore, dayOffset, timeDelta }>}
 */
async function suggestAlternativeSlots(
	restaurantId,
	requestedDate,
	requestedTime,
	guests = 0,
) {
	const reqMin = timeToMin(requestedTime);
	const base = new Date(requestedDate);
	const now = new Date();
	const alternatives = [];

	for (let dayOffset = -3; dayOffset <= 3; dayOffset++) {
		const d = new Date(base);
		d.setDate(d.getDate() + dayOffset);
		if (d < now) continue; // ignorer le passé

		const slots = await getAvailableSlotsForDay({
			restaurantId,
			date: d,
			stepMinutes: 30,
			guests,
		});

		for (const s of slots) {
			if (s.availableTables === 0) continue;
			const timeDelta = Math.abs(timeToMin(s.time) - reqMin);
			if (timeDelta > 120) continue; // >2h = trop loin

			const distanceScore = Math.abs(dayOffset) * 200 + timeDelta;
			alternatives.push({
				date: d.toISOString().slice(0, 10),
				time: s.time,
				availableTables: s.availableTables,
				distanceScore,
				dayOffset,
				timeDelta,
			});
		}
	}

	alternatives.sort((a, b) => a.distanceScore - b.distanceScore);
	return alternatives.slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OPTIMISATION AUTOMATIQUE DES TABLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trouve la table idéale pour une réservation donnée.
 *
 * Algorithme de scoring (ascending = meilleur) :
 *  1. Capacité >= nbPersonnes (éliminatoire)
 *  2. Pas de conflit horaire sur ce créneau (éliminatoire)
 *  3. wasteScore  = capacité - nbPersonnes          (× 10) → évite le gaspillage
 *  4. dayCount    = nb de résas déjà ce jour-là     (× 5)  → distribue la charge
 *
 * Exemple d'usage : bouton "Assigner auto" dans SettingsModal / AssignTableModal.
 *   → Gain de temps serveur + optimisation de la rotation des tables.
 *
 * @param {string} restaurantId
 * @param {string} reservationId
 * @returns {{ tableId, tableName, capacity, reason, score } | null}
 */
async function autoAssignTable(restaurantId, reservationId) {
	const resa = await Reservation.findById(reservationId).lean();
	if (!resa) throw new Error("Réservation introuvable");

	const restaurant = await loadRestaurant(restaurantId);
	const duration = restaurant.turnoverTime || 120;

	const tables = await Table.find({
		restaurantId,
		status: { $ne: "unavailable" },
	})
		.select("_id number label capacity")
		.lean();

	const { start: dayStart, end: dayEnd } = dayBounds(resa.reservationDate);

	const dayResas = await Reservation.find({
		restaurantId,
		_id: { $ne: reservationId },
		reservationDate: { $gte: dayStart, $lte: dayEnd },
		status: { $in: ["en attente", "ouverte"] },
		tableId: { $exists: true, $ne: null },
	})
		.select("tableId reservationTime reservationDate")
		.lean();

	const resaStart = parseTimeToDate(
		new Date(resa.reservationDate),
		resa.reservationTime,
	);
	const resaEnd = new Date(resaStart.getTime() + duration * 60 * 1000);

	const scored = [];

	for (const table of tables) {
		if ((table.capacity || 0) < (resa.nbPersonnes || 1)) continue;

		const hasConflict = dayResas.some((r) => {
			if (r.tableId.toString() !== table._id.toString()) return false;
			const s = parseTimeToDate(new Date(r.reservationDate), r.reservationTime);
			const e = new Date(s.getTime() + duration * 60 * 1000);
			return timeSlotsOverlap(resaStart, resaEnd, s, e);
		});
		if (hasConflict) continue;

		const wasteScore = (table.capacity || 4) - (resa.nbPersonnes || 1);
		const dayCount = dayResas.filter(
			(r) => r.tableId.toString() === table._id.toString(),
		).length;
		const score = wasteScore * 10 + dayCount * 5;

		scored.push({ table, score, wasteScore, dayCount });
	}

	if (scored.length === 0) return null;
	scored.sort((a, b) => a.score - b.score);

	const best = scored[0];
	return {
		tableId: best.table._id.toString(),
		tableName: best.table.label || best.table.number || "?",
		capacity: best.table.capacity,
		reason: `Capacité ${best.table.capacity}p, ${best.dayCount} résa(s) ce jour`,
		score: best.score,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HEATMAP JOUR / CRÉNEAU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit une matrice [0..6][HH:30] représentant l'affluence historique
 * par jour de semaine et par demi-heure.
 *
 * Algorithme :
 *  - Charge les N dernières semaines de résas (statut ouverte/terminée)
 *  - Agrège par (dayOfWeek, roundedSlot) → count + totalPersonnes
 *  - Calcule peakDay, peakTime, minimalDay
 *
 * Exemple d'usage : page "Analytics" affiche une grille colorée type GitHub contributions.
 *   → Le manager voit instantanément ses vendredis à 20h saturés vs ses lundis creux.
 *
 * @param {string} restaurantId
 * @param {number} weeksBack
 * @returns {{ matrix, peakDay, peakDayName, peakTime, minimalDay, minimalDayName, totalResas, weeksAnalyzed }}
 */
async function buildHeatmap(restaurantId, weeksBack = 8) {
	const since = new Date();
	since.setDate(since.getDate() - weeksBack * 7);

	const resas = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: since },
		status: { $in: ["ouverte", "terminée"] },
		reservationTime: { $exists: true, $ne: "" },
	})
		.select("reservationDate reservationTime nbPersonnes")
		.lean();

	const matrix = {};
	for (let d = 0; d < 7; d++) matrix[d] = {};

	for (const r of resas) {
		const dow = new Date(r.reservationDate).getDay();
		const [h, m] = r.reservationTime.split(":").map(Number);
		const roundedSlot = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
		if (!matrix[dow][roundedSlot]) {
			matrix[dow][roundedSlot] = { count: 0, totalPersonnes: 0 };
		}
		matrix[dow][roundedSlot].count += 1;
		matrix[dow][roundedSlot].totalPersonnes += r.nbPersonnes || 1;
	}

	let peakDay = 0,
		peakTime = "19:00",
		maxDayVal = 0;
	let minimalDay = 0,
		minVal = Infinity;

	for (const [dow, slots] of Object.entries(matrix)) {
		const dayTotal = Object.values(slots).reduce((s, v) => s + v.count, 0);
		if (dayTotal > maxDayVal) {
			maxDayVal = dayTotal;
			peakDay = Number(dow);
		}
		if (dayTotal < minVal) {
			minVal = dayTotal;
			minimalDay = Number(dow);
		}
		for (const [time, v] of Object.entries(slots)) {
			if (v.count > (matrix[peakDay]?.[peakTime]?.count || 0)) {
				peakTime = time;
			}
		}
	}

	return {
		matrix,
		peakDay,
		peakDayName: DAY_NAMES[peakDay],
		peakTime,
		minimalDay,
		minimalDayName: DAY_NAMES[minimalDay],
		totalResas: resas.length,
		weeksAnalyzed: weeksBack,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROTECTION ANTI-TROUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Détecte les intervalles "morts" entre deux réservations sur une table :
 * trop courts pour accueillir une nouvelle résa, mais assez longs pour gaspiller un créneau.
 *
 * Algorithme :
 *  - Pour chaque table, tri des résas par heure de début
 *  - Calcul du gap entre fin[i] et début[i+1]
 *  - Si 0 < gap < turnoverTime → trou mort
 *  - Severity : critical (<30min), warning (<60min), info (sinon)
 *
 * Exemple d'usage : alerte dans l'AgendaView si T3 a un trou de 25min à 14h.
 *   → Le manager peut décaler une résa ou fermer le créneau avant de le créer.
 *
 * @param {string} restaurantId
 * @param {Date|string} date
 * @returns {Array<{ tableId, tableName, gapStart, gapEnd, gapMinutes, severity, suggestion }>}
 */
async function detectGaps(restaurantId, date) {
	const restaurant = await loadRestaurant(restaurantId);
	const duration = restaurant.turnoverTime || 120;

	const { start: dayStart, end: dayEnd } = dayBounds(date);

	const tables = await Table.find({ restaurantId })
		.select("_id number label")
		.lean();

	const resas = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: dayStart, $lte: dayEnd },
		status: { $in: ["en attente", "ouverte"] },
		tableId: { $exists: true, $ne: null },
	})
		.select("tableId reservationTime reservationDate")
		.lean();

	const gaps = [];

	for (const table of tables) {
		const tableResas = resas
			.filter((r) => r.tableId?.toString() === table._id.toString())
			.map((r) => {
				const start = parseTimeToDate(
					new Date(r.reservationDate),
					r.reservationTime,
				);
				const end = new Date(start.getTime() + duration * 60 * 1000);
				return { start, end };
			})
			.sort((a, b) => a.start - b.start);

		for (let i = 0; i < tableResas.length - 1; i++) {
			const gapStart = tableResas[i].end;
			const gapEnd = tableResas[i + 1].start;
			const gapMin = (gapEnd - gapStart) / 60000;
			if (gapMin <= 0) continue;

			if (gapMin < duration) {
				// Trou trop court pour une nouvelle résa
				const severity =
					gapMin < 30 ? "critical" : gapMin < 60 ? "warning" : "info";
				gaps.push({
					tableId: table._id.toString(),
					tableName: table.label || table.number || "?",
					gapStart: gapStart.toISOString(),
					gapEnd: gapEnd.toISOString(),
					gapMinutes: Math.round(gapMin),
					severity,
					suggestion: `${Math.round(gapMin)}min libres — trop court pour une résa (min ${duration}min). Décalez une réservation adjacente.`,
				});
			}
		}
	}

	return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DURÉE INTELLIGENTE SELON TAILLE GROUPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recommande une durée de réservation selon le nombre de convives,
 * ajustée par un calibrage historique (ticket moyen → durée réelle).
 *
 * Règles de base :
 *  ≤2p  → –15min  (couple, rotation rapide)
 *  3-4p →   0min  (standard)
 *  5-6p → +20min  (commande plus longue)
 *  7-10p → +40min  (coordination service)
 *  >10p → +60min  (événement/privatisation)
 *
 * Calibrage historique : si ticket moyen > 50€/pers → +15min supplémentaires.
 *
 * Exemple d'usage : NewReservationModal pré-sélectionne la durée selon le groupe.
 *   → Moins de double-bookings involontaires + meilleure gestion des rotations.
 *
 * @param {string} restaurantId
 * @param {number} nbPersonnes
 * @returns {{ recommendedMinutes, baseTurnover, adjustment, reason, historicSampleSize }}
 */
async function getSmartDuration(restaurantId, nbPersonnes) {
	const restaurant = await loadRestaurant(restaurantId);
	const baseTurnover = restaurant.turnoverTime || 120;

	let adjustment = 0;
	let reason = "Groupe standard";

	if (nbPersonnes <= 2) {
		adjustment = -15;
		reason = "Petit groupe, rotation rapide";
	} else if (nbPersonnes <= 4) {
		adjustment = 0;
		reason = "Groupe standard";
	} else if (nbPersonnes <= 6) {
		adjustment = +20;
		reason = "Groupe moyen, service plus long";
	} else if (nbPersonnes <= 10) {
		adjustment = +40;
		reason = "Grand groupe, logistique service";
	} else {
		adjustment = +60;
		reason = "Très grand groupe / événement";
	}

	// Calibrage sur 3 mois d'historique
	const threeMonthsAgo = new Date();
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	const historicResas = await Reservation.find({
		restaurantId,
		status: "terminée",
		nbPersonnes: {
			$gte: Math.max(1, nbPersonnes - 1),
			$lte: nbPersonnes + 1,
		},
		reservationDate: { $gte: threeMonthsAgo },
		totalAmount: { $gt: 0 },
	})
		.select("nbPersonnes totalAmount")
		.lean();

	let calibratedBonus = 0;
	if (historicResas.length >= 5) {
		const avgTicket =
			historicResas.reduce(
				(s, r) => s + r.totalAmount / Math.max(1, r.nbPersonnes),
				0,
			) / historicResas.length;
		if (avgTicket > 50) calibratedBonus = +15;
		else if (avgTicket > 30) calibratedBonus = +5;
	}

	return {
		recommendedMinutes: Math.max(
			60,
			baseTurnover + adjustment + calibratedBonus,
		),
		baseTurnover,
		adjustment: adjustment + calibratedBonus,
		reason,
		historicSampleSize: historicResas.length,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. LISTE D'ATTENTE INTELLIGENTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne les réservations "en attente" sans table, triées par score de priorité.
 *
 * Score de priorité :
 *  ancienneté (min depuis création) × 0.5 + nbPersonnes × 10
 *  → favorise les clients qui attendent depuis longtemps ET les grands groupes
 *
 * Exemple d'usage : widget "File d'attente" dans l'AgendaScreen.
 *   → Le serveur sait immédiatement qui appeler en premier quand une table se libère.
 *
 * @param {string} restaurantId
 * @param {Date|string} date
 * @returns {Array<{ reservation, priority, reason }>}
 */
async function getWaitingList(restaurantId, date) {
	const { start, end } = dayBounds(date);

	const waitingResas = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: start, $lte: end },
		status: "en attente",
		$or: [{ tableId: null }, { tableId: { $exists: false } }],
	}).lean();

	const now = Date.now();
	const scored = waitingResas.map((r) => {
		const ageMins =
			(now - new Date(r.createdAt || r.reservationDate).getTime()) / 60000;
		const priority = ageMins * 0.5 + (r.nbPersonnes || 1) * 10;
		return {
			reservation: r,
			priority,
			reason: `Attente ${Math.round(ageMins)}min — ${r.nbPersonnes || 1} pers.`,
		};
	});

	scored.sort((a, b) => b.priority - a.priority);
	return scored;
}

/**
 * Quand une table se libère, identifie la première résa en attente compatible.
 *
 * Algorithme :
 *  1. Récupère la liste d'attente triée par priorité
 *  2. Filtre les résas dont nbPersonnes ≤ capacité de la table libérée
 *  3. Retourne la meilleure candidate
 *
 * Exemple d'usage : WebSocket "table libérée" → auto-suggest au serveur.
 *   → Zéro créneau perdu, liste d'attente traitée en temps réel.
 *
 * @param {string} restaurantId
 * @param {string} freedTableId
 * @param {Date|string} date
 * @returns {{ reservation, tableId, tableName, reason } | null}
 */
async function promoteFromWaitingList(restaurantId, freedTableId, date) {
	const table = await Table.findById(freedTableId).lean();
	if (!table) return null;

	const waiting = await getWaitingList(restaurantId, date);
	if (waiting.length === 0) return null;

	const match = waiting.find(
		(w) => (w.reservation.nbPersonnes || 1) <= (table.capacity || 4),
	);
	if (!match) return null;

	return {
		reservation: match.reservation,
		tableId: freedTableId,
		tableName: table.label || table.number || "?",
		reason: match.reason,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PRÉDICTION D'AFFLUENCE HISTORIQUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prédit l'affluence d'une date cible en analysant les N semaines
 * précédentes du même jour de la semaine.
 *
 * Algorithme :
 *  - Compte les résas pour chaque semaine -1 à -N (même jour de semaine)
 *  - Moyenne pondérée : semaine récente = poids 1/1, ancienne = poids 1/N
 *  - Tendance : compare les 3 dernières semaines aux 3 précédentes
 *  - Confiance : 100 - (stdDev / mean × 100)
 *  - Créneau peak : heure la plus fréquente historiquement ce jour-là
 *
 * Exemple d'usage : en-tête de l'AgendaScreen "Vendredi chargé (≈18 résas, +12% tendance)".
 *   → Le manager prépare le staff et les stocks en avance.
 *
 * @param {string} restaurantId
 * @param {Date|string} targetDate
 * @param {number} weeksBack
 * @returns {{ predictedCount, confidence, sameWeekdayAvg, trend, peakTime, historicPoints }}
 */
async function predictAffluence(restaurantId, targetDate, weeksBack = 8) {
	const target = new Date(targetDate);
	const targetDow = target.getDay();
	const historicPoints = [];

	for (let w = 1; w <= weeksBack; w++) {
		const d = new Date(target);
		d.setDate(d.getDate() - w * 7);
		const { start, end } = dayBounds(d);

		const count = await Reservation.countDocuments({
			restaurantId,
			reservationDate: { $gte: start, $lte: end },
			status: { $in: ["en attente", "ouverte", "terminée"] },
		});
		historicPoints.push({
			week: w,
			count,
			date: d.toISOString().slice(0, 10),
		});
	}

	if (historicPoints.length === 0) {
		return { predictedCount: 0, confidence: 0, insufficient: true };
	}

	// Moyenne pondérée
	let weightedSum = 0;
	let totalWeight = 0;
	for (const p of historicPoints) {
		const weight = 1 / p.week;
		weightedSum += p.count * weight;
		totalWeight += weight;
	}
	const sameWeekdayAvg = weightedSum / totalWeight;
	const predictedCount = Math.round(sameWeekdayAvg);

	// Tendance
	const recent =
		historicPoints.slice(0, 3).reduce((s, p) => s + p.count, 0) / 3;
	const older = historicPoints.slice(3, 6).reduce((s, p) => s + p.count, 0) / 3;
	const trend =
		recent > older * 1.1
			? "hausse"
			: recent < older * 0.9
				? "baisse"
				: "stable";

	// Confiance
	const variance =
		historicPoints.reduce(
			(s, p) => s + Math.pow(p.count - sameWeekdayAvg, 2),
			0,
		) / historicPoints.length;
	const stdDev = Math.sqrt(variance);
	const confidence = Math.max(
		0,
		Math.round(100 - (stdDev / Math.max(1, sameWeekdayAvg)) * 100),
	);

	// Créneau peak prédit
	const sinceDate = new Date(target);
	sinceDate.setDate(sinceDate.getDate() - weeksBack * 7);
	const peakResas = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: sinceDate, $lte: target },
		status: { $in: ["ouverte", "terminée"] },
	})
		.select("reservationTime reservationDate")
		.lean();

	const hourCounts = {};
	for (const r of peakResas) {
		if (new Date(r.reservationDate).getDay() !== targetDow) continue;
		const [h, m] = (r.reservationTime || "20:00").split(":").map(Number);
		const slot = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
		hourCounts[slot] = (hourCounts[slot] || 0) + 1;
	}
	const peakTime =
		Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "20:00";

	return {
		predictedCount,
		confidence,
		sameWeekdayAvg: Math.round(sameWeekdayAvg * 10) / 10,
		trend,
		peakTime,
		historicPoints,
		breakdown: {
			recent: Math.round(recent),
			older: older > 0 ? Math.round(older) : null,
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. RECOMMANDATION D'HORAIRES STRATÉGIQUES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifie les créneaux chroniquement sous-exploités et recommande des actions
 * pour les valoriser (happy hour, promo, communication).
 *
 * Algorithme :
 *  1. buildHeatmap sur 6 semaines
 *  2. Pour chaque (jour × créneau) : calcule l'occupation moyenne (count / nbTables / 6)
 *  3. Si < 30% → candidat
 *  4. "high urgency" si le jour est le peakDay mais le créneau est creux (paradoxe)
 *
 * Exemple d'usage : onglet "Stratégie" → liste priorisée des actions marketing à mener.
 *   → "Vendredi 15h : 10% d'occupation sur votre jour le plus fort → Happy Hour idéal"
 *
 * @param {string} restaurantId
 * @returns {Array<{ dayOfWeek, dayName, time, avgOccupancy, recommendation, urgency }>}
 */
async function recommendStrategicSlots(restaurantId) {
	const restaurant = await loadRestaurant(restaurantId);
	if (!restaurant) return [];

	const tables = await Table.countDocuments({
		restaurantId,
		status: { $ne: "unavailable" },
	});
	if (tables === 0) return [];

	const { matrix, peakDay } = await buildHeatmap(restaurantId, 6);

	const rawSlots = generateRawSlots(
		restaurant.openingHours?.open || "12:00",
		restaurant.openingHours?.close || "22:00",
		restaurant.turnoverTime || 120,
		30,
	);

	const recommendations = [];

	for (const [dow, slots] of Object.entries(matrix)) {
		const dayTotal = Object.values(slots).reduce((s, v) => s + v.count, 0);
		if (dayTotal === 0) continue;

		for (const time of rawSlots) {
			const [h, m] = time.split(":").map(Number);
			const slot = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
			const slotData = slots[slot];
			// count total sur 6 semaines → occupation moyenne par service
			const avgCount = slotData ? slotData.count / 6 : 0;
			const occupancyRate = Math.round((avgCount / tables) * 100);

			if (occupancyRate < 30) {
				const isDayBusy = Number(dow) === peakDay;
				const urgency = isDayBusy && occupancyRate < 15 ? "high" : "medium";
				const recommendation = isDayBusy
					? `${DAY_NAMES[dow]} ${time} : seulement ${occupancyRate}% d'occupation sur votre jour fort → Happy Hour idéal`
					: `${DAY_NAMES[dow]} ${time} : créneau creux (${occupancyRate}%) → Promo ciblée ou communication`;

				recommendations.push({
					dayOfWeek: Number(dow),
					dayName: DAY_NAMES[Number(dow)],
					time,
					avgOccupancy: occupancyRate,
					recommendation,
					urgency,
				});
			}
		}
	}

	recommendations.sort((a, b) => {
		if (a.urgency !== b.urgency) return a.urgency === "high" ? -1 : 1;
		return a.avgOccupancy - b.avgOccupancy;
	});

	return recommendations.slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
	generateSmartSlots,
	suggestAlternativeSlots,
	autoAssignTable,
	buildHeatmap,
	detectGaps,
	getSmartDuration,
	getWaitingList,
	promoteFromWaitingList,
	predictAffluence,
	recommendStrategicSlots,
};
