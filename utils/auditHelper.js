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
		clientName,
		paymentMethod,
		dishStatus,
	} = data;

	switch (action) {
		case "created":
			return `Réservation créée${clientName ? ` pour ${clientName}` : ""}`;

		case "created_client":
			return `Réservation créée par le client${clientName ? ` (${clientName})` : ""}`;

		case "joined":
			return `${clientName || "Un client"} a rejoint la table`;

		case "table_assigned":
			return `Table ${tableNumber || tableName || newValue} assignée`;

		case "table_changed":
			return `Table modifiée : ${oldValue} → ${tableNumber || newValue}`;

		case "table_released":
			return `Table ${tableNumber || ""} libérée`;

		case "status_changed": {
			const statusLabels = {
				"en attente": "En attente",
				ouverte: "Ouverte",
				terminée: "Terminée",
				annulée: "Annulée",
			};
			return `Statut modifié : ${statusLabels[oldValue] || oldValue} → ${
				statusLabels[newValue] || newValue
			}`;
		}

		case "payment":
			return `Paiement effectué${amount ? ` : ${amount}€` : ""}${paymentMethod ? ` (${paymentMethod})` : ""}`;

		case "order_sent": {
			const itemCount = orderItems?.length || 0;
			return `Commande envoyée (${itemCount} article${
				itemCount > 1 ? "s" : ""
			})`;
		}

		case "present_changed":
			return newValue === true || newValue === "true"
				? "Client marqué présent"
				: "Client marqué absent";

		case "cancelled":
			return "Réservation annulée";

		case "closed_client":
			return "Réservation fermée par le client";

		case "deleted":
			return "Réservation supprimée";

		case "dish_status_changed":
			return `Statut préparation : ${oldValue || "?"} → ${dishStatus || newValue || "?"}`;

		case "field_updated": {
			const fieldLabels = {
				nbPersonnes: "Nombre de personnes",
				clientName: "Nom du client",
				phone: "Téléphone",
				reservationTime: "Heure de réservation",
				reservationDate: "Date de réservation",
				allergies: "Allergies",
				restrictions: "Régime alimentaire",
				notes: "Notes",
				staffNotes: "Notes staff",
				reservationSource: "Source de réservation",
				openedBy: "Ouvert par",
				serverId: "Serveur assigné",
			};
			const label = fieldLabels[fieldName] || fieldName;
			if (oldValue && newValue) {
				return `${label} modifié : ${oldValue} → ${newValue}`;
			}
			if (newValue) {
				return `${label} défini : ${newValue}`;
			}
			return `${label} modifié`;
		}

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
