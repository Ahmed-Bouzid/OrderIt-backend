const jwt = require("jsonwebtoken");

// auth-test.js
// Middleware de test local : ne vérifie pas de token, juste pour développement

module.exports = function auth(req, res, next) {
	// ⚠️ Pour test local uniquement
	// Tu peux changer les infos ci-dessous selon le user que tu veux simuler
	req.user = {
		id: "686af52815f6b865b528f52465",
		email: "luffy@example.com",
		role: "serveur",
		userType: "serveur",
		restaurantId: "686af511bb4cba684ff3b72e",
	};

	console.log("Middleware test local : utilisateur simulé :", req.user);
	next();
};
