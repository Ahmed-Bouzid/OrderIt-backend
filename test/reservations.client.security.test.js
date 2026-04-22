/**
 * Tests sécurité — A6: Auth POST /client/reservations
 * Vérifie: auth requise, device binding requis, restaurantId/tableId forcés depuis le token
 */
require("dotenv").config();
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const restaurantA = new mongoose.Types.ObjectId();
const tableA = new mongoose.Types.ObjectId();
const deviceId = "device-resa-001";

const makeClientToken = (overrides = {}) =>
	jwt.sign(
		{
			id: new mongoose.Types.ObjectId().toString(),
			role: "client",
			restaurantId: restaurantA.toString(),
			tableId: tableA.toString(),
			clientId: "client-uuid-resa-test",
			deviceId,
			...overrides,
		},
		process.env.JWT_SECRET,
		{ expiresIn: "1h" },
	);

// Mocks minimalistes pour éviter d'accéder à la BDD
jest.mock("../models/Reservation", () => ({
	findOne: jest.fn(),
	findById: jest.fn(),
	findOneAndUpdate: jest.fn(),
	create: jest.fn(),
	prototype: {},
}));
jest.mock("../models/Table", () => ({
	findById: jest.fn().mockResolvedValue({
		_id: "507f1f77bcf86cd799439021",
		number: 1,
		status: "occupied",
		restaurantId: "507f1f77bcf86cd799439022",
	}),
}));
jest.mock("../models/TableSession", () => ({
	findOne: jest.fn().mockResolvedValue(null),
	create: jest.fn(),
}));
jest.mock("../models/Participant", () => ({
	findOne: jest.fn().mockResolvedValue(null),
	create: jest.fn(),
}));

const app = require("../server");

afterEach(() => jest.clearAllMocks());

describe("POST /reservations/client/reservations — auth (A6)", () => {
	it("401 sans aucun token", async () => {
		const res = await request(app)
			.post("/reservations/client/reservations")
			.send({ clientName: "Jean" });
		expect(res.statusCode).toBeGreaterThanOrEqual(401);
		expect(res.statusCode).toBeLessThan(404);
	});

	it("401 si x-device-id manquant (client role)", async () => {
		const token = makeClientToken();
		const res = await request(app)
			.post("/reservations/client/reservations")
			.set("Authorization", `Bearer ${token}`)
			// pas de x-device-id
			.send({ clientName: "Jean" });
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toBe("Device header missing");
	});

	it("403 si token sans deviceId (device binding missing)", async () => {
		// Token sans deviceId → tokenDeviceId vide → "Device binding missing"
		const token = makeClientToken({ deviceId: undefined });
		const res = await request(app)
			.post("/reservations/client/reservations")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId)
			.send({ clientName: "Jean" });
		expect(res.statusCode).toBe(403);
		expect(res.body.error).toBe("Device binding missing");
	});

	it("403 si x-device-id ne correspond pas au token", async () => {
		const token = makeClientToken({ deviceId: "device-autre" });
		const res = await request(app)
			.post("/reservations/client/reservations")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId) // ne correspond pas à "device-autre"
			.send({ clientName: "Jean" });
		expect(res.statusCode).toBe(403);
		expect(res.body.error).toBe("Device mismatch");
	});

	it("400 si clientName manquant (validation)", async () => {
		const token = makeClientToken();
		const res = await request(app)
			.post("/reservations/client/reservations")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId)
			.send({}); // pas de clientName
		expect(res.statusCode).toBe(400);
	});
});
