const mongoose = require('mongoose');
require('dotenv').config();

async function checkZ1() {
	await mongoose.connect(process.env.MONGO_URI);
	const ZReport = require('../src/models/ZReport');
	
	const z = await ZReport.findOne({ 
		restaurantId: '6a0381c865b4fbf2f219e0f0',
		sequenceNumber: 1
	}).lean();
	
	if (!z) {
		console.log('❌ Z n°1 introuvable');
		process.exit(0);
	}
	
	console.log('=== Z DE CAISSE N°1 ===');
	console.log('CA net:', z.netSalesCents / 100, '€');
	console.log('Tickets:', z.ticketCount);
	console.log('Shift ID:', z.shiftId);
	console.log('Mode génération:', z.generationMode);
	console.log('');
	
	if (z.topProducts && z.topProducts.length > 0) {
		console.log('✅ topProducts présent:', z.topProducts.length, 'produits');
		console.log(JSON.stringify(z.topProducts, null, 2));
	} else {
		console.log('❌ topProducts absent ou vide');
	}
	
	console.log('');
	
	if (z.allProducts && z.allProducts.length > 0) {
		console.log('✅ allProducts présent:', z.allProducts.length, 'produits');
		console.log(JSON.stringify(z.allProducts, null, 2));
	} else {
		console.log('❌ allProducts absent ou vide');
		console.log('→ Il faut reconstruire ce Z depuis les events');
	}
	
	process.exit(0);
}

checkZ1().catch(err => {
	console.error('❌ Erreur:', err.message);
	process.exit(1);
});
