// tests/products.test.js
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

const app = require("../server"); // ou le chemin vers ton app Express

const restaurantId = "686af511bb4cba684ff3b72e";

beforeAll(async () => {
	await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
	await mongoose.connection.close();
});

describe("Products", () => {
	let token;

	beforeAll(async () => {
		const res = await request(app)
			.post("/servers/login")
			.send({ email: "bob@chezahmed.fr", password: "azerty123" });

		token = res.body.accessToken;
	});

	it("should return products of a restaurant", async () => {
		const res = await request(app)
			.get(`/restaurants/${restaurantId}/products`)
			.set("Authorization", `Bearer ${token}`);
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.body)).toBe(true);
	});

	it("should create a product", async () => {
		const res = await request(app)
			.post(`/restaurants/${restaurantId}/products`)
			.set("Authorization", `Bearer ${token}`)
			.send({
				name: "Pizza test",
				description: "Délicieuse",
				price: 11.5,
				category: "Pizza",
				available: true,
			});
		expect(res.statusCode).toBe(201);
		expect(res.body).toHaveProperty("product");
	});
});
