/**
 * 🎯 Configuration des Niveaux Fonctionnels SunnyGo (Backend version)
 */

// ============ CONSTANTES ============

const LEVELS = {
	COMPLET: "complet",
	INTERMEDIAIRE: "intermediaire",
	MINIMUM: "minimum",
};

const CATEGORIES = {
	RESTAURANT: "restaurant",
	SNACK: "snack",
	FOODTRUCK: "foodtruck",
	CAFE: "cafe",
	BOULANGERIE: "boulangerie",
	BAR: "bar",
};

// ============ MAPPING CATÉGORIE → NIVEAU ============

const CATEGORY_TO_LEVEL = {
	[CATEGORIES.RESTAURANT]: LEVELS.COMPLET,
	[CATEGORIES.SNACK]: LEVELS.INTERMEDIAIRE,
	[CATEGORIES.FOODTRUCK]: LEVELS.MINIMUM,
	[CATEGORIES.CAFE]: LEVELS.INTERMEDIAIRE,
	[CATEGORIES.BOULANGERIE]: LEVELS.INTERMEDIAIRE,
	[CATEGORIES.BAR]: LEVELS.INTERMEDIAIRE,
};

// ============ FONCTIONNALITÉS SELF (CLIENT-END) ============

const SELF_FEATURES = {
	MENU_COMPLET: "menu_complet",
	MENU_SIMPLIFIE: "menu_simplifie",
	RESTRICTIONS: "restrictions",
	ALLERGIES: "allergies",
	STRIPE_PAYMENT: "stripe_payment",
	SUGGESTIONS: "suggestions",
	SUGGESTIONS_RAPIDES: "suggestions_rapides",
	WEBSOCKET_REALTIME: "websocket_realtime",
	TICKET_CAISSE: "ticket_caisse",
	TABLE_DYNAMIQUE: "table_dynamique",
	TABLE_TEMPORAIRE: "table_temporaire",
	TABLE_UNIQUE: "table_unique",
};

// ============ FONCTIONNALITÉS SERVICE (FRONTEND) ============

const SERVICE_FEATURES = {
	CAISSE_COMPLETE: "caisse_complete",
	CAISSE_SIMPLE: "caisse_simple",
	STATUT_COMMANDES: "statut_commandes",
	STATUT_COMMANDES_SIMPLIFIE: "statut_commandes_simplifie",
	PLAN_SALLE: "plan_salle",
	CHAT_CLIENT: "chat_client",
	STATISTIQUES: "statistiques",
	AUTO_TABLES: "auto_tables",
	CALENDRIER: "calendrier",
	ACTIVITE: "activite",
	RECHERCHE_GLOBALE: "recherche_globale",
	GESTION_STOCKS: "gestion_stocks",
	REGLAGES_COMPLETS: "reglages_complets",
	REGLAGES_BASIQUES: "reglages_basiques",
	RESERVATIONS: "reservations",
	ALLERGIES_VISIBLES: "allergies_visibles",
};

// ============ CONFIGURATION PAR NIVEAU - SELF ============

const SELF_LEVEL_CONFIG = {
	[LEVELS.COMPLET]: {
		label: "Complet",
		description: "Restaurant classique - Toutes les fonctionnalités",
		features: [
			SELF_FEATURES.MENU_COMPLET,
			SELF_FEATURES.RESTRICTIONS,
			SELF_FEATURES.ALLERGIES,
			SELF_FEATURES.STRIPE_PAYMENT,
			SELF_FEATURES.SUGGESTIONS,
			SELF_FEATURES.WEBSOCKET_REALTIME,
			SELF_FEATURES.TICKET_CAISSE,
			SELF_FEATURES.TABLE_DYNAMIQUE,
		],
		tableMode: "dynamic",
	},

	[LEVELS.INTERMEDIAIRE]: {
		label: "Intermédiaire",
		description: "Snack / Fast Food - Fonctionnalités adaptées",
		features: [
			SELF_FEATURES.MENU_COMPLET,
			SELF_FEATURES.RESTRICTIONS,
			SELF_FEATURES.ALLERGIES,
			SELF_FEATURES.STRIPE_PAYMENT,
			SELF_FEATURES.SUGGESTIONS,
			SELF_FEATURES.WEBSOCKET_REALTIME,
			SELF_FEATURES.TICKET_CAISSE,
			SELF_FEATURES.TABLE_TEMPORAIRE,
		],
		tableMode: "temporary",
	},

	[LEVELS.MINIMUM]: {
		label: "Minimum",
		description: "Food Truck - Essentiel uniquement",
		features: [
			SELF_FEATURES.MENU_SIMPLIFIE,
			SELF_FEATURES.STRIPE_PAYMENT,
			SELF_FEATURES.SUGGESTIONS_RAPIDES,
			SELF_FEATURES.WEBSOCKET_REALTIME,
			SELF_FEATURES.TICKET_CAISSE,
			SELF_FEATURES.TABLE_UNIQUE,
		],
		tableMode: "unique",
	},
};

