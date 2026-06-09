#!/usr/bin/env node
/**
 * test-event-emission-api.js — Test Phase 2 via API REST
 * 
 * Version simplifiée qui utilise l'API publique au lieu de MongoDB direct
 * Peut être lancé depuis n'importe où avec un token valide
 */

const https = require("https");
const http = require("http");

const BASE_URL = process.env.BASE_URL || "https://orderit-backend-6y1m.onrender.com";
const TOKEN = process.env.TOKEN || process.argv[3];
const RESTAURANT_ID = process.argv[2];

if (!RESTAURANT_ID) {
	console.error("❌ Usage: node test-event-emission-api.js <restaurantId> [token]");
	console.error("   Ou: TOKEN=xyz node test-event-emission-api.js <restaurantId>");
	process.exit(1);
}

if (!TOKEN) {
	console.error("❌ Token manquant. Fournir via env TOKEN=... ou 2ème argument");
	process.exit(1);
}

function apiRequest(path, method = "GET") {
	return new Promise((resolve, reject) => {
		const url = new URL(path, BASE_URL);
		const protocol = url.protocol === "https:" ? https : http;

		const options = {
			hostname: url.hostname,
			port: url.port || (url.protocol === "https:" ? 443 : 80),
			path: url.pathname + url.search,
			method,
			headers: {
				"Authorization": `Bearer ${TOKEN}`,
				"Content-Type": "application/json",
			},
		};

		const req = protocol.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(data) });
				} catch (err) {
					resolve({ status: res.statusCode, data: data });
				}
			});
		});

		req.on("error", reject);
		req.setTimeout(10000, () => {
			req.destroy();
			reject(new Error("Timeout"));
		});

		req.end();
	});
}

