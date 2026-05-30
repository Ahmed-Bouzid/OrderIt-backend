/**
 * Script de migration : Corriger reservationSource pour réservations existantes
 * 
 * Problème : Certaines réservations créées avant le fix n'ont pas le bon reservationSource
 * Solution : Mettre à jour toutes les réservations sans reservationDate/reservationTime planifiés
 *           pour avoir reservationSource = "Sur place"
 * 
 * Usage : node scripts/fix-reservation-source.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Reservation = require('../models/Reservation');

async function fixReservationSource() {
	try {
		// Connexion à MongoDB
		console.log('🔌 Connexion à MongoDB...');
		await mongoose.connect(process.env.MONGODB_URI);
		console.log('✅ Connecté à MongoDB\n');

		// Trouver toutes les réservations avec reservationSource undefined ou vide
		const reservationsWithoutSource = await Reservation.find({
			$or: [
				{ reservationSource: { $exists: false } },
				{ reservationSource: null },
				{ reservationSource: "" }
			]
		});

		console.log(`📊 Trouvé ${reservationsWithoutSource.length} réservations sans source\n`);

		if (reservationsWithoutSource.length === 0) {
			console.log('✅ Aucune réservation à corriger');
			process.exit(0);
		}

		// Mettre à jour chaque réservation
		let fixed = 0;
		for (const resa of reservationsWithoutSource) {
			resa.reservationSource = "Sur place";
			if (resa.isPresent === undefined || resa.isPresent === null) {
				resa.isPresent = true; // Par défaut, réservations console = clients présents
			}
			await resa.save();
			console.log(`✅ Corrigé: ${resa.clientName} (${resa._id})`);
			fixed++;
		}

		console.log(`\n🎉 ${fixed} réservations corrigées`);
		
		// Optionnel : Corriger les réservations qui ont "À distance" mais pas de date/heure planifiée
		const webReservationsWithoutDateTime = await Reservation.find({
			reservationSource: "À distance",
			$or: [
				{ reservationDate: { $exists: false } },
				{ reservationTime: { $exists: false } },
				{ reservationDate: null },
				{ reservationTime: null },
				{ reservationTime: "" }
			]
		});

		if (webReservationsWithoutDateTime.length > 0) {
			console.log(`\n⚠️  Trouvé ${webReservationsWithoutDateTime.length} réservations "À distance" sans date/heure planifiée`);
			console.log('Ces réservations devraient probablement être "Sur place" :\n');
			
			for (const resa of webReservationsWithoutDateTime) {
				console.log(`   - ${resa.clientName} (${resa._id})`);
			}
			
			console.log('\n💡 Pour les corriger automatiquement, décommentez le code ci-dessous dans le script\n');
			
			// Décommentez pour corriger automatiquement :
			// for (const resa of webReservationsWithoutDateTime) {
			// 	resa.reservationSource = "Sur place";
			// 	resa.isPresent = true;
			// 	await resa.save();
			// 	console.log(`✅ Corrigé: ${resa.clientName}`);
			// }
		}

		process.exit(0);

	} catch (error) {
		console.error('❌ Erreur:', error);
		process.exit(1);
	}
}

// Exécuter le script
fixReservationSource();
