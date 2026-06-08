require("dotenv").config();
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../server");
const Product = require("../models/Product");
const Table = require("../models/Table");

describe("Orders négatifs", () => {
	let tokenAdmin;
	let tokenserver;
	let restaurantId;
	let tableId;
	let productId;

	beforeAll(async () => {
		// Connexion à Mongo (si ce n’est pas déjà fait dans server.js)
		if (mongoose.connection.readyState !== 1) {
			await mongoose.connect(process.env.MONGO_URI);
		}
		await Table.deleteMany({ number: /^test-/ });

		// ID restaurant simulé
		restaurantId = new mongoose.Types.ObjectId();

		// Création de la table et du produit pour les tests
		const table = await Table.create({ number: 10, restaurantId });
		tableId = table._id;

		const product = await Product.create({
			name: "Pizza Margherita",
			price: 12.9,
			restaurantId,
		});
		productId = product._id;

		// Création des tokens
		tokenAdmin = jwt.sign(
			{
				email: "bob@chezahmed.fr",
				role: "admin",
				id: new mongoose.Types.ObjectId(),
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);

		tokenserver = jwt.sign(
			{
				email: "bob@chezahmed.fr",
				role: "server",
				id: new mongoose.Types.ObjectId(),
			},
			process.env.JWT_SECRET,
			{ expiresIn: "1h" }
		);
	});

	it("❌ Doit retourner 401 sans token", async () => {
		const res = await request(app).post("/orders").send({});
		expect(res.statusCode).toBe(401);
	});

	it("❌ Doit retourner 403 si rôle non autorisé (exemple supp)", async () => {
		// Test d’un rôle sans accès admin
		const res = await request(app)
			.delete("/orders/686af692bb4cba684ff3b757")
			.set("Authorization", `Bearer ${tokenserver}`);
		expect(res.statusCode).toBe(403);
	});

	it("❌ Doit retourner 400 si tableId manquant", async () => {
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${tokenAdmin}`)
			.send({
				restaurantId,
				items: [
					{
						productId,
						quantity: 1,
						price: 12.9,
					},
				],
				total: 12.9,
			});
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/tableId est requis/i);
	});

	it("❌ Doit retourner 400 si quantité <= 0", async () => {
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${tokenAdmin}`)
			.send({
				restaurantId,
				tableId,
				items: [
					{
						productId,
						quantity: 0,
					},
				],
				total: 12.9,
			});
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/quantité/i);
	}, 10000);

	it("❌ Doit retourner 400 si total incohérent", async () => {
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${tokenAdmin}`)
			.send({
				restaurantId,
				tableId,
				items: [
					{
						productId,
						quantity: 1,
						price: 12.9,
					},
				],
				total: 100, // devrait être 12.9
			});
		expect(res.statusCode).toBe(400);
		expect(res.body.message).toMatch(/total/i);
	});

	afterAll(async () => {
		await Table.deleteOne({ number: 10 }).catch(() => {}); // Version courte et safe
		await mongoose.connection.close();
	});
});