async function test() {
	try {
		console.log(`🏪 Restaurant: ${RESTAURANT_ID}`);
		console.log(`🌐 Backend: ${BASE_URL}\n`);

		// Étape 1 : Récupérer shift actif
		console.log("📡 Récupération du shift actif...");
		const shiftRes = await apiRequest(`/cash-shifts/active`);

		if (shiftRes.status !== 200) {
			console.error(`❌ Erreur ${shiftRes.status}:`, shiftRes.data);
			console.log("\n💡 Ouvrir un shift d'abord avec:");
			console.log(`   curl -X POST ${BASE_URL}/cash-shifts/open \\`);
			console.log(`     -H "Authorization: Bearer $TOKEN" \\`);
			console.log(`     -H "Content-Type: application/json" \\`);
			console.log(`     -d '{"openingFloatCents": 10000}'`);
			process.exit(1);
		}

		const { shift } = shiftRes.data;

		if (!shift) {
			console.log("⚠️  Aucun shift actif pour ce restaurant");
			console.log("\n💡 Ouvrir un shift d'abord (voir commande ci-dessus)");
			process.exit(0);
		}

		console.log(`✅ Shift actif trouvé: #${shift.sequenceNumber} (${shift._id})`);
		console.log(`   Ouvert le: ${shift.openedAt}`);
		console.log(`   Fond de caisse: ${((shift.openingFloatCents || 0) / 100).toFixed(2)}€\n`);

		// Étape 2 : Récupérer détails du shift (avec events)
		console.log("📡 Récupération des events du shift...");
		const detailRes = await apiRequest(`/cash-shifts/${shift._id}`);

		if (detailRes.status !== 200) {
			console.error(`❌ Erreur ${detailRes.status}:`, detailRes.data);
			process.exit(1);
		}

		const { eventsCount, events } = detailRes.data;

		console.log(`📊 Total events: ${eventsCount || 0}\n`);

		if (!events || events.length === 0) {
			console.log("⚠️  Aucun event trouvé pour ce shift");
			console.log("\n💡 Actions à faire:");
			console.log("   1. Ouvrir l'app frontend (serveur)");
			console.log("   2. Créer 2-3 tickets (sélectionner table → ajouter produits → payer)");
			console.log("   3. Re-lancer ce script\n");
			process.exit(0);
		}

		// Grouper par type
		const eventsByType = events.reduce((acc, event) => {
			acc[event.eventType] = (acc[event.eventType] || 0) + 1;
			return acc;
		}, {});

		console.log("📈 Ventilation par type (100 premiers events):");
		Object.entries(eventsByType).forEach(([type, count]) => {
			console.log(`   ${type.padEnd(25)} : ${count}`);
		});

		// Analyser les tickets
		const ticketEvents = events.filter((e) => e.eventType === "ticket_created");
		console.log(`\n🎟️  Tickets créés: ${ticketEvents.length}`);

		if (ticketEvents.length > 0) {
			const latestTicket = ticketEvents[ticketEvents.length - 1];
			console.log(`   Dernier ticket: ${latestTicket.ticketId}`);
			console.log(`   Table: ${latestTicket.payload?.tableNumber || "N/A"}`);
			console.log(`   Couverts: ${latestTicket.payload?.couverts || 0}`);

			// Items du dernier ticket
			const itemEvents = events.filter(
				(e) =>
					e.eventType === "item_added" &&
					e.ticketId === latestTicket.ticketId
			);
			console.log(`   Items ajoutés: ${itemEvents.length}`);

			if (itemEvents.length > 0) {
				console.log(`   Détail items:`);
				itemEvents.slice(0, 5).forEach((item) => {
					const { productName, quantity, unitPriceCents } = item.payload;
					const totalCents = quantity * unitPriceCents;
					console.log(
						`     - ${quantity}x ${productName} @ ${(unitPriceCents / 100).toFixed(2)}€ = ${(totalCents / 100).toFixed(2)}€`
					);
				});
				if (itemEvents.length > 5) {
					console.log(`     ... et ${itemEvents.length - 5} autres`);
				}
			}

			// Paiement du dernier ticket
			const paymentEvents = events.filter(
				(e) =>
					e.eventType === "payment_captured" &&
					e.ticketId === latestTicket.ticketId
			);
			if (paymentEvents.length > 0) {
				const payment = paymentEvents[0];
				console.log(
					`   ✅ Paiement capturé: ${payment.payload.method} | ${(payment.payload.amountCents / 100).toFixed(2)}€`
				);
			} else {
				console.log(`   ⏳ Ticket non encore payé`);
			}
		}

		// Vérifier l'idempotence
		const seen = new Set();
		const duplicates = [];
		events.forEach((e) => {
			if (seen.has(e.idempotencyKey)) {
				duplicates.push(e.idempotencyKey);
			}
			seen.add(e.idempotencyKey);
		});

		if (duplicates.length > 0) {
			console.log(
				`\n❌ ERREUR : ${duplicates.length} clé(s) d'idempotence dupliquée(s) !`
			);
			console.log("   Clés dupliquées:", duplicates.slice(0, 3));
		} else {
			console.log(`\n✅ Idempotence : Aucun doublon détecté (sur ${events.length} events)`);
		}

		// Conclusion
		console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
		console.log(`✅ Phase 2 fonctionnelle : ${eventsCount} events émis`);
		console.log(`📊 Events affichés: ${events.length} / ${eventsCount}`);
		
		if (eventsCount > events.length) {
			console.log(`   ℹ️  (API limite à 100 events, mais tous sont en BDD)`);
		}
		
		console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

		console.log("🎯 Prochaines étapes:");
		console.log("   1. Créer plus de tickets via l'interface");
		console.log("   2. Re-lancer ce script pour vérifier couverture 100%");
		console.log("   3. Monitoring pendant 1 semaine");
		console.log("   4. Si OK → Phase 3 (bascule progressive)\n");
	} catch (err) {
		console.error("❌ Erreur:", err.message);
		if (err.code === "ENOTFOUND") {
			console.error("   → Backend non accessible, vérifier BASE_URL");
		} else if (err.message === "Timeout") {
			console.error("   → Timeout réseau, réessayer");
		}
		process.exit(1);
	}
}

test();
