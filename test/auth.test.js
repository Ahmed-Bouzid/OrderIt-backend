// tests/auth.test.js
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

const app = require("../server");

beforeAll(async () => {
	await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
	await mongoose.connection.close();
});

describe("Auth", () => {
	it("should login successfully with valid credentials", async () => {
		const res = await request(app)
			.post("/auth/login")
			.send({ email: "ahmed@chezahmed.fr", password: "azerty123" }); // ⚠️ password en clair supposé

		expect(res.statusCode).toBe(200);
		expect(res.body).toHaveProperty("accessToken");
	});

	it("should fail login with wrong password", async () => {
		const res = await request(app)
			.post("/auth/login")
			.send({ email: "contact@chezahmed.fr", password: "wrongpassword" });

		expect(res.statusCode).toBe(401); // ou 400 si c’est ton code
	});
});
