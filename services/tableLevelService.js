/**
 * 🪑 Service de Gestion des Tables selon le Feature Level
 *
 * Gère l'attribution des tables selon le type de restaurant :
 * - COMPLET (restaurant) : Attribution dynamique selon le QR code
 * - INTERMEDIAIRE (snack) : Table temporaire générée par client
 * - MINIMUM (foodtruck) : Table unique partagée par tous les clients
 */

const Table = require("../models/Table");
const {
	getLevelFromCategory,
	LEVELS,
} = require("../../shared-api/config/featureLevels");

/**
 * Récupère ou crée la table appropriée selon le niveau fonctionnel
 * @param {string} restaurantId - ID du restaurant
 * @param {string} category - Catégorie du restaurant (restaurant/snack/foodtruck)
 * @param {string} tableId - ID de la table demandée (peut être null pour foodtruck)
 * @returns {Promise<object>} Objet table avec { _id, number, capacity }
 */
const getOrCreateTableByLevel = async (restaurantId, category, tableId) => {
	const level = getLevelFromCategory(category);

	switch (level) {
		case LEVELS.MINIMUM: // Food Truck
			return await getUniqueSharedTable(restaurantId);

		case LEVELS.INTERMEDIAIRE: // Snack
			return await createTemporaryTable(restaurantId);

		case LEVELS.COMPLET: // Restaurant
		default:
			if (!tableId) {
				throw new Error(
					"ID de table requis pour le niveau COMPLET (restaurant classique)",
				);
			}
			return await getTableById(restaurantId, tableId);
	}
};

/**
 * Récupère la table unique partagée pour un foodtruck
 * Vérifie simplement qu'au moins une table existe
 * @param {string} restaurantId - ID du restaurant
 * @returns {Promise<object>} La première table disponible
 */
const getUniqueSharedTable = async (restaurantId) => {
	try {
		// Chercher la première table disponible
		const table = await Table.findOne({ restaurantId }).sort({ number: 1 });

		if (!table) {
			throw new Error(
				`🚫 [FOODTRUCK] Aucune table trouvée pour le restaurant ${restaurantId}. ` +
					`Veuillez créer au moins une table (ex: "Table 1") depuis l'interface Admin.`,
			);
		}

		console.log(
			`🍔 [FOODTRUCK] Table unique récupérée: ${table.number} (ID: ${table._id})`,
		);

		return {
			_id: table._id,
			number: table.number,
			capacity: table.capacity || 99, // Capacité illimitée pour foodtruck
		};
	} catch (error) {
		console.error("❌ Erreur getUniqueSharedTable:", error);
		throw error;
	}
};

/**
 * Crée une table temporaire pour un client snack
 * @param {string} restaurantId - ID du restaurant
 * @returns {Promise<object>} Table temporaire créée
 */
const createTemporaryTable = async (restaurantId) => {
	try {
		// Générer un numéro de table temporaire unique
		const tempNumber = `TEMP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

		const tempTable = new Table({
			restaurantId,
			number: tempNumber,
			capacity: 1, // Table pour un seul client
			isTemporary: true, // Marqueur pour nettoyage ultérieur
		});

		await tempTable.save();

		console.log(
			`🥤 [SNACK] Table temporaire créée: ${tempNumber} (ID: ${tempTable._id})`,
		);

		return {
			_id: tempTable._id,
			number: tempTable.number,
			capacity: tempTable.capacity,
		};
	} catch (error) {
		console.error("❌ Erreur createTemporaryTable:", error);
		throw error;
	}
};

/**
 * Récupère une table spécifique par ID (mode restaurant classique)
 * @param {string} restaurantId - ID du restaurant
 * @param {string} tableId - ID de la table
 * @returns {Promise<object>} Table demandée
 */
const getTableById = async (restaurantId, tableId) => {
	try {
		const table = await Table.findOne({ _id: tableId, restaurantId });

		if (!table) {
			throw new Error(`🚫 Table ${tableId} non trouvée`);
		}

		console.log(
			`🍽️ [RESTAURANT] Table récupérée: ${table.number} (ID: ${table._id})`,
		);

		return {
			_id: table._id,
			number: table.number,
			capacity: table.capacity,
		};
	} catch (error) {
		console.error("❌ Erreur getTableById:", error);
		throw error;
	}
};

/**
 * Nettoie les tables temporaires inactives (à appeler périodiquement)
 * @param {number} maxAgeHours - Âge maximum en heures (par défaut 24h)
 * @returns {Promise<number>} Nombre de tables supprimées
 */
const cleanupTemporaryTables = async (maxAgeHours = 24) => {
	try {
		const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

		const result = await Table.deleteMany({
			isTemporary: true,
			createdAt: { $lt: cutoffDate },
		});

		console.log(
			`🧹 [CLEANUP] ${result.deletedCount} tables temporaires supprimées`,
		);

		return result.deletedCount;
	} catch (error) {
		console.error("❌ Erreur cleanupTemporaryTables:", error);
		throw error;
	}
};

module.exports = {
	getOrCreateTableByLevel,
	getUniqueSharedTable,
	createTemporaryTable,
	getTableById,
	cleanupTemporaryTables,
};
