#!/usr/bin/env node
/**
 * test-event-emission.js — Test Phase 2 : Double-écriture Events
 * 
 * Scénario : Ouvrir shift → Créer ticket → Ajouter items → Fermer session (paiement)
 * Vérification : Tous les events ont été créés correctement
 */

const mongoose = require("mongoose");
require("dotenv").config();

const CashShift = require("../src/models/CashShift");
const Event = require("../src/models/Event");
const TableSession = require("../src/models/TableSession");

async function test() {
	try {
		// Connexion MongoDB
		await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE_URL, {
			serverSelectionTimeoutMS: 5000,
		});
		console.log("✅ MongoDB connecté\n");

		// Choisir un restaurant de test (remplacer par un vrai ID)
		const restaurantId = process.argv[2];
		if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
			console.error("❌ Usage: node test-event-emission.js <restaurantId>");
			process.exit(1);
		}

		console.log(`🏪 Restaurant: ${restaurantId}\n`);

		// Étape 1 : Vérifier qu'un shift est ouvert
		const activeShift = await CashShift.getActiveShift(restaurantId);
		
		if (!activeShift) {
			console.error("❌ Aucun shift actif. Ouvrir un shift via POST /cash-shifts/open d'abord");
			process.exit(1);
		}

		console.log(`✅ Shift actif trouvé: #${activeShift.sequenceNumber} (${activeShift._id})`);
		console.log(`   Ouvert le: ${activeShift.openedAt}`);
		console.log(`   Fond de caisse: ${(activeShift.openingFloatCents / 100).toFixed(2)}€\n`);

		// Étape 2 : Récupérer tous les events du shift
		const events = await Event.find({ shiftId: activeShift._id })
			.sort({ occurredAt: 1 })
			.lean();

		console.log(`📊 Total events: ${events.length}\n`);

		// Grouper par type
		const eventsByType = events.reduce((acc, event) => {
			acc[event.eventType] = (acc[event.eventType] || 0) + 1;
			return acc;
		}, {});

		console.log("📈 Ventilation par type:");
		Object.entries(eventsByType).forEach(([type, count]) => {
			console.log(`   ${type.padEnd(25)} : ${count}`);
		});

		// Étape 3 : Chercher les tickets créés (ticket_created)
		const ticketEvents = events.filter(e => e.eventType === "ticket_created");
		console.log(`\n🎟️  Tickets créés: ${ticketEvents.length}`);

		if (ticketEvents.length > 0) {
			const latestTicket = ticketEvents[ticketEvents.length - 1];
			console.log(`   Dernier ticket: ${latestTicket.ticketId}`);
			console.log(`   Table: ${latestTicket.payload.tableNumber || "N/A"}`);
			console.log(`   Couverts: ${latestTicket.payload.couverts || 0}`);

			// Vérifier si des items ont été ajoutés pour ce ticket
			const itemEvents = events.filter(
				e => e.eventType === "item_added" && e.ticketId?.toString() === latestTicket.ticketId.toString()
			);
			console.log(`   Items ajoutés: ${itemEvents.length}`);

			if (itemEvents.length > 0) {
				console.log(`   Détail items:`);
				itemEvents.slice(0, 5).forEach(item => {
					const { productName, quantity, unitPriceCents } = item.payload;
					const totalCents = quantity * unitPriceCents;
					console.log(`     - ${quantity}x ${productName} @ ${(unitPriceCents / 100).toFixed(2)}€ = ${(totalCents / 100).toFixed(2)}€`);
				});
				if (itemEvents.length > 5) {
					console.log(`     ... et ${itemEvents.length - 5} autres`);
				}
			}

			// Vérifier si un paiement a été capturé
			const paymentEvents = events.filter(
				e => e.eventType === "payment_captured" && e.ticketId?.toString() === latestTicket.ticketId.toString()
			);
			if (paymentEvents.length > 0) {
				const payment = paymentEvents[0];
				console.log(`   ✅ Paiement capturé: ${payment.payload.method} | ${(payment.payload.amountCents / 100).toFixed(2)}€`);
			} else {
				console.log(`   ⏳ Ticket non encore payé`);
			}
		}

		// Étape 4 : Vérifier la cohérence avec TableSession
		const closedSessions = await TableSession.find({
			restaurantId,
			status: "closed",
			openedAt: { $gte: activeShift.openedAt },
		}).limit(10).lean();

		console.log(`\n🔄 Sessions fermées depuis ouverture shift: ${closedSessions.length}`);
		
		const sessionsWithEvents = closedSessions.filter(s => 
			events.some(e => e.ticketId?.toString() === s._id.toString())
		);

		console.log(`   Sessions avec events: ${sessionsWithEvents.length} / ${closedSessions.length}`);
		
		if (sessionsWithEvents.length < closedSessions.length) {
			const missing = closedSessions.length - sessionsWithEvents.length;
			console.log(`   ⚠️  ${missing} session(s) fermée(s) SANS events (créée(s) avant Phase 2)`);
		}

		// Étape 5 : Vérifier l'idempotence
		const duplicates = [];
		const seen = new Set();
		events.forEach(e => {
			if (seen.has(e.idempotencyKey)) {
				duplicates.push(e.idempotencyKey);
			}
			seen.add(e.idempotencyKey);
		});

		if (duplicates.length > 0) {
			console.log(`\n❌ ERREUR : ${duplicates.length} clé(s) d'idempotence dupliquée(s) !`);
			console.log("   Clés dupliquées:", duplicates.slice(0, 3));
		} else {
			console.log(`\n✅ Idempotence : Aucun doublon détecté`);
		}

		// Conclusion
		console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
		if (events.length > 0) {
			console.log(`✅ Phase 2 fonctionnelle : ${events.length} events émis`);
			const coverage = Math.round((sessionsWithEvents.length / Math.max(1, closedSessions.length)) * 100);
			console.log(`📊 Couverture: ${coverage}% des sessions récentes ont des events`);
		} else {
			console.log(`⚠️  Aucun event émis : créer un ticket via l'interface pour tester`);
		}
		console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

	} catch (err) {
		console.error("❌ Erreur:", err.message);
		console.error(err.stack);
	} finally {
		await mongoose.disconnect();
		console.log("MongoDB déconnecté");
	}
}

test();
