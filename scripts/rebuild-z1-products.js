/**
 * rebuild-z1-products.js
 * 
 * Reconstruit le champ allProducts pour le Z n°1 depuis les events
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function rebuildZ1Products() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log('✅ Connecté à MongoDB');

		const ZReport = mongoose.model('ZReport');
		const ZProjectionService = require('../src/services/ZProjectionService');

		// Récupérer le Z n°1
		const z = await ZReport.findOne({
			restaurantId: '6a0381c865b4fbf2f219e0f0',
			sequenceNumber: 1,
		});

		if (!z) {
			console.log('❌ Z n°1 introuvable');
			process.exit(1);
		}

		console.log(`\n📊 Z n°${z.sequenceNumber} trouvé`);
		console.log(`   CA net: ${z.netSalesCents / 100}€`);
		console.log(`   Tickets: ${z.ticketCount}`);
		console.log(`   Shift ID: ${z.shiftId}`);

		if (!z.shiftId) {
			console.log('❌ Pas de shiftId → Z legacy, impossible de reconstruire depuis les events');
			process.exit(1);
		}

		// Reconstruire depuis les events
		console.log('\n🔄 Reconstruction depuis les events...');
		const zData = await ZProjectionService.projectShift(
			z.restaurantId,
			z.shiftId,
			z.openingFloatCents || 0
		);

		console.log(`\n✅ Events rejoués`);
		console.log(`   topProducts: ${zData.topProducts?.length || 0} produits`);
		console.log(`   allProducts: ${zData.allProducts?.length || 0} produits`);

		// Mettre à jour le Z
		z.topProducts = zData.topProducts || [];
		z.allProducts = zData.allProducts || [];
		await z.save();

		console.log('\n✅ Z n°1 mis à jour avec allProducts');
		console.log('\n📋 Liste complète des articles:');
		zData.allProducts?.forEach((p, i) => {
			console.log(`   ${i + 1}. ${p.name} × ${p.quantity} = ${(p.revenueCents / 100).toFixed(2)}€`);
		});

		process.exit(0);
	} catch (err) {
		console.error('❌ Erreur:', err);
		process.exit(1);
	}
}

rebuildZ1Products();
