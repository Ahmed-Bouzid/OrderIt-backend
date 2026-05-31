require("dotenv").config();

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ADMIN_PASSWORD = "unit-test-admin";
delete process.env.ADMIN_PASSWORD_HASH;

const request = require("supertest");
const mongoose = require("mongoose");

jest.mock("../models/Restaurant", () => ({
	find: jest.fn(() => Promise.resolve([])),
}));

jest.mock("../models/Table", () => ({
	find: jest.fn(() => Promise.resolve([])),
}));

const app = require("../server");

describe("Admin auth security", () => {
	it("refuse l'accès aux restaurants sans token admin unlock", async () => {
		const res = await request(app).get("/admin-auth/restaurants");

		expect(res.statusCode).toBe(401);
		expect(res.body.error).toMatch(/authentification admin requise/i);
	});

	it("refuse un mauvais mot de passe admin", async () => {
		const res = await request(app)
			.post("/admin-auth/verify-password")
			.send({ password: "wrong-password" });

		expect(res.statusCode).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("retourne un token temporaire avec le bon mot de passe", async () => {
		const res = await request(app)
			.post("/admin-auth/verify-password")
			.send({ password: "unit-test-admin" });

		expect(res.statusCode).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.tokenType).toBe("Bearer");
		expect(typeof res.body.token).toBe("string");
	});

	afterAll(async () => {
		await mongoose.connection.close();
	});
});