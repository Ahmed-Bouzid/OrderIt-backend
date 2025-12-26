// utils/blacklist.js - VERSION SANS REDIS
const blacklist = new Map();

module.exports = {
	add: async (token, ttlSeconds = 15 * 60) => {
		blacklist.set(token, Date.now() + ttlSeconds * 1000);

		// Auto-nettoyage
		setTimeout(() => {
			blacklist.delete(token);
		}, ttlSeconds * 1000);
	},

	has: async (token) => {
		const expiry = blacklist.get(token);
		if (!expiry) return false;

		if (Date.now() > expiry) {
			blacklist.delete(token);
			return false;
		}
		return true;
	},

	remove: async (token) => {
		blacklist.delete(token);
	},

	quit: async () => {
		// Rien à faire
	},
};
