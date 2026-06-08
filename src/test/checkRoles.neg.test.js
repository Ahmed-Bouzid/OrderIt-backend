require("dotenv").config();
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const mongoose = require("mongoose");

describe("checkRoles négatifs", () => {
	let tokenUser;

	beforeAll(() => {
		// Token avec rôle non autorisé "server"
		tokenUser = jwt.sign(
			{ email: "user@chezpapa.com", role: "server" },
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);
	});

	it("❌ Doit retourner 403 si rôle insuffisant", async () => {
		// Par exemple, route qui nécessite admin uniquement
		const res = await request(app)
			.post("/restaurants") // Imaginons route admin only
			.set("Authorization", `Bearer ${tokenUser}`)
			.send({ name: "Restaurant Test" });

		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/accès refusé/i);
	});
	afterAll(async () => {
		await mongoose.connection.close();
	});
});
