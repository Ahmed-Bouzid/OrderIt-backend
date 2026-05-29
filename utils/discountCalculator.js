/**
 * 💰 discountCalculator.js — Calcul des réductions à l'encaissement
 *
 * Gère les 3 types de réductions :
 * 1. item_removal — suppression d'un plat
 * 2. percentage — pourcentage de réduction (10%, 20%, etc.)
 * 3. fixed_amount — montant fixe à déduire (5€, 10€, etc.)
 *
 * Assure la traçabilité complète pour l'audit comptable.
 */

const Order = require("../models/Order");
const mongoose = require("mongoose");

/**
 * Valide une réduction avant application
 * @param {Object} discount - La réduction à valider
 * @param {Array} orders - Les commandes de la session
 * @returns {Object} { valid: Boolean, error: String }
 */
function validateDiscount(discount, orders) {
	const { type, value, reason, orderId, itemIndex } = discount;

	// Type valide
	if (!["item_removal", "percentage", "fixed_amount"].includes(type)) {
		return { valid: false, error: "Type de réduction invalide" };
	}

	// Valeur positive
	if (value < 0) {
		return { valid: false, error: "La valeur doit être positive" };
	}

	// Raison valide
	const validReasons = [
		"geste_commercial",
		"erreur_cuisine",
		"erreur_service",
		"anniversaire",
		"client_fidele",
		"compensation",
		"autre",
	];
	if (!validReasons.includes(reason)) {
		return { valid: false, error: "Raison invalide" };
	}

	// Validation spécifique par type
	switch (type) {
		case "item_removal":
			// Vérifier que orderId et itemIndex sont fournis
			if (!orderId || itemIndex === undefined) {
				return {
					valid: false,
					error: "orderId et itemIndex requis pour item_removal",
				};
			}

			// Vérifier que l'order existe
			const order = orders.find((o) => o._id.toString() === orderId);
			if (!order) {
				return { valid: false, error: "Commande non trouvée" };
			}

			// Vérifier que l'item existe
			if (!order.items || !order.items[itemIndex]) {
				return {
					valid: false,
					error: "Item non trouvé dans la commande",
				};
			}

			break;

		case "percentage":
			// Pourcentage entre 0 et 100
			if (value > 100) {
				return {
					valid: false,
					error: "Le pourcentage ne peut pas dépasser 100%",
				};
			}
			break;

		case "fixed_amount":
			// Pas de contrainte spécifique (sera plafonné au total)
			break;
	}

	return { valid: true };
}

/**
 * Calcule le montant d'une réduction
 * @param {Object} discount - La réduction
 * @param {Array} orders - Les commandes de la session
 * @param {Number} subtotal - Sous-total avant réductions
 * @returns {Object} { amountDeducted: Number, updatedOrders: Array }
 */
function calculateDiscountAmount(discount, orders, subtotal) {
	const { type, value, orderId, itemIndex } = discount;

	switch (type) {
		case "item_removal": {
			// Trouver l'order et l'item
			const order = orders.find((o) => o._id.toString() === orderId);
			if (!order || !order.items[itemIndex]) {
				return { amountDeducted: 0, updatedOrders: orders };
			}

			const item = order.items[itemIndex];
			const itemTotalPrice = item.price * item.quantity;

			// Créer une copie des orders avec l'item marqué comme removed
			const updatedOrders = orders.map((o) => {
				if (o._id.toString() === orderId) {
					const updatedItems = o.items.map((itm, idx) => {
						if (idx === itemIndex) {
							return { ...itm, removed: true };
						}
						return itm;
					});
					return { ...o, items: updatedItems };
				}
				return o;
			});

			return {
				amountDeducted: itemTotalPrice,
				updatedOrders,
			};
		}

		case "percentage": {
			// Appliquer le pourcentage sur le subtotal
			const amount = (subtotal * value) / 100;
			return {
				amountDeducted: Math.round(amount * 100) / 100, // Arrondi à 2 décimales
				updatedOrders: orders,
			};
		}

		case "fixed_amount": {
			// Montant fixe, plafonné au subtotal restant
			const amount = Math.min(value, subtotal);
			return {
				amountDeducted: amount,
				updatedOrders: orders,
			};
		}

		default:
			return { amountDeducted: 0, updatedOrders: orders };
	}
}

