/**
 * Tests sécurité — A4: Auth clientOrders mutateurs
 * Routes: PUT /client-orders/:id/cancel + PUT /client-orders/:id/counter-payment
 * Vérifie: auth requise, device binding, ownership (restaurant/table/client)
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
const clientA = "client-uuid-aaaa";
const clientB = "client-uuid-bbbb";
const deviceId = "device-test-001";
const orderId = new mongoose.Types.ObjectId();

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

jest.mock("../models/Order", () => ({
	findById: jest.fn(),
}));
jest.mock("../utils/socketEmitter", () => ({
	emitOrderEvent: jest.fn(),
}));
jest.mock("../utils/cancelOpenStripePayments", () => ({
	cancelOpenStripePaymentsForOrder: jest.fn().mockResolvedValue({ errors: [] }),
}));

const Order = require("../models/Order");
const app = require("../server");

const mockOrder = (overrides = {}) => ({
	_id: orderId,
	restaurantId: restaurantA,
	tableId: tableA,
	clientId: clientA,
	paid: false,
	orderStatus: "in_progress",
	paymentMethod: null,
	save: jest.fn().mockResolvedValue(true),
	toObject: jest.fn().mockReturnValue({}),
	...overrides,
});

afterEach(() => jest.clearAllMocks());

// ──────────────────────────────────────────────────────
// PUT /client-orders/:id/cancel
// ──────────────────────────────────────────────────────
describe("PUT /client-orders/:id/cancel — auth & ownership", () => {
	it("401 sans token", async () => {
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`);
		expect(res.statusCode).toBeGreaterThanOrEqual(401);
		expect(res.statusCode).toBeLessThan(404);
	});

	it("401 sans header x-device-id", async () => {
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`);
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toBe("Device header missing");
	});

	it("403 si order appartient à un autre restaurant", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ restaurantId: restaurantB }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisé/i);
	});

	it("403 si order appartient à une autre table", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ tableId: tableB }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisé/i);
	});

	it("403 si clientId ne correspond pas", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ clientId: clientB }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisé/i);
	});

	it("400 si commande déjà payée", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ paid: true }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/déjà payée/i);
	});

	it("400 si commande déjà annulée", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ orderStatus: "cancelled" }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/déjà annulée/i);
	});

	it("200 si tout est valide", async () => {
		const order = mockOrder();
		Order.findById.mockResolvedValue(order);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/cancel`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(200);
		expect(order.orderStatus).toBe("cancelled");
		expect(order.save).toHaveBeenCalledTimes(1);
	});
});

// ──────────────────────────────────────────────────────
// PUT /client-orders/:id/counter-payment
// ──────────────────────────────────────────────────────
describe("PUT /client-orders/:id/counter-payment — auth & ownership", () => {
	it("401 sans token", async () => {
		const res = await request(app)
			.put(`/client-orders/${orderId}/counter-payment`);
		expect(res.statusCode).toBeGreaterThanOrEqual(401);
		expect(res.statusCode).toBeLessThan(404);
	});

	it("401 sans header x-device-id", async () => {
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/counter-payment`)
			.set("Authorization", `Bearer ${token}`);
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toBe("Device header missing");
	});

	it("403 si order appartient à un autre client", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ clientId: clientB }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/counter-payment`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(403);
		expect(res.body.message).toMatch(/non autorisé/i);
	});

	it("400 si commande déjà payée", async () => {
		Order.findById.mockResolvedValue(
			mockOrder({ paid: true }),
		);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/counter-payment`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/déjà payée/i);
	});

	it("200 si tout est valide — paymentMethod = cash", async () => {
		const order = mockOrder();
		Order.findById.mockResolvedValue(order);
		const token = makeClientToken();
		const res = await request(app)
			.put(`/client-orders/${orderId}/counter-payment`)
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", deviceId);
		expect(res.statusCode).toBe(200);
		expect(order.paymentMethod).toBe("cash");
		expect(order.save).toHaveBeenCalledTimes(1);
	});
});
