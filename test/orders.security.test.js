/**
 * Tests sécurité — A5: Scope token forcé sur POST /orders (client)
 * Vérifie: restaurantId + clientId override depuis token, reservationId cross-tenant bloqué
 */
require("dotenv").config();
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const restaurantA = new mongoose.Types.ObjectId();
const restaurantB = new mongoose.Types.ObjectId();
const tableA = new mongoose.Types.ObjectId();
const tableB = new mongoose.Types.ObjectId();
const clientA = "client-uuid-orders-security";
const deviceId = "device-orders-001";
const reservationId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();

const makeClientToken = (overrides = {}) =>
	jwt.sign(
		{
			id: new mongoose.Types.ObjectId().toString(),
			role: "client",
			restaurantId: restaurantA.toString(),
			tableId: tableA.toString(),
			clientId: clientA,
			deviceId,
			...overrides,
		},
		process.env.JWT_SECRET,
		{ expiresIn: "1h" },
	);

jest.mock("../models/Reservation", () => ({
	findById: jest.fn(),
}));
jest.mock("../models/Order", () => {
	const save = jest.fn().mockResolvedValue(true);
	function MockOrder(data) {
		Object.assign(this, data);
		this.save = save;
		this.toObject = jest.fn().mockReturnValue(data);
		this._id = "507f1f77bcf86cd799439011";
	}
	MockOrder.find = jest.fn().mockResolvedValue([]);
	MockOrder.findById = jest.fn();
	MockOrder.prototype.save = save;
	return MockOrder;
});
jest.mock("../models/Table", () => ({
	findById: jest.fn().mockResolvedValue({
		_id: "507f1f77bcf86cd799439012",
		number: 1,
		status: "occupied",
	}),
}));
jest.mock("../models/Product", () => ({
	findById: jest.fn().mockResolvedValue({
		_id: "507f1f77bcf86cd799439013",
		name: "Burger",
		price: 9.5,
		available: true,
	}),
}));
jest.mock("../utils/socketEmitter", () => ({
	emitOrderEvent: jest.fn(),
}));

const Reservation = require("../models/Reservation");
const app = require("../server");

afterEach(() => jest.clearAllMocks());

describe("POST /orders — scope token client (A5)", () => {
	it("401 sans token", async () => {
		const res = await request(app).post("/orders").send({
			restaurantId: restaurantA.toString(),
			tableId: tableA.toString(),
			items: [{ productId: productId.toString(), name: "Burger", price: 9.5, quantity: 1 }],
			total: 9.5,
		});
		expect(res.statusCode).toBeGreaterThanOrEqual(401);
		expect(res.statusCode).toBeLessThan(404);
	});

	it("401 client sans header x-device-id", async () => {
		const token = makeClientToken();
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.send({
				restaurantId: restaurantA.toString(),
				tableId: tableA.toString(),
				items: [{ productId: productId.toString(), name: "Burger", price: 9.5, quantity: 1 }],
				total: 9.5,
			});
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toBe("Device header missing");
	});

	it("403 si reservationId appartient à un autre restaurant", async () => {
		// La route fait Reservation.findById(id).select(...) — mock doit supporter le chaînage
		Reservation.findById.mockReturnValue({
			select: jest.fn().mockResolvedValue({ restaurantId: restaurantB, tableId: tableA }),
		});
		const token = makeClientToken();
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId)
			.send({
				reservationId: reservationId.toString(),
				items: [{ productId: productId.toString(), name: "Burger", price: 9.5, quantity: 1 }],
				total: 9.5,
			});
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisée/i);
	});

	it("403 si reservationId appartient à une autre table", async () => {
		Reservation.findById.mockReturnValue({
			select: jest.fn().mockResolvedValue({ restaurantId: restaurantA, tableId: tableB }),
		});
		const token = makeClientToken();
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId)
			.send({
				reservationId: reservationId.toString(),
				items: [{ productId: productId.toString(), name: "Burger", price: 9.5, quantity: 1 }],
				total: 9.5,
			});
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisée/i);
	});

	it("403 si rôle inconnu (role=hacker)", async () => {
		const token = jwt.sign(
			{
				id: new mongoose.Types.ObjectId().toString(),
				role: "hacker",
				restaurantId: restaurantA.toString(),
				deviceId,
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" },
		);
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId)
			.send({
				restaurantId: restaurantA.toString(),
				tableId: tableA.toString(),
				items: [{ productId: productId.toString(), name: "Burger", price: 9.5, quantity: 1 }],
				total: 9.5,
			});
		expect(res.statusCode).toBe(403);
	});
});