/**
 * Applique toutes les réductions à une session
 * @param {Array} discounts - Liste des réductions à appliquer
 * @param {Array} orders - Commandes de la session
 * @param {ObjectId} appliedBy - ID du serveur qui applique
 * @returns {Object} { pricing: Object, processedDiscounts: Array, errors: Array }
 */
async function applyDiscounts(discounts, orders, appliedBy) {
	// Calculer le sous-total initial (toutes les commandes)
	let subtotal = orders.reduce(
		(sum, order) => sum + (order.totalAmount || 0),
		0,
	);

	const processedDiscounts = [];
	const errors = [];
	let currentOrders = [...orders];
	let totalDiscounts = 0;

	// Appliquer chaque réduction dans l'ordre
	for (let i = 0; i < discounts.length; i++) {
		const discount = discounts[i];

		// Validation
		const validation = validateDiscount(discount, currentOrders);
		if (!validation.valid) {
			errors.push({
				index: i,
				error: validation.error,
				discount,
			});
			continue;
		}

		// Calculer le montant restant après les réductions précédentes
		const remainingSubtotal = subtotal - totalDiscounts;

		// Calculer cette réduction
		const { amountDeducted, updatedOrders } = calculateDiscountAmount(
			discount,
			currentOrders,
			remainingSubtotal,
		);

		// Enregistrer la réduction avec toutes ses métadonnées
		processedDiscounts.push({
			type: discount.type,
			value: discount.value,
			reason: discount.reason,
			description: discount.description || "",
			orderId: discount.orderId || null,
			itemIndex: discount.itemIndex ?? null,
			amountDeducted: Math.round(amountDeducted * 100) / 100,
			appliedBy,
			appliedAt: new Date(),
		});

		// Mettre à jour
		totalDiscounts += amountDeducted;
		currentOrders = updatedOrders;
	}

	// Calculer le montant final
	const finalAmount = Math.max(0, subtotal - totalDiscounts);

	return {
		pricing: {
			subtotal: Math.round(subtotal * 100) / 100,
			totalDiscounts: Math.round(totalDiscounts * 100) / 100,
			finalAmount: Math.round(finalAmount * 100) / 100,
		},
		processedDiscounts,
		errors,
		updatedOrders: currentOrders,
	};
}

/**
 * Génère un rapport détaillé des réductions pour l'audit
 * @param {Object} session - La session avec discounts appliqués
 * @returns {Object} Rapport détaillé
 */
function generateDiscountReport(session) {
	if (!session.discounts || session.discounts.length === 0) {
		return {
			totalDiscounts: 0,
			discountCount: 0,
			details: [],
		};
	}

	const details = session.discounts.map((d) => {
		let description = "";

		switch (d.type) {
			case "item_removal":
				description = `Plat supprimé (${d.amountDeducted.toFixed(2)}€)`;
				break;
			case "percentage":
				description = `Réduction ${d.value}% (-${d.amountDeducted.toFixed(2)}€)`;
				break;
			case "fixed_amount":
				description = `Réduction fixe -${d.amountDeducted.toFixed(2)}€`;
				break;
		}

		return {
			type: d.type,
			description,
			reason: d.reason,
			amount: d.amountDeducted,
			appliedBy: d.appliedBy,
			appliedAt: d.appliedAt,
		};
	});

	return {
		totalDiscounts: session.pricing?.totalDiscounts || 0,
		discountCount: session.discounts.length,
		details,
	};
}

module.exports = {
	validateDiscount,
	calculateDiscountAmount,
	applyDiscounts,
	generateDiscountReport,
};
