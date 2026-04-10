require("dotenv").config();

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

jest.mock("../models/Payment", () => ({
	findOne: jest.fn(),
	findById: jest.fn(),
}));

jest.mock("../models/Order", () => ({
	findById: jest.fn(),
}));

jest.mock("../services/stripeService", () => ({
	cancelPaymentIntent: jest.fn(),
	confirmPaymentIntent: jest.fn(),
	confirmWithTestCard: jest.fn(),
	getPaymentIntent: jest.fn(),
	isConfigured: jest.fn(() => true),
}));

const Payment = require("../models/Payment");
const stripeService = require("../services/stripeService");
const app = require("../server");

describe("Payments tenant isolation", () => {
	it("empêche un serveur d'annuler un paiement d'un autre restaurant", async () => {
		const token = jwt.sign(
			{
				id: new mongoose.Types.ObjectId().toString(),
				role: "server",
				restaurantId: new mongoose.Types.ObjectId().toString(),
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" },
		);

		Payment.findOne.mockReturnValue({
			maxTimeMS: jest.fn().mockResolvedValue({
				restaurantId: new mongoose.Types.ObjectId(),
			}),
		});

		const res = await request(app)
			.post("/payments/cancel")
			.set("Authorization", `Bearer ${token}`)
			.send({ paymentIntentId: "pi_test_123" });

		expect(res.statusCode).toBe(403);
		expect(res.body.error).toMatch(/accès non autorisé/i);
		expect(stripeService.cancelPaymentIntent).not.toHaveBeenCalled();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	afterAll(async () => {
		await mongoose.connection.close();
	});
});