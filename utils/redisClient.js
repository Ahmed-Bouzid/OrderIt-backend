// utils/redisClient.js - VERSION OPTIONNELLE
let redisClient = null;

if (process.env.REDIS_URL) {
	const redis = require("redis");
	redisClient = redis.createClient({
		url: process.env.REDIS_URL,
	});

	redisClient.on("error", (err) => console.error("Redis Client Error", err));

	(async () => {
		await redisClient.connect();
	})();
} else {
	// Mock pour éviter les erreurs
	redisClient = {
		connect: () => Promise.resolve(),
		on: () => {},
		get: () => Promise.resolve(null),
		set: () => Promise.resolve("OK"),
		quit: () => Promise.resolve(),
	};
}

module.exports = redisClient;
