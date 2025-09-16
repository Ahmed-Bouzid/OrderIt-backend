require("dotenv").config();
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");
const mongoose = require("mongoose");

describe("Products négatifs", () => {
	let tokenAdmin;
	let tokenServeur;

	beforeAll(() => {
		tokenAdmin = jwt.sign(
			{ email: "admin@chezpapa.com", role: "admin" },
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);

		tokenServeur = jwt.sign(
			{ email: "user@chezpapa.com", role: "serveur" },
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);
	});

	it("❌ Doit retourner 401 sans token", async () => {
		const res = await request(app)
			.post("/restaurants/6866a3528244aada5105a832/products")
			.send({});
		expect(res.statusCode).toBe(401);
	});

	it("❌ Doit retourner 403 si rôle insuffisant", async () => {
		// Supposons que seuls admin et gestionnaire peuvent créer un produit
		const res = await request(app)
			.post("/restaurants/6866a3528244aada5105a832/products")
			.set("Authorization", `Bearer ${tokenServeur}`)
			.send({
				name: "Produit test",
				price: 10,
			});
		expect(res.statusCode).toBe(403);
	});

	it("❌ Doit retourner 400 si champs obligatoires manquants", async () => {
		const res = await request(app)
			.post("/restaurants/6866a3528244aada5105a832/products")
			.set("Authorization", `Bearer ${tokenAdmin}`);
		const errors = res.body.errors.map((e) => e.msg.toLowerCase());
		expect(errors).toContainEqual(expect.stringMatching(/nom/));
	});
});
