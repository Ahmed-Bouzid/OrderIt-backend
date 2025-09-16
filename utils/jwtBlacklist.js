const redis = require("redis");
const client = redis.createClient({
	url: process.env.REDIS_URL || "redis://localhost:6379",
});

client.connect().catch(console.error);

const BLACKLIST_PREFIX = "blacklist:";

module.exports = {
	add: async (token, ttlSeconds = 15 * 60) => {
		// ttl par défaut 15 min (durée access token)
		try {
			await client.set(BLACKLIST_PREFIX + token, "1", {
				EX: ttlSeconds,
			});
		} catch (err) {
			console.error("Erreur ajout blacklist:", err);
			throw err;
		}
	},

	has: async (token) => {
		try {
			const result = await client.get(BLACKLIST_PREFIX + token);
			return result === "1";
		} catch (err) {
			console.error("Erreur lecture blacklist:", err);
			throw err;
		}
	},

	remove: async (token) => {
		try {
			await client.del(BLACKLIST_PREFIX + token);
		} catch (err) {
			console.error("Erreur suppression blacklist:", err);
			throw err;
		}
	},

	quit: async () => {
		await client.quit();
	},
};
