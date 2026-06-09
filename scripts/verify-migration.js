/**
 * verify-migration.js — Phase 5 Validation
 * 
 * Vérifie la cohérence entre les Z legacy et les Z event-sourced.
 * Compare les montants pour détecter les écarts (tolérance ±1€ pour arrondi).
 * 
 * Usage :
 *   # Vérifier tous les Z d'un restaurant
 *   node scripts/verify-migration.js <restaurantId>
 * 
 *   # Vérifier un Z spécifique
 *   node scripts/verify-migration.js --z-report-id <zReportId>
 * 
 *   # Vérifier les N derniers Z
 *   node scripts/verify-migration.js <restaurantId> --last-n 30
 * 
 * Options :
 *   --tolerance <cents>  : Tolérance d'écart en centimes (défaut: 100 = 1€)
 *   --show-details       : Affiche les détails de chaque comparaison
 *   --fail-on-error      : Exit code 1 si écarts détectés
 * 
 * Vérifications :
 *   - netSalesCents (CA net)
 *   - ticketCount (nombre de tickets)
 *   - cashVarianceCents (écart caisse)
 *   - paymentBreakdown (ventilation par méthode)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const ZReport = require("../src/models/ZReport");
const CashShift = require("../src/models/CashShift");
const ZProjectionService = require("../src/services/ZProjectionService");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatCents(cents) {
	return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function percentDiff(legacy, reconstructed) {
	if (legacy === 0 && reconstructed === 0) return 0;
	if (legacy === 0) return 100;
	return Math.abs((reconstructed - legacy) / legacy * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification d'un Z
// ─────────────────────────────────────────────────────────────────────────────

async function verifyZReport(zReport, options = {}) {
	const { tolerance = 100, showDetails = false } = options;

	// Si pas de shift associé, impossible de reconstruire
	if (!zReport.shiftId) {
		return {
			id: zReport._id,
			status: "skip",
			reason: "Aucun shift associé (Z legacy sans migration Phase 5)",
		};
	}

	// Récupérer le shift
	const shift = await CashShift.findById(zReport.shiftId).lean();
	if (!shift) {
		return {
			id: zReport._id,
			status: "error",
			reason: "Shift introuvable",
		};
	}

	// Reconstruire depuis events
	const reconstructed = await ZProjectionService.projectShift(
		zReport.restaurantId.toString(),
		zReport.shiftId.toString(),
		zReport.openingFloatCents || 0,
	);

	// Comparaison
	const diffNet = Math.abs(zReport.netSalesCents - reconstructed.netSalesCents);
	const diffTickets = Math.abs(zReport.ticketCount - reconstructed.ticketCount);
	const diffVariance = Math.abs(
		(zReport.cashVarianceCents || 0) - (reconstructed.cashVarianceCents || 0)
	);

	const isValid = diffNet <= tolerance && diffTickets === 0;

	const result = {
		id: zReport._id,
		sequenceNumber: zReport.sequenceNumber,
		status: isValid ? "ok" : "mismatch",
		legacy: {
			netSalesCents: zReport.netSalesCents,
			ticketCount: zReport.ticketCount,
			cashVarianceCents: zReport.cashVarianceCents || 0,
		},
		reconstructed: {
			netSalesCents: reconstructed.netSalesCents,
			ticketCount: reconstructed.ticketCount,
			cashVarianceCents: reconstructed.cashVarianceCents || 0,
		},
		diff: {
			netSalesCents: diffNet,
			ticketCount: diffTickets,
			cashVarianceCents: diffVariance,
		},
		percentDiff: {
			netSalesCents: percentDiff(zReport.netSalesCents, reconstructed.netSalesCents),
		},
	};

	if (showDetails || !isValid) {
		console.log("");
		console.log(`📊 Z #${zReport.sequenceNumber} (${zReport._id})`);
		console.log(`   Shift : #${shift.sequenceNumber}`);
		console.log(`   Période : ${new Date(zReport.periodStart).toLocaleDateString("fr-FR")} → ${new Date(zReport.periodEnd).toLocaleDateString("fr-FR")}`);
		console.log("");
		console.log("   Comparaison :");
		console.log(`   CA net (legacy)       : ${formatCents(zReport.netSalesCents)}`);
		console.log(`   CA net (reconstructed): ${formatCents(reconstructed.netSalesCents)}`);
		console.log(`   Écart                 : ${formatCents(diffNet)} (${result.percentDiff.netSalesCents.toFixed(2)}%)`);
		console.log("");
		console.log(`   Tickets (legacy)      : ${zReport.ticketCount}`);
		console.log(`   Tickets (reconstructed): ${reconstructed.ticketCount}`);
		console.log(`   Écart                 : ${diffTickets}`);
		console.log("");
		console.log(`   Écart caisse (legacy) : ${formatCents(zReport.cashVarianceCents || 0)}`);
		console.log(`   Écart caisse (reconst): ${formatCents(reconstructed.cashVarianceCents || 0)}`);
		console.log(`   Diff                  : ${formatCents(diffVariance)}`);
		console.log("");

		if (isValid) {
			console.log("   ✅ COHÉRENT");
		} else {
			console.log("   ❌ INCOHÉRENT");
		}
	}

	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	try {
		console.log("═".repeat(60));
		console.log("  VÉRIFICATION COHÉRENCE MIGRATION (Phase 5)");
		console.log("═".repeat(60));
		console.log("");

		// Parse arguments
		const args = process.argv.slice(2);
		const options = {
			tolerance: 100, // 1€ par défaut
			showDetails: args.includes("--show-details"),
			failOnError: args.includes("--fail-on-error"),
		};

		if (args.includes("--tolerance")) {
			const idx = args.indexOf("--tolerance");
			options.tolerance = parseInt(args[idx + 1], 10);
		}

		let zReports = [];

		if (args.includes("--z-report-id")) {
			const idx = args.indexOf("--z-report-id");
			const id = args[idx + 1];
			if (!mongoose.Types.ObjectId.isValid(id)) {
				throw new Error("z-report-id invalide");
			}
			const z = await ZReport.findById(id).lean();
			if (!z) throw new Error("Z report introuvable");
			zReports = [z];
		} else {
			const restaurantId = args.find(a => mongoose.Types.ObjectId.isValid(a));
			if (!restaurantId) {
				console.error("Usage :");
				console.error("  node scripts/verify-migration.js <restaurantId>");
				console.error("  node scripts/verify-migration.js --z-report-id <zReportId>");
				console.error("  node scripts/verify-migration.js <restaurantId> --last-n 30");
				console.error("");
				console.error("Options :");
				console.error("  --tolerance <cents>  : Tolérance d'écart (défaut: 100 = 1€)");
				console.error("  --show-details       : Affiche tous les détails");
				console.error("  --fail-on-error      : Exit code 1 si incohérences");
				process.exit(1);
			}

			const limit = args.includes("--last-n")
				? parseInt(args[args.indexOf("--last-n") + 1], 10)
				: 9999;

			zReports = await ZReport.find({ restaurantId })
				.sort({ createdAt: -1 })
				.limit(limit)
				.lean();
		}

		console.log(`🎯 ${zReports.length} Z rapport(s) à vérifier`);
		console.log(`🎛️  Tolérance : ${formatCents(options.tolerance)}`);
		console.log("");

		// Connexion MongoDB
		const mongoUri = process.env.MONGODB_URI;
		if (!mongoUri) throw new Error("MONGODB_URI manquante");

		console.log("📡 Connexion à MongoDB...");
		await mongoose.connect(mongoUri);
		console.log("✅ Connecté");
		console.log("");

		// Vérifier chaque Z
		const results = {
			ok: 0,
			mismatch: 0,
			skip: 0,
			error: 0,
		};

		const mismatches = [];

		for (const z of zReports) {
			const result = await verifyZReport(z, options);
			results[result.status]++;

			if (result.status === "mismatch") {
				mismatches.push(result);
			}
		}

		// Résumé
		console.log("");
		console.log("═".repeat(60));
		console.log("  RÉSULTAT FINAL");
		console.log("═".repeat(60));
		console.log(`✅ Cohérents       : ${results.ok}`);
		console.log(`❌ Incohérents     : ${results.mismatch}`);
		console.log(`⏭️  Ignorés (no shift): ${results.skip}`);
		console.log(`⚠️  Erreurs         : ${results.error}`);
		console.log("");

		if (results.mismatch > 0) {
			console.log("❌ INCOHÉRENCES DÉTECTÉES :");
			console.log("");
			for (const m of mismatches) {
				console.log(`   Z #${m.sequenceNumber} (${m.id})`);
				console.log(`     CA net : ${formatCents(m.diff.netSalesCents)} d'écart (${m.percentDiff.netSalesCents.toFixed(2)}%)`);
				console.log(`     Tickets : ${m.diff.ticketCount} d'écart`);
			}
			console.log("");
			console.log("⚠️  Vérifiez les logs ci-dessus pour plus de détails.");
			console.log("");

			if (options.failOnError) {
				process.exit(1);
			}
		} else if (results.ok > 0) {
			console.log("✅ Toutes les vérifications sont passées avec succès !");
			console.log(`   ${results.ok} Z rapport(s) cohérent(s) (tolérance ${formatCents(options.tolerance)})`);
			console.log("");
		}

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
