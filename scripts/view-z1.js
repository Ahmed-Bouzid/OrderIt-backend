/**
 * view-z1.js - Afficher le détail du Z de caisse n°1
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function viewZ1() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log('✅ Connecté à MongoDB\n');

		const ZReport = require('../src/models/ZReport');

		// Récupérer le Z n°1
		const z = await ZReport.findOne({
			restaurantId: '6a0381c865b4fbf2f219e0f0',
			sequenceNumber: 1,
		}).lean();

		if (!z) {
			console.log('❌ Z n°1 introuvable');
			process.exit(1);
		}

		console.log('===========================');
		console.log('Z DE CAISSE #' + z.sequenceNumber);
		console.log('===========================');
		console.log('');
		
		console.log('Periode:');
		console.log('  Du:   ' + new Date(z.periodStart).toLocaleString('fr-FR'));
		console.log('  Au:   ' + new Date(z.periodEnd).toLocaleString('fr-FR'));
		console.log('');
		
		console.log('Chiffres:');
		console.log('  CA brut:      ' + (z.grossSalesCents / 100).toFixed(2) + ' €');
		console.log('  Remises:     -' + (z.totalDiscountsCents / 100).toFixed(2) + ' €');
		console.log('  CA net:       ' + (z.netSalesCents / 100).toFixed(2) + ' €');
		console.log('  Tickets:      ' + z.ticketCount);
		console.log('  Panier moyen: ' + (z.avgBasketCents / 100).toFixed(2) + ' €');
		console.log('');

		if (z.paymentBreakdown && z.paymentBreakdown.length > 0) {
			console.log('Paiements:');
			z.paymentBreakdown.forEach(p => {
				console.log('  ' + p.method + ': ' + (p.amountCents / 100).toFixed(2) + ' €');
			});
			console.log('');
		}

		if (z.topProducts && z.topProducts.length > 0) {
			console.log('Top 3 produits:');
			z.topProducts.slice(0, 3).forEach((p, i) => {
				console.log('  ' + (i + 1) + '. ' + p.name + ' x' + p.quantity + ' = ' + (p.revenueCents / 100).toFixed(2) + ' €');
			});
			console.log('');
		}

		if (z.allProducts && z.allProducts.length > 0) {
			console.log('TOUS LES ARTICLES (' + z.allProducts.length + '):');
			console.log('-------------------------------------------');
			z.allProducts.forEach((p, i) => {
				console.log('  ' + (i + 1) + '. ' + p.name + ' x' + p.quantity + ' = ' + (p.revenueCents / 100).toFixed(2) + ' €');
			});
			console.log('');
		} else {
			console.log('allProducts absent - Ce Z a été généré avant la migration');
			console.log('');
		}

		console.log('===========================');
		console.log('');
		process.exit(0);
	} catch (err) {
		console.error('❌ Erreur:', err.message);
		process.exit(1);
	}
}

viewZ1();