// ============ CONFIGURATION PAR NIVEAU - SERVICE ============

const SERVICE_LEVEL_CONFIG = {
	[LEVELS.COMPLET]: {
		label: "Complet",
		description: "Restaurant classique - Dashboard complet",
		features: [
			SERVICE_FEATURES.CAISSE_COMPLETE,
			SERVICE_FEATURES.STATUT_COMMANDES,
			SERVICE_FEATURES.PLAN_SALLE,
			SERVICE_FEATURES.CHAT_CLIENT,
			SERVICE_FEATURES.STATISTIQUES,
			SERVICE_FEATURES.AUTO_TABLES,
			SERVICE_FEATURES.CALENDRIER,
			SERVICE_FEATURES.ACTIVITE,
			SERVICE_FEATURES.RECHERCHE_GLOBALE,
			SERVICE_FEATURES.GESTION_STOCKS,
			SERVICE_FEATURES.REGLAGES_COMPLETS,
			SERVICE_FEATURES.RESERVATIONS,
			SERVICE_FEATURES.ALLERGIES_VISIBLES,
		],
		tabs: ["activity", "floor", "reglage"],
	},

	[LEVELS.INTERMEDIAIRE]: {
		label: "Intermédiaire",
		description: "Snack / Fast Food - Dashboard simplifié",
		features: [
			SERVICE_FEATURES.CAISSE_COMPLETE,
			SERVICE_FEATURES.STATUT_COMMANDES,
			SERVICE_FEATURES.GESTION_STOCKS,
			SERVICE_FEATURES.REGLAGES_COMPLETS,
			SERVICE_FEATURES.RESERVATIONS,
			SERVICE_FEATURES.RECHERCHE_GLOBALE,
			SERVICE_FEATURES.ALLERGIES_VISIBLES,
		],
		tabs: ["floor", "reglage"],
	},

	[LEVELS.MINIMUM]: {
		label: "Minimum",
		description: "Food Truck - Essentiel uniquement",
		features: [
			SERVICE_FEATURES.CAISSE_SIMPLE,
			SERVICE_FEATURES.STATUT_COMMANDES_SIMPLIFIE,
			SERVICE_FEATURES.REGLAGES_BASIQUES,
		],
		tabs: ["floor", "reglage"],
	},
};

// ============ FONCTIONS UTILITAIRES ============

const getLevelFromCategory = (category) => {
	return CATEGORY_TO_LEVEL[category] || LEVELS.COMPLET;
};

const isSelfFeatureEnabled = (level, feature) => {
	const config = SELF_LEVEL_CONFIG[level];
	if (!config) return false;
	return config.features.includes(feature);
};

const isServiceFeatureEnabled = (level, feature) => {
	const config = SERVICE_LEVEL_CONFIG[level];
	if (!config) return false;
	return config.features.includes(feature);
};

const getTableMode = (level) => {
	const config = SELF_LEVEL_CONFIG[level];
	return config?.tableMode || "dynamic";
};

const getServiceTabs = (level) => {
	const config = SERVICE_LEVEL_CONFIG[level];
	return config?.tabs || ["activity", "floor", "reglage"];
};

const getSelfConfig = (category) => {
	const level = getLevelFromCategory(category);
	return {
		level,
		...SELF_LEVEL_CONFIG[level],
	};
};

const getServiceConfig = (category) => {
	const level = getLevelFromCategory(category);
	return {
		level,
		...SERVICE_LEVEL_CONFIG[level],
	};
};

module.exports = {
	LEVELS,
	CATEGORIES,
	CATEGORY_TO_LEVEL,
	SELF_FEATURES,
	SERVICE_FEATURES,
	SELF_LEVEL_CONFIG,
	SERVICE_LEVEL_CONFIG,
	getLevelFromCategory,
	isSelfFeatureEnabled,
	isServiceFeatureEnabled,
	getTableMode,
	getServiceTabs,
	getSelfConfig,
	getServiceConfig,
};
