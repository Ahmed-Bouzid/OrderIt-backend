const { requireClientDeviceBinding } = require("../middlewares/auth");

describe("requireClientDeviceBinding", () => {
	function createRes() {
		return {
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
	}

	it("rejects client requests without x-device-id header", () => {
		const req = {
			user: { role: "client", deviceId: "device-abc-1234567890" },
			headers: {},
		};
		const res = createRes();
		const next = jest.fn();

		requireClientDeviceBinding(req, res, next);

		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(401);
		expect(res.payload.error).toBe("Device header missing");
	});

	it("rejects client requests when device header does not match token", () => {
		const req = {
			user: { role: "client", deviceId: "device-abc-1234567890" },
			headers: { "x-device-id": "device-other-1234567890" },
		};
		const res = createRes();
		const next = jest.fn();

		requireClientDeviceBinding(req, res, next);

		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(403);
		expect(res.payload.error).toBe("Device mismatch");
	});

	it("allows client requests when device header matches token", () => {
		const req = {
			user: { role: "client", deviceId: "device-abc-1234567890" },
			headers: { "x-device-id": "device-abc-1234567890" },
		};
		const res = createRes();
		const next = jest.fn();

		requireClientDeviceBinding(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBe(null);
	});

	it("bypasses enforcement for non-client roles", () => {
		const req = {
			user: { role: "admin", deviceId: null },
			headers: {},
		};
		const res = createRes();
		const next = jest.fn();

		requireClientDeviceBinding(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBe(null);
	});
});
