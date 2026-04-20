process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

jest.mock("../utils/jwtBlacklist", () => ({
	add: jest.fn().mockResolvedValue(),
	addJti: jest.fn().mockResolvedValue(),
	has: jest.fn().mockResolvedValue(false),
	hasJti: jest.fn().mockResolvedValue(false),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const generateClientToken = require("../utils/generateClientToken");
const auth = require("../middlewares/auth");
const clientTokenRouter = require("../routes/clientToken");
const jwtBlacklist = require("../utils/jwtBlacklist");

describe("Client token revocation security", () => {
	it("adds a unique jti when generating a client token", () => {
		const token = generateClientToken({
			clientId: "client-123",
			restaurantId: "restaurant-123",
			tableId: "table-123",
			deviceId: "device-abcdefghijklmnopqrstuvwxyz",
			expiresIn: 3600,
		});

		const decoded = jwt.verify(token, process.env.JWT_SECRET);

		expect(typeof decoded.jti).toBe("string");
		expect(decoded.jti.length).toBeGreaterThan(10);
		expect(decoded.deviceId).toBe("device-abcdefghijklmnopqrstuvwxyz");
	});

	it("rejects a request when the client jti is revoked", async () => {
		jwtBlacklist.has.mockResolvedValue(false);
		jwtBlacklist.hasJti.mockResolvedValue(true);

		const token = jwt.sign(
			{
				id: "client-123",
				clientId: "client-123",
				role: "client",
				userType: "client",
				restaurantId: "restaurant-123",
				tableId: "table-123",
				deviceId: "device-abcdefghijklmnopqrstuvwxyz",
				jti: "jti-revoked-123",
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" },
		);

		const req = {
			headers: {
				authorization: `Bearer ${token}`,
			},
		};
		const res = {
			statusCode: null,
			payload: null,
			status(code) {
				this.statusCode = code;
				return this;
			},
			json(payload) {
				this.payload = payload;
				return this;
			},
		};
		const next = jest.fn();

		await auth(req, res, next);

		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(403);
		expect(res.payload.message).toMatch(/révoqué/i);
	});

	it("revokes the current client token through POST /client/token/revoke", async () => {
		jwtBlacklist.has.mockResolvedValue(false);
		jwtBlacklist.hasJti.mockResolvedValue(false);

		const token = jwt.sign(
			{
				id: "client-123",
				clientId: "client-123",
				role: "client",
				userType: "client",
				restaurantId: "restaurant-123",
				tableId: "table-123",
				deviceId: "device-abcdefghijklmnopqrstuvwxyz",
				jti: "jti-active-123",
			},
			process.env.JWT_SECRET,
			{ expiresIn: "2h" },
		);

		const app = express();
		app.use(express.json());
		app.use("/client/token", clientTokenRouter);

		const response = await request(app)
			.post("/client/token/revoke")
			.set("Authorization", `Bearer ${token}`)
			.set("x-device-id", "device-abcdefghijklmnopqrstuvwxyz")
			.send({});

		expect(response.statusCode).toBe(200);
		expect(jwtBlacklist.addJti).toHaveBeenCalledWith(
			"jti-active-123",
			expect.any(Number),
		);
		expect(jwtBlacklist.add).toHaveBeenCalledWith(token, expect.any(Number));
	});

	afterEach(() => {
		jest.clearAllMocks();
	});
});