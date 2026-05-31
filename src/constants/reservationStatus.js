/**
 * CONSTANTES STATUTS RÉSERVATION — SOURCE DE VÉRITÉ UNIQUE
 * 
 * ⚠️ RÈGLE ABSOLUE : Toujours utiliser ces constantes, JAMAIS de strings hardcodées
 * 
 * ✅ CORRECT : 
 *   reservation.status = RESERVATION_STATUS.COMPLETED
 *   if (status === RESERVATION_STATUS.PENDING)
 *   
 * ❌ INTERDIT :
 *   reservation.status = "terminée"
 *   if (status === "ouverte")
 * 
 * Migration française → anglaise (31 mai 2026) :
 *   - "en attente" → "pending"
 *   - "ouverte"    → "confirmed"  
 *   - "terminée"   → "completed"
 *   - "annulée"    → "cancelled"
 *   - "no_show"    → "no_show" (inchangé)
 */

const RESERVATION_STATUS = {
	// ⏳ En attente de confirmation/arrivée client
	PENDING: "pending",

	// ✅ Client arrivé, service en cours
	CONFIRMED: "confirmed",

	// 🏁 Service terminé, paiement effectué
	COMPLETED: "completed",

	// ❌ Annulée (par restaurant ou client)
	CANCELLED: "cancelled",

	// 👻 Client ne s'est pas présenté
	NO_SHOW: "no_show",
};

/**
 * Liste des statuts valides (pour validation Mongoose)
 */
const VALID_RESERVATION_STATUSES = Object.values(RESERVATION_STATUS);

/**
 * Mapping français → anglais (rétro-compatibilité temporaire)
 * @deprecated À supprimer après migration BDD complète
 */
const LEGACY_STATUS_MAP = {
	"en attente": RESERVATION_STATUS.PENDING,
	ouverte: RESERVATION_STATUS.CONFIRMED,
	terminée: RESERVATION_STATUS.COMPLETED,
	annulée: RESERVATION_STATUS.CANCELLED,
	// Anglais pass-through (si déjà standardisé)
	pending: RESERVATION_STATUS.PENDING,
	confirmed: RESERVATION_STATUS.CONFIRMED,
	completed: RESERVATION_STATUS.COMPLETED,
	cancelled: RESERVATION_STATUS.CANCELLED,
	no_show: RESERVATION_STATUS.NO_SHOW,
};

/**
 * Normalise un statut (accepte français OU anglais, retourne toujours anglais)
 * @param {string} status - Statut à normaliser
 * @returns {string} Statut en anglais
 * @deprecated À supprimer après migration BDD complète
 */
function normalizeStatus(status) {
	return LEGACY_STATUS_MAP[status] || status;
}

/**
 * Vérifie si un statut est valide
 * @param {string} status - Statut à vérifier
 * @returns {boolean}
 */
function isValidStatus(status) {
	return VALID_RESERVATION_STATUSES.includes(status);
}

/**
 * Statuts terminaux (ne peuvent plus être modifiés)
 */
const TERMINAL_STATUSES = [
	RESERVATION_STATUS.COMPLETED,
	RESERVATION_STATUS.CANCELLED,
	RESERVATION_STATUS.NO_SHOW,
];

/**
 * Vérifie si un statut est terminal
 * @param {string} status - Statut à vérifier
 * @returns {boolean}
 */
function isTerminalStatus(status) {
	return TERMINAL_STATUSES.includes(status);
}

/**
 * Statuts actifs (service en cours)
 */
const ACTIVE_STATUSES = [
	RESERVATION_STATUS.PENDING,
	RESERVATION_STATUS.CONFIRMED,
];

/**
 * Vérifie si un statut est actif
 * @param {string} status - Statut à vérifier
 * @returns {boolean}
 */
function isActiveStatus(status) {
	return ACTIVE_STATUSES.includes(status);
}

module.exports = {
	RESERVATION_STATUS,
	VALID_RESERVATION_STATUSES,
	LEGACY_STATUS_MAP,
	normalizeStatus,
	isValidStatus,
	TERMINAL_STATUSES,
	isTerminalStatus,
	ACTIVE_STATUSES,
	isActiveStatus,
};
