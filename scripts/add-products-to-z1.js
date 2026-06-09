/**
 * add-products-to-z1.js
 * 
 * Ajoute la liste complète des produits au Z n°1 en lisant les commandes de la période
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function addProductsToZ1() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log('Connecté à MongoDB');

		const ZReport = require('../src/models/ZReport');
		const Order = require('../src/models/Order');

		// Récupérer le Z n°1
		const z = await ZReport.findOne({
			restaurantId: '6a0381c865b4fbf2f219e0f0',
			sequenceNumber: 1,
		});

		if (!z) {
			console.log('Z n°1 introuvable');
			process.exit(1);
		}

		console.log('Z n°1 trouvé:', z.netSalesCents / 100, '€,', z.ticketCount, 'tickets');
		console.log('Période:', z.periodStart, '→', z.periodEnd);

		// Récupérer toutes les commandes de la période
		const orders = await Order.find({
			restaurantId: z.restaurantId,
			createdAt: { $gte: z.periodStart, $lte: z.periodEnd },
			status: { $ne: 'cancelled' },
		}).lean();

		console.log('Commandes trouvées:', orders.length);

		// Agréger les produits
		const productStats = {};
		
		for (const order of orders) {
			for (const item of order.items || []) {
				const name = item.name || 'Produit inconnu';
				if (!productStats[name]) {
					productStats[name] = { quantity: 0, revenueCents: 0 };
				}
				productStats[name].quantity += item.quantity || 1;
				productStats[name].revenueCents += (item.price || 0) * (item.quantity || 1) * 100;
			}
		}

		// Convertir en tableau et trier
		const allProducts = Object.entries(productStats)
			.sort(([, a], [, b]) => b.revenueCents - a.revenueCents)
			.map(([name, stats]) => ({
				name,
				quantity: stats.quantity,
				revenueCents: stats.revenueCents,
			}));

		const topProducts = allProducts.slice(0, 3);

		console.log('');
		console.log('Produits trouvés:', allProducts.length);
		console.log('');
		console.log('Top 3:');
		topProducts.forEach((p, i) => {
			console.log((i + 1) + '. ' + p.name + ' x' + p.quantity + ' = ' + (p.revenueCents / 100).toFixed(2) + ' €');
		});
		console.log('');

		// Mettre à jour le Z
		if (!z.idempotencyKey) {
			z.idempotencyKey = 'legacy_z_' + z._id.toString();
		}
		z.topProducts = topProducts;
		z.allProducts = allProducts;
		await z.save();

		console.log('Z n°1 mis à jour avec', allProducts.length, 'produits');
		console.log('');
		console.log('TOUS LES ARTICLES:');
		allProducts.forEach((p, i) => {
			console.log((i + 1) + '. ' + p.name + ' x' + p.quantity + ' = ' + (p.revenueCents / 100).toFixed(2) + ' €');
		});

		process.exit(0);
	} catch (err) {
		console.error('Erreur:', err.message);
		console.error(err.stack);
		process.exit(1);
	}
}

addProductsToZ1();
