require("dotenv").config();
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const mongoose = require("mongoose");

describe("Auth négatifs", () => {
	it("❌ Doit retourner 401 si pas de token", async () => {
		const res = await request(app).get("/orders");
		expect(res.statusCode).toBe(401);
		expect(res.body.message).toMatch(/token manquant/i);
	});

	it("❌ Doit retourner 401 si token mal formé", async () => {
		const res = await request(app)
			.get("/orders")
			.set("Authorization", "BadToken abcdefg");
		expect(res.statusCode).toBe(401);
		// Accepte soit "format du token invalide" soit "token manquant"
		expect(res.body.message).toMatch(
			/format du token invalide|token manquant/i
		);
	});

	it("❌ Doit retourner 401 si token invalide", async () => {
		const res = await request(app)
			.get("/orders")
			.set("Authorization", "Bearer invalid.token.here");
		expect(res.statusCode).toBe(401);
		expect(res.body.message).toMatch(/token invalide/i);
	});

	it("❌ Doit retourner 401 si token expiré", async () => {
		// Créer un token expiré à la main
		const expiredToken = jwt.sign(
			{ email: "test@chezpapa.com", role: "admin" },
			process.env.JWT_SECRET,
			{ expiresIn: "-1s" }
		);
		const res = await request(app)
			.get("/orders")
			.set("Authorization", `Bearer ${expiredToken}`);
		expect(res.statusCode).toBe(401);
		// Accepte soit "token expiré" soit "token invalide"
		expect(res.body.message).toMatch(/token expiré|token invalide/i);
	});

	afterAll(async () => {
		await mongoose.connection.close();
	});
});
