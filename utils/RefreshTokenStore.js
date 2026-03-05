const RefreshToken = require("../models/RefreshToken");

class RefreshTokenStore {
	async add(token, payload, expiresInSeconds = 7 * 24 * 3600) {
		const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
		return RefreshToken.create({
			token,
			userId: payload.id,
			userType: payload.userType === "admin" ? "Admin" : "Server",
			expiresAt,
		});
	}

	async exists(token) {
		const found = await RefreshToken.findOne({ token });
		return !!found;
	}

	async remove(token) {
		await RefreshToken.deleteOne({ token });
	}

	async deleteAllByUserId(userId) {
		await RefreshToken.deleteMany({ userId });
	}
}

module.exports = new RefreshTokenStore();
