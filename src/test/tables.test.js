// tests/tables.test.js
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

const app = require("../server"); // ou le chemin vers ton app Express

beforeAll(async () => {
	await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
	await mongoose.connection.close();
});

describe("Tables", () => {
	let token;

	beforeAll(async () => {
		const res = await request(app)
			.post("/servers/login")
			.send({ email: "bob@chezahmed.fr", password: "azerty123" });
		token = res.body.accessToken;
	});

	it("should return tables of a restaurant", async () => {
		const res = await request(app)
			.get("/tables/restaurant/686af511bb4cba684ff3b72e")
			.set("Authorization", `Bearer ${token}`);
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.body)).toBe(true);
	});
});
