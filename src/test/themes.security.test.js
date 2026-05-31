require("dotenv").config();

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

jest.mock("../services/themeService", () => ({
	getAvailableThemes: jest.fn(() => Promise.resolve([])),
	getTheme: jest.fn(),
	getThemeForRestaurant: jest.fn(),
	assignTheme: jest.fn(),
	customizeTheme: jest.fn(),
	getAnalytics: jest.fn(),
	recordAnalytics: jest.fn(),
}));

const themeService = require("../services/themeService");
const app = require("../server");

describe("Themes analytics security", () => {
	it("empêche un serveur d'accéder aux analytics d'un autre restaurant", async () => {
		const token = jwt.sign(
			{
				id: new mongoose.Types.ObjectId().toString(),
				role: "server",
				restaurantId: new mongoose.Types.ObjectId().toString(),
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" },
		);

		const otherRestaurantId = new mongoose.Types.ObjectId().toString();

		const res = await request(app)
			.get(`/api/themes/restaurants/${otherRestaurantId}/theme/analytics`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.statusCode).toBe(403);
		expect(res.body.error).toMatch(/access denied/i);
		expect(themeService.getAnalytics).not.toHaveBeenCalled();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	afterAll(async () => {
		await mongoose.connection.close();
	});
});