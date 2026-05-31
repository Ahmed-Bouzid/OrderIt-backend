const { body } = require("express-validator");

const reservationValidationRules = [
	body("tableId").optional().isMongoId().withMessage("TableId invalide"),

	body("clientName")
		.notEmpty()
		.withMessage("Nom du client obligatoire")
		.isLength({ max: 50 })
		.withMessage("Nom trop long"),

	body("reservationDate")
		.notEmpty()
		.withMessage("Date obligatoire")
		.isISO8601()
		.withMessage("Date invalide")
		.custom((value) => {
			const now = new Date();
			const inputDate = new Date(value);
			if (inputDate < now.setHours(0, 0, 0, 0)) {
				throw new Error("La date doit être aujourd'hui ou plus tard");
			}
			return true;
		}),

	body("reservationTime")
		.notEmpty()
		.withMessage("Heure obligatoire")
		.matches(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
		.withMessage("Heure invalide, format HH:MM"),

	body("nbPersonnes")
		.optional()
		.isInt({ min: 1 })
		.withMessage("Le nombre de personnes doit être >= 1"),

	body("allergies")
		.optional()
		.isString()
		.isLength({ max: 200 })
		.withMessage("Allergies trop longues"),

	body("restrictions")
		.optional()
		.isString()
		.isLength({ max: 200 })
		.withMessage("Restrictions trop longues"),

	body("notes")
		.optional()
		.isString()
		.isLength({ max: 500 })
		.withMessage("Observations trop longues"),

	body("server")
		.optional()
		.isString()
		.isLength({ max: 50 })
		.withMessage("Nom du server trop long"),

	body("orderSummary")
		.optional()
		.isArray()
		.withMessage("orderSummary doit être un tableau"),

	body("dishStatus")
		.optional()
		.isArray()
		.withMessage("dishStatus doit être un tableau"),

	body("paymentMethod")
		.optional()
		.isIn(["Espèces", "Carte", "TicketRestaurant", "Autre"])
		.withMessage("Méthode de paiement invalide"),

	body("totalAmount")
		.optional()
		.isFloat({ min: 0 })
		.withMessage("Montant total invalide"),
	body("status")
		.optional()
		.isIn(["ouverte", "terminée", "annulée", "en attente"])
		.withMessage("Statut invalide"),
];

// Règles de validation pour les mises à jour partielles (PATCH/PUT)
const reservationUpdateRules = [
	body("tableId").optional().isMongoId().withMessage("TableId invalide"),

	body("clientName")
		.optional()
		.notEmpty()
		.withMessage("Nom du client ne peut pas être vide")
		.isLength({ max: 50 })
		.withMessage("Nom trop long"),

	body("reservationDate")
		.optional()
		.isISO8601()
		.withMessage("Date invalide")
		.custom((value) => {
			const now = new Date();
			const inputDate = new Date(value);
			if (inputDate < now.setHours(0, 0, 0, 0)) {
				throw new Error("La date doit être aujourd'hui ou plus tard");
			}
			return true;
		}),

	body("reservationTime")
		.optional()
		.matches(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
		.withMessage("Heure invalide, format HH:MM"),

	body("nbPersonnes")
		.optional()
		.isInt({ min: 1 })
		.withMessage("Le nombre de personnes doit être >= 1"),

	body("allergies")
		.optional()
		.isString()
		.isLength({ max: 200 })
		.withMessage("Allergies trop longues"),

	body("restrictions")
		.optional()
		.isString()
		.isLength({ max: 200 })
		.withMessage("Restrictions trop longues"),

	body("notes")
		.optional()
		.isString()
		.isLength({ max: 500 })
		.withMessage("Observations trop longues"),

	body("server")
		.optional()
		.isString()
		.isLength({ max: 50 })
		.withMessage("Nom du server trop long"),

	body("orderSummary")
		.optional()
		.isArray()
		.withMessage("orderSummary doit être un tableau"),

	body("dishStatus")
		.optional()
		.isArray()
		.withMessage("dishStatus doit être un tableau"),

	body("paymentMethod")
		.optional()
		.isIn(["Espèces", "Carte", "TicketRestaurant", "Autre"])
		.withMessage("Méthode de paiement invalide"),

	body("totalAmount")
		.optional()
		.isFloat({ min: 0 })
		.withMessage("Montant total invalide"),

	body("status")
		.optional()
		.isIn(["ouverte", "terminée", "annulée", "en attente"])
		.withMessage("Statut invalide"),

	body("phone")
		.optional()
		.isString()
		.withMessage("Le téléphone doit être une chaîne"),
];

module.exports = { reservationValidationRules, reservationUpdateRules };
