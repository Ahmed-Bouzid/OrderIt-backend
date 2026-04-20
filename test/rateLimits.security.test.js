const express = require("express");
const request = require("supertest");
const {
	clientMessageLimiter,
	clientFeedbackLimiter,
	clientOrderModifyLimiter,
} = require("../middlewares/rateLimiter");

function createTestApp() {
	const app = express();
	app.set("trust proxy", 1);

	app.post("/client-messages/send", clientMessageLimiter, (req, res) => {
		res.status(200).json({ ok: true });
	});

	app.post("/client-feedback/submit", clientFeedbackLimiter, (req, res) => {
		res.status(200).json({ ok: true });
	});

	app.put(
		"/client-orders/:orderId/cancel",
		clientOrderModifyLimiter,
		(req, res) => {
			res.status(200).json({ ok: true, orderId: req.params.orderId });
		},
	);

	return app;
}

describe("Rate Limiting Security", () => {
	it("enforces the client message limiter after 15 requests per minute in dev/test", async () => {
		const app = createTestApp();

		for (let index = 0; index < 15; index += 1) {
			const res = await request(app)
				.post("/client-messages/send")
				.set("X-Forwarded-For", "10.10.10.1");

			expect(res.statusCode).toBe(200);
		}

		const blockedRes = await request(app)
			.post("/client-messages/send")
			.set("X-Forwarded-For", "10.10.10.1");

		expect(blockedRes.statusCode).toBe(429);
		expect(blockedRes.text).toMatch(/trop de messages/i);
	});

	it("enforces the client feedback limiter after 20 submissions per 10 minutes in dev/test", async () => {
		const app = createTestApp();

		for (let index = 0; index < 20; index += 1) {
			const res = await request(app)
				.post("/client-feedback/submit")
				.set("X-Forwarded-For", "10.10.10.2");

			expect(res.statusCode).toBe(200);
		}

		const blockedRes = await request(app)
			.post("/client-feedback/submit")
			.set("X-Forwarded-For", "10.10.10.2");

		expect(blockedRes.statusCode).toBe(429);
		expect(blockedRes.text).toMatch(/trop de feedbacks/i);
	});

	it("enforces the client order modification limiter after 30 requests per minute in dev/test", async () => {
		const app = createTestApp();

		for (let index = 0; index < 30; index += 1) {
			const res = await request(app)
				.put(`/client-orders/order-${index}/cancel`)
				.set("X-Forwarded-For", "10.10.10.3");

			expect(res.statusCode).toBe(200);
		}

		const blockedRes = await request(app)
			.put("/client-orders/order-over-limit/cancel")
			.set("X-Forwarded-For", "10.10.10.3");

		expect(blockedRes.statusCode).toBe(429);
		expect(blockedRes.text).toMatch(/modifications de commandes/i);
	});

	it("keeps independent counters per client IP", async () => {
		const app = createTestApp();

		for (let index = 0; index < 15; index += 1) {
			const res = await request(app)
				.post("/client-messages/send")
				.set("X-Forwarded-For", "10.10.10.4");

			expect(res.statusCode).toBe(200);
		}

		const blockedRes = await request(app)
			.post("/client-messages/send")
			.set("X-Forwarded-For", "10.10.10.4");
		const allowedOtherIpRes = await request(app)
			.post("/client-messages/send")
			.set("X-Forwarded-For", "10.10.10.5");

		expect(blockedRes.statusCode).toBe(429);
		expect(allowedOtherIpRes.statusCode).toBe(200);
	});
});
