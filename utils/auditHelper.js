/**
 * auditHelper.js - Helper pour enregistrer les actions d'audit
 */

/**
 * Crée un message d'audit formaté selon l'action
 * @param {String} action - Type d'action (table_assigned, status_changed, etc.)
 * @param {Object} data - Données contextuelles (oldValue, newValue, tableName, etc.)
 * @returns {String} Message formaté
 */
function createAuditMessage(action, data = {}) {
	const {
		oldValue,
		newValue,
		tableName,
		tableNumber,
		amount,
		orderItems,
		fieldName,
	} = data;

	switch (action) {
		case "created":
			return "Réservation créée";

		case "table_assigned":
			return `Table ${tableNumber || tableName || newValue} assignée`;

		case "table_changed":
			return `Table modifiée : ${oldValue} → ${tableNumber || newValue}`;

		case "status_changed":
			const statusLabels = {
				"en attente": "En attente",
				ouverte: "Ouverte",
				terminée: "Terminée",
				annulée: "Annulée",
			};
			return `Statut modifié : ${statusLabels[oldValue] || oldValue} → ${
				statusLabels[newValue] || newValue
			}`;

		case "payment":
			return `Paiement effectué : ${amount}€`;

		case "order_sent":
			const itemCount = orderItems?.length || 0;
			return `Commande envoyée (${itemCount} article${
				itemCount > 1 ? "s" : ""
			})`;

		case "present_changed":
			return newValue === true || newValue === "true"
				? "Client marqué présent"
				: "Client marqué absent";

		case "cancelled":
			return "Réservation annulée";

		case "field_updated":
			const fieldLabels = {
				nbPersonnes: "Nombre de personnes",
				clientName: "Nom du client",
				phone: "Téléphone",
				reservationTime: "Heure de réservation",
				allergies: "Allergies",
				restrictions: "Restrictions",
				notes: "Notes",
			};
			const label = fieldLabels[fieldName] || fieldName;
			return `${label} modifié${
				oldValue ? ` : ${oldValue} → ${newValue}` : ""
			}`;

		default:
			return `Action : ${action}`;
	}
}

/**
 * Ajoute une entrée d'audit à une réservation
 * @param {Object} reservation - Document Mongoose de la réservation
 * @param {String} action - Type d'action
 * @param {Object} user - Utilisateur qui effectue l'action { id, type, name }
 * @param {Object} data - Données contextuelles pour le message
 */
async function addAudit(reservation, action, user, data = {}) {
	if (!reservation) {
		console.warn("⚠️  Audit skipped: reservation is null");
		return;
	}

	const message = createAuditMessage(action, data);

	reservation.addAuditEntry({
		action,
		userId: user?.id || null,
		userType: user?.type || "system",
		userName: user?.name || "Système",
		message,
		metadata: data,
	});

}

module.exports = {
	createAuditMessage,
	addAudit,
};
