/**
 * migrate-legacy-to-events.js — Phase 5 Migration
 * 
 * Reconstruit les events depuis les TableSessions/Orders historiques.
 * Permet d'avoir un event log complet pour analyses avancées sur l'historique.
 * 
 * Usage :
 *   # Migrer une journée spécifique
 *   node scripts/migrate-legacy-to-events.js 2026-06-01 <restaurantId>
 * 
 *   # Migrer les N derniers jours
 *   node scripts/migrate-legacy-to-events.js --last-n-days 30 <restaurantId>
 * 
 * Options :
 *   --dry-run          : Simule sans écrire en base
 *   --skip-existing    : Ignore les journées déjà migrées (shift existant)
 * 
 * Sécurité :
 *   - Crée UNIQUEMENT de nouveaux events (pas de modification de l'existant)
 *   - Events marqués isLocked: true (immutables)
 *   - Idempotency keys uniques (migration_*)
 *   - Génère des shifts "closed" rétrospectivement
 */

require("dotenv").config();
const mongoose = require("mongoose");
const TableSession = require("../src/models/TableSession");
const Order = require("../src/models/Order");
const Event = require("../src/models/Event");
const CashShift = require("../src/models/CashShift");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(dateStr) {
	const date = new Date(dateStr);
	if (isNaN(date)) throw new Error(`Date invalide: ${dateStr}`);
	return date;
}

