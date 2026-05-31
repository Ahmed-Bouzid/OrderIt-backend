require("dotenv").config();
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const mongoose = require("mongoose");

// 🔧 On mock la méthode Table.find pour qu'elle ne se connecte pas à Mongo
jest.mock("../models/Table", () => ({
	find: jest.fn(() => Promise.resolve([])), // renvoie un tableau vide rapidement
}));
const Table = require("../models/Table");

describe("Tables négatifs", () => {
	let tokenAdmin;
	let tokenserver;

	beforeAll(() => {
		tokenAdmin = jwt.sign(
			{ email: "admin@chezpapa.com", role: "admin" },
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);

		tokenserver = jwt.sign(
			{ email: "user@chezpapa.com", role: "client" }, // rôle NON autorisé
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);
	});

	it("❌ Doit retourner 401 sans token", async () => {
		const res = await request(app).get(
			"/tables/restaurant/68663954eafb319d3a42591a"
		);
		expect(res.statusCode).toBe(401);
	});

	it("❌ Doit retourner 403 si rôle insuffisant", async () => {
		const res = await request(app)
			.get("/tables/restaurant/68663954eafb319d3a42591a")
			.set("Authorization", `Bearer ${tokenserver}`);
		expect(res.statusCode).toBe(403);
	}, 10000); // tu peux laisser 10s ici
});
