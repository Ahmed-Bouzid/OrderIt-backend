require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server"); // chemin vers ton app Express

beforeAll(async () => {
	await mongoose.connect(process.env.MONGO_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	});
});

afterAll(async () => {
	await mongoose.connection.close();
});

describe("Orders", () => {
	let token;
	const restaurantId = "686af511bb4cba684ff3b72e";
	const tableId = "686af692bb4cba684ff3b757";
	const productId = "686af5e2bb4cba684ff3b745";

	beforeAll(async () => {
		const res = await request(app)
			.post("/servers/login") // ou "/auth/signin" selon ton backend
			.send({
				email: "bob@chezahmed.fr",
				password: "azerty123",
			});

		if (!res.body || !res.body.accessToken) {
			console.error("Réponse login :", res.body);
			throw new Error(
				"❌ Échec de connexion : aucun token reçu. Vérifie les identifiants ou la route."
			);
		}

		token = res.body.accessToken;
	});

	it("✅ Devrait créer une nouvelle commande avec succès", async () => {
		console.log("Token utilisé:", token); // Debug crucial
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.send({
				restaurantId,
				tableId,
				source: "counter",
				items: [
					{
						productId,
						name: "Sushi Saumon",
						price: 8.5,
						quantity: 2,
					},
				],
				total: 17,
			});

		console.log("💡 Réponse (commande valide) :", res.body);

		expect(res.statusCode).toBe(201);
		const order = res.body.order || res.body;
		expect(order).toMatchObject({
			restaurantId,
			tableId,
			totalAmount: 17,
		});
		expect(Array.isArray(order.items)).toBe(true);
		expect(order.items[0]).toMatchObject({
			productId,
			name: "Sushi Saumon",
			price: 8.5,
			quantity: 2,
		});
	});

	it("❌ Devrait renvoyer une erreur si tableId est manquant", async () => {
		const res = await request(app)
			.post("/orders")
			.set("Authorization", `Bearer ${token}`)
			.send({
				restaurantId,
				items: [
					{
						productId,
						name: "Sushi Saumon",
						price: 8.5,
						quantity: 1,
					},
				],
				total: 8.5,
			});

		console.log("💡 Réponse (sans tableId) :", res.body);

		expect(res.statusCode).toBe(400);
		expect(res.body).toHaveProperty("message");
		expect(res.body.message).toMatch(/tableId.*(requis|obligatoire)/i);
	});
});