function getDayBounds(date) {
	const start = new Date(date);
	start.setHours(0, 0, 0, 0);
	const end = new Date(date);
	end.setHours(23, 59, 59, 999);
	return { start, end };
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration d'une journée
// ─────────────────────────────────────────────────────────────────────────────

async function migrateDay(date, restaurantId, options = {}) {
	const { dryRun = false, skipExisting = false } = options;
	const { start, end } = getDayBounds(date);

	console.log(`\n📅 Migration ${date.toISOString().split("T")[0]} pour restaurant ${restaurantId}`);
	console.log(`   Période : ${start.toISOString()} → ${end.toISOString()}`);

	// Vérifier si un shift existe déjà pour ce jour
	const existingShift = await CashShift.findOne({
		restaurantId,
		openedAt: { $gte: start, $lte: end },
	});

	if (existingShift && skipExisting) {
		console.log(`   ⏭️  Shift #${existingShift.sequenceNumber} déjà existant, ignoré (--skip-existing)`);
		return { skipped: true };
	}

	// Charger les sessions fermées de la journée
	const sessions = await TableSession.find({
		restaurantId,
		billStatus: "closed",
		closedAt: { $gte: start, $lte: end },
	})
		.sort({ openedAt: 1 })
		.lean();

	if (sessions.length === 0) {
		console.log(`   ℹ️  Aucune session fermée trouvée pour ce jour`);
		return { sessionsCount: 0, eventsCount: 0 };
	}

	console.log(`   ✅ ${sessions.length} sessions fermées trouvées`);

	// Créer un shift rétrospectif
	const firstSession = sessions[0];
	const lastSession = sessions[sessions.length - 1];

	// Numéro séquentiel (timestamp pour éviter conflits)
	const sequenceNumber = Math.floor(start.getTime() / 1000);

	let shift;
	if (!dryRun) {
		shift = await CashShift.create({
			restaurantId,
			sequenceNumber,
			status: "closed",
			openedAt: firstSession.openedAt || start,
			closedAt: lastSession.closedAt || end,
			openedBy: firstSession.openedBy || null,
			closedBy: lastSession.closedBy || null,
			openingFloatCents: 0, // Inconnu en migration
			closingCountCents: 0,
		});
		console.log(`   ✅ Shift #${shift.sequenceNumber} créé (rétrospectif)`);
	} else {
		console.log(`   🔄 [DRY-RUN] Shift #${sequenceNumber} serait créé`);
	}

	const shiftId = shift?._id || new mongoose.Types.ObjectId();
	let eventsCreated = 0;

	// Migrer chaque session
	for (const session of sessions) {
		// Event : ticket_created
		const ticketKey = `migration_ticket_${session._id}`;
		if (!dryRun) {
			await Event.createIdempotent({
				eventType: "ticket_created",
				idempotencyKey: ticketKey,
				restaurantId,
				shiftId,
				ticketId: session._id,
				payload: {
					tableId: session.tableId,
					tableNumber: session.tableId?.number || null,
					couverts: session.couverts || 0,
				},
				occurredAt: session.openedAt || start,
				actorId: session.openedBy || null,
				actorType: "server",
				isLocked: true,
			});
		}
		eventsCreated++;

		// Charger les commandes de la session
		const orders = await Order.find({ sessionId: session._id })
			.sort({ createdAt: 1 })
			.lean();

		for (const order of orders) {
			// Ignorer les commandes annulées au niveau order
			if (order.orderStatus === "cancelled") continue;

			for (const item of order.items || []) {
				// Event : item_added (même si annulé après, on garde l'historique)
				const itemKey = `migration_item_${order._id}_${item._id}`;
				const itemCents = Math.round((item.price || 0) * 100);

				if (!dryRun) {
					await Event.createIdempotent({
						eventType: "item_added",
						idempotencyKey: itemKey,
						restaurantId,
						shiftId,
						ticketId: session._id,
						orderId: order._id,
						payload: {
							productId: item.productId,
							productName: item.name || "Produit inconnu",
							quantity: item.quantity || 1,
							unitPriceCents: itemCents,
							totalCents: itemCents * (item.quantity || 1),
						},
						occurredAt: order.createdAt || session.openedAt,
						actorId: order.serverId || session.openedBy,
						actorType: "server",
						isLocked: true,
					});
				}
				eventsCreated++;

				// Si item annulé, créer un event item_voided
				if (item.itemStatus === "cancelled") {
					const voidKey = `migration_item_void_${order._id}_${item._id}`;
					if (!dryRun) {
						await Event.createIdempotent({
							eventType: "item_voided",
							idempotencyKey: voidKey,
							restaurantId,
							shiftId,
							ticketId: session._id,
							orderId: order._id,
							payload: {
								productId: item.productId,
								quantity: item.quantity || 1,
								reason: "Migration historique (item cancelled)",
							},
							occurredAt: order.updatedAt || order.createdAt,
							actorId: order.serverId,
							actorType: "server",
							isLocked: true,
						});
					}
					eventsCreated++;
				}
			}
		}

		// Event : payment_captured
		const paymentKey = `migration_payment_${session._id}`;
		const method = session.paymentMethod === "card_offline" ? "card" : (session.paymentMethod || "cash");
		const amountCents = Math.round((session.totalAmount || 0) * 100);

		if (!dryRun) {
			await Event.createIdempotent({
				eventType: "payment_captured",
				idempotencyKey: paymentKey,
				restaurantId,
				shiftId,
				ticketId: session._id,
				payload: {
					method,
					amountCents,
					paymentId: `migration_${session._id}`,
				},
				occurredAt: session.closedAt || end,
				actorId: session.closedBy || session.openedBy,
				actorType: "server",
				isLocked: true,
			});
		}
		eventsCreated++;
	}

	console.log(`   ✅ ${eventsCreated} events créés (locked)`);

	return {
		sessionsCount: sessions.length,
		eventsCount: eventsCreated,
		shiftId: shift?._id,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	try {
		console.log("═".repeat(60));
		console.log("  MIGRATION HISTORIQUE → EVENTS (Phase 5)");
		console.log("═".repeat(60));
		console.log("");

		// Parse arguments
		const args = process.argv.slice(2);
		const options = {
			dryRun: args.includes("--dry-run"),
			skipExisting: args.includes("--skip-existing"),
		};

		let dates = [];
		let restaurantId;

		if (args.includes("--last-n-days")) {
			const idx = args.indexOf("--last-n-days");
			const n = parseInt(args[idx + 1], 10);
			if (isNaN(n)) throw new Error("--last-n-days requiert un nombre");

			restaurantId = args[args.length - 1];
			if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
				throw new Error("restaurantId invalide");
			}

			// Générer les N derniers jours
			for (let i = 0; i < n; i++) {
				const d = new Date();
				d.setDate(d.getDate() - i);
				dates.push(d);
			}
		} else {
			// Mode journée unique
			if (args.length < 2) {
				console.error("Usage :");
				console.error("  node scripts/migrate-legacy-to-events.js 2026-06-01 <restaurantId>");
				console.error("  node scripts/migrate-legacy-to-events.js --last-n-days 30 <restaurantId>");
				console.error("");
				console.error("Options :");
				console.error("  --dry-run        : Simule sans écrire");
				console.error("  --skip-existing  : Ignore les journées déjà migrées");
				process.exit(1);
			}

			const dateStr = args[0];
			restaurantId = args[args.length - 1];

			if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
				throw new Error("restaurantId invalide");
			}

			dates = [parseDate(dateStr)];
		}

		console.log(`🎯 Cible : ${dates.length} jour(s)`);
		console.log(`🏢 Restaurant : ${restaurantId}`);
		if (options.dryRun) console.log("⚠️  Mode DRY-RUN (aucune écriture)");
		if (options.skipExisting) console.log("⏭️  Skip existing shifts");
		console.log("");

		// Connexion MongoDB
		const mongoUri = process.env.MONGODB_URI;
		if (!mongoUri) throw new Error("MONGODB_URI manquante");

		console.log("📡 Connexion à MongoDB...");
		await mongoose.connect(mongoUri);
		console.log("✅ Connecté");

		// Migrer chaque journée
		let totalSessions = 0;
		let totalEvents = 0;
		let skipped = 0;

		for (const date of dates) {
			const result = await migrateDay(date, restaurantId, options);
			if (result.skipped) {
				skipped++;
			} else {
				totalSessions += result.sessionsCount || 0;
				totalEvents += result.eventsCount || 0;
			}
		}

		console.log("");
		console.log("═".repeat(60));
		console.log("  RÉSULTAT FINAL");
		console.log("═".repeat(60));
		console.log(`✅ ${dates.length} jour(s) traité(s)`);
		console.log(`   - Sessions migrées : ${totalSessions}`);
		console.log(`   - Events créés     : ${totalEvents}`);
		console.log(`   - Jours ignorés    : ${skipped}`);
		console.log("");
		console.log("✅ Migration Phase 5 terminée avec succès !");
		console.log("");

	} catch (err) {
		console.error("");
		console.error("❌ ERREUR :");
		console.error(err);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
		console.log("📡 Déconnecté de MongoDB");
	}
}

main();
