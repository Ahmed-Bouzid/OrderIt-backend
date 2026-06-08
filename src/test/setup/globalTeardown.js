// Fermeture globale de la connexion Mongoose après tous les tests
const mongoose = require("mongoose");

module.exports = async function () {
	if (global.__mongooseRealClose) {
		await global.__mongooseRealClose();
	} else if (mongoose.connection.readyState !== 0) {
		await mongoose.connection.close();
	}
};
