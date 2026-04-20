const redisClient = require("./redisClient");

const blacklist = new Map();

function getMemoryKey(type, value) {
	return `${type}:${value}`;
}

function storeInMemory(type, value, ttlSeconds) {
	const key = getMemoryKey(type, value);
	blacklist.set(key, Date.now() + ttlSeconds * 1000);

	const timeout = setTimeout(() => {
		blacklist.delete(key);
	}, ttlSeconds * 1000);

	if (typeof timeout.unref === "function") {
		timeout.unref();
	}
}

async function storeInRedis(type, value, ttlSeconds) {
	if (typeof redisClient?.setEx !== "function") {
		return false;
	}

	try {
		await redisClient.setEx(getMemoryKey(type, value), ttlSeconds, "1");
		return true;
	} catch (error) {
		console.error("Erreur stockage blacklist Redis:", error.message || error);
		return false;
	}
}

async function hasInRedis(type, value) {
	if (typeof redisClient?.exists !== "function") {
		return false;
	}

	try {
		const exists = await redisClient.exists(getMemoryKey(type, value));
		return Boolean(exists);
	} catch (error) {
		console.error("Erreur lecture blacklist Redis:", error.message || error);
		return false;
	}
}

function hasInMemory(type, value) {
	const key = getMemoryKey(type, value);
	const expiry = blacklist.get(key);
	if (!expiry) {
		return false;
	}

	if (Date.now() > expiry) {
		blacklist.delete(key);
		return false;
	}

	return true;
}

async function removeFromRedis(type, value) {
	if (typeof redisClient?.del !== "function") {
		return;
	}

	try {
		await redisClient.del(getMemoryKey(type, value));
	} catch (error) {
		console.error("Erreur suppression blacklist Redis:", error.message || error);
	}
}

async function addEntry(type, value, ttlSeconds = 15 * 60) {
	if (!value || ttlSeconds <= 0) {
		return;
	}

	const normalizedTtl = Math.max(1, Math.floor(ttlSeconds));
	storeInMemory(type, value, normalizedTtl);
	await storeInRedis(type, value, normalizedTtl);
}

async function hasEntry(type, value) {
	if (!value) {
		return false;
	}

	if (await hasInRedis(type, value)) {
		return true;
	}

	return hasInMemory(type, value);
}

async function removeEntry(type, value) {
	if (!value) {
		return;
	}

	blacklist.delete(getMemoryKey(type, value));
	await removeFromRedis(type, value);
}

module.exports = {
	add: async (token, ttlSeconds = 15 * 60) => addEntry("token", token, ttlSeconds),
	has: async (token) => hasEntry("token", token),
	remove: async (token) => removeEntry("token", token),
	addJti: async (jti, ttlSeconds = 15 * 60) => addEntry("jti", jti, ttlSeconds),
	hasJti: async (jti) => hasEntry("jti", jti),
	removeJti: async (jti) => removeEntry("jti", jti),
	quit: async () => {
		if (typeof redisClient?.quit === "function") {
			await redisClient.quit();
		}
	},
};
