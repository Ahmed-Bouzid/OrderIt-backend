/**
 * 💰 Tests — Calcul des réductions à l'encaissement
 *
 * Tests unitaires pour discountCalculator.js
 */

const {
	validateDiscount,
	calculateDiscountAmount,
	applyDiscounts,
} = require("../utils/discountCalculator");
const mongoose = require("mongoose");

describe("Discount Calculator", () => {
	// Mock orders pour les tests
	const mockOrders = [
		{
			_id: new mongoose.Types.ObjectId("60a1234567890abcdef12345"),
			items: [
				{ name: "Burger", price: 12.5, quantity: 2 }, // 25€
				{ name: "Frites", price: 4.5, quantity: 1 }, // 4.5€
				{ name: "Coca", price: 3.0, quantity: 2 }, // 6€
			],
			totalAmount: 35.5,
		},
		{
			_id: new mongoose.Types.ObjectId("60a1234567890abcdef12346"),
			items: [
				{ name: "Salade", price: 8.0, quantity: 1 }, // 8€
				{ name: "Dessert", price: 5.5, quantity: 1 }, // 5.5€
			],
			totalAmount: 13.5,
		},
	];

	describe("validateDiscount", () => {
		test("valide une réduction pourcentage correcte", () => {
			const discount = {
				type: "percentage",
				value: 10,
				reason: "geste_commercial",
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(true);
		});

		test("rejette un pourcentage > 100", () => {
			const discount = {
				type: "percentage",
				value: 150,
				reason: "geste_commercial",
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("100%");
		});

		test("valide une réduction fixe", () => {
			const discount = {
				type: "fixed_amount",
				value: 5,
				reason: "anniversaire",
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(true);
		});

		test("rejette une valeur négative", () => {
			const discount = {
				type: "fixed_amount",
				value: -5,
				reason: "geste_commercial",
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
		});

		test("valide une suppression de plat avec orderId et itemIndex", () => {
			const discount = {
				type: "item_removal",
				value: 0,
				reason: "erreur_cuisine",
				orderId: "60a1234567890abcdef12345",
				itemIndex: 1,
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(true);
		});

		test("rejette une suppression de plat sans orderId", () => {
			const discount = {
				type: "item_removal",
				value: 0,
				reason: "erreur_cuisine",
				itemIndex: 1,
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("orderId");
		});

		test("rejette une suppression de plat avec orderId inexistant", () => {
			const discount = {
				type: "item_removal",
				value: 0,
				reason: "erreur_cuisine",
				orderId: "60a1234567890abcdef99999", // N'existe pas
				itemIndex: 0,
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("non trouvée");
		});

		test("rejette une suppression de plat avec itemIndex invalide", () => {
			const discount = {
				type: "item_removal",
				value: 0,
				reason: "erreur_cuisine",
				orderId: "60a1234567890abcdef12345",
				itemIndex: 10, // N'existe pas
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Item non trouvé");
		});

		test("rejette une raison invalide", () => {
			const discount = {
				type: "percentage",
				value: 10,
				reason: "raison_bidon",
			};

			const result = validateDiscount(discount, mockOrders);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Raison invalide");
		});
	});

	describe("calculateDiscountAmount", () => {
		test("calcule correctement un pourcentage de 10%", () => {
			const discount = {
				type: "percentage",
				value: 10,
			};
			const subtotal = 49.0; // Total des mockOrders

			const result = calculateDiscountAmount(
				discount,
				mockOrders,
				subtotal,
			);

			expect(result.amountDeducted).toBe(4.9); // 10% de 49€
		});

		test("calcule correctement une réduction fixe", () => {
			const discount = {
				type: "fixed_amount",
				value: 5,
			};
			const subtotal = 49.0;

			const result = calculateDiscountAmount(
				discount,
				mockOrders,
				subtotal,
			);

			expect(result.amountDeducted).toBe(5);
		});

		test("plafonne une réduction fixe au subtotal", () => {
			const discount = {
				type: "fixed_amount",
				value: 100,
			};
			const subtotal = 49.0;

			const result = calculateDiscountAmount(
				discount,
				mockOrders,
				subtotal,
			);

			expect(result.amountDeducted).toBe(49); // Plafonné
		});

		test("calcule correctement une suppression de plat", () => {
			const discount = {
				type: "item_removal",
				orderId: "60a1234567890abcdef12345",
				itemIndex: 0, // Burger × 2 = 25€
			};

			const result = calculateDiscountAmount(
				discount,
				mockOrders,
				49.0,
			);

			expect(result.amountDeducted).toBe(25); // 12.5 × 2
		});

		test("retourne 0 pour un item inexistant", () => {
			const discount = {
				type: "item_removal",
				orderId: "60a1234567890abcdef99999",
				itemIndex: 0,
			};

			const result = calculateDiscountAmount(
				discount,
				mockOrders,
				49.0,
			);

			expect(result.amountDeducted).toBe(0);
		});
	});

	describe("applyDiscounts", () => {
		const appliedBy = new mongoose.Types.ObjectId();

		test("applique correctement une réduction simple", async () => {
			const discounts = [
				{
					type: "percentage",
					value: 10,
					reason: "geste_commercial",
				},
			];

			const result = await applyDiscounts(
				discounts,
				mockOrders,
				appliedBy,
			);

			expect(result.pricing.subtotal).toBe(49); // 35.5 + 13.5
			expect(result.pricing.totalDiscounts).toBe(4.9); // 10%
			expect(result.pricing.finalAmount).toBe(44.1); // 49 - 4.9
			expect(result.processedDiscounts.length).toBe(1);
			expect(result.errors.length).toBe(0);
		});

		test("applique plusieurs réductions dans l'ordre", async () => {
			const discounts = [
				{
					type: "item_removal",
					value: 0,
					reason: "erreur_cuisine",
					orderId: "60a1234567890abcdef12345",
					itemIndex: 0, // Retire Burger × 2 = 25€
				},
				{
					type: "percentage",
					value: 10,
					reason: "geste_commercial", // 10% sur le restant
				},
			];

			const result = await applyDiscounts(
				discounts,
				mockOrders,
				appliedBy,
			);

			expect(result.pricing.subtotal).toBe(49); // Total initial
			expect(result.processedDiscounts.length).toBe(2);

			// Première réduction : -25€
			expect(result.processedDiscounts[0].amountDeducted).toBe(25);

			// Deuxième réduction : 10% sur (49 - 25) = 2.4€
			expect(result.processedDiscounts[1].amountDeducted).toBe(2.4);

			// Total : 49 - 25 - 2.4 = 21.6€
			expect(result.pricing.totalDiscounts).toBe(27.4);
			expect(result.pricing.finalAmount).toBe(21.6);
		});

		test("retourne des erreurs pour les réductions invalides", async () => {
			const discounts = [
				{
					type: "percentage",
					value: 150, // Invalide
					reason: "geste_commercial",
				},
				{
					type: "fixed_amount",
					value: 5,
					reason: "anniversaire",
				},
			];

			const result = await applyDiscounts(
				discounts,
				mockOrders,
				appliedBy,
			);

			expect(result.errors.length).toBe(1);
			expect(result.errors[0].index).toBe(0);
			expect(result.processedDiscounts.length).toBe(1); // Seule la 2e est appliquée
		});

		test("gère correctement le cas sans réduction", async () => {
			const result = await applyDiscounts([], mockOrders, appliedBy);

			expect(result.pricing.subtotal).toBe(49);
			expect(result.pricing.totalDiscounts).toBe(0);
			expect(result.pricing.finalAmount).toBe(49);
			expect(result.processedDiscounts.length).toBe(0);
		});

		test("ajoute les métadonnées de traçabilité", async () => {
			const discounts = [
				{
					type: "fixed_amount",
					value: 5,
					reason: "anniversaire",
					description: "Client fête ses 30 ans",
				},
			];

			const result = await applyDiscounts(
				discounts,
				mockOrders,
				appliedBy,
			);

			const processed = result.processedDiscounts[0];
			expect(processed.appliedBy).toEqual(appliedBy);
			expect(processed.appliedAt).toBeInstanceOf(Date);
			expect(processed.description).toBe("Client fête ses 30 ans");
		});
	});
});
