/**
 * Script de test pour l'endpoint /z-reports/pilotage
 * 
 * Usage:
 *   node scripts/test-z-pilotage.js [type]
 *   
 * Exemples:
 *   node scripts/test-z-pilotage.js basic
 *   node scripts/test-z-pilotage.js complet
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "warai@warai.fr";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Warai1234@";

async function main() {
	const type = process.argv[2] || "basic";

	if (!["basic", "complet"].includes(type)) {
		console.error("❌ Type doit être 'basic' ou 'complet'");
		process.exit(1);
	}

	console.log(`\n🧪 Test Z de caisse pilotage — type: ${type.toUpperCase()}\n`);

	try {
		// 1. Login admin
		console.log("🔐 Connexion admin...");
		const loginRes = await fetch(`${BASE_URL}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: ADMIN_EMAIL,
				password: ADMIN_PASSWORD,
			}),
		});

		if (!loginRes.ok) {
			const error = await loginRes.text();
			console.error("❌ Erreur login:", error);
			process.exit(1);
		}

		const loginData = await loginRes.json();
		
		if (!loginData.success || !loginData.user) {
			console.error("❌ Erreur login:", loginData.message || "User non retourné");
			process.exit(1);
		}

		const { token, user } = loginData;
		console.log(`✅ Connecté: ${user.name} (${user.email})`);
		console.log(`📍 Restaurant: ${user.restaurantId}\n`);

		// 2. Récupérer le Z pilotage
		console.log(`📊 Récupération Z de caisse ${type}...`);
		
		const today = new Date();
		const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		
		const params = new URLSearchParams({
			type,
			from: startOfDay.toISOString(),
			to: today.toISOString(),
			openingFloatCents: 10000, // 100€
			closingCountCents: 15000, // 150€
		});

		const zRes = await fetch(`${BASE_URL}/z-reports/pilotage?${params}`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		const zData = await zRes.json();
		const { success, data, period } = zData;

		if (!success) {
			console.error("❌ Erreur:", zData.message);
			process.exit(1);
		}

		console.log(`✅ Z de caisse généré\n`);

		// 3. Afficher les résultats selon le type
		console.log("═".repeat(60));
		console.log(`  Z DE CAISSE — ${type.toUpperCase()}`);
		console.log("═".repeat(60));
		console.log(`📅 Période: ${new Date(period.from).toLocaleString("fr-FR")} → ${new Date(period.to).toLocaleString("fr-FR")}\n`);

		if (type === "basic") {
			printBasicZ(data);
		} else {
			printCompletZ(data);
		}

		console.log("\n" + "═".repeat(60));
		console.log(`✅ Test réussi — Statut: ${data.status}`);
		if (data.anomalies?.length > 0) {
			console.log(`⚠️  Anomalies: ${data.anomalies.join(", ")}`);
		}
		console.log("═".repeat(60) + "\n");

	} catch (error) {
		console.error("\n❌ Erreur:", error.message);
		process.exit(1);
	}
}

function printBasicZ(data) {
	console.log("💰 FINANCIERS");
	console.log(`   CA TTC          : ${formatEuro(data.caTTC)}`);
	console.log(`   CA HT           : ${formatEuro(data.caHT)}`);
	console.log(`   TVA totale      : ${formatEuro(data.tvaTotale)}`);
	console.log(`   Résultat estimé : ${formatEuro(data.estimatedResult.netResult)} (${data.estimatedResult.marginPercent}%)`);

	console.log("\n💳 PAIEMENTS");
	console.log(`   Espèces         : ${formatEuro(data.paymentBreakdown.cash)}`);
	console.log(`   Carte bancaire  : ${formatEuro(data.paymentBreakdown.card)}`);
	console.log(`   Autre           : ${formatEuro(data.paymentBreakdown.other)}`);
	console.log(`   Frais CB        : ${formatEuro(data.cardFees)}`);

	console.log("\n🎫 TICKETS");
	console.log(`   Nombre          : ${data.ticketCount}`);
	console.log(`   Ticket moyen    : ${formatEuro(data.ticketMoyen)}`);

	console.log("\n🎁 RÉDUCTIONS / ERREURS");
	console.log(`   Remises         : ${formatEuro(data.totalDiscounts)}`);
	console.log(`   Annulations     : ${formatEuro(data.totalVoids)}`);

	console.log("\n💵 CAISSE");
	console.log(`   Attendu         : ${formatCents(data.cashVariance.expectedCents)}`);
	console.log(`   Compté          : ${formatCents(data.cashVariance.countedCents)}`);
	console.log(`   Écart           : ${formatCents(data.cashVariance.varianceCents)} (${data.cashVariance.variancePercent}%)`);
	if (data.cashVariance.alert) {
		console.log(`   ⚠️  ${data.cashVariance.alert}`);
	}

	console.log("\n🏆 TOP 3 PRODUITS");
	data.top3Products.forEach((p, i) => {
		console.log(`   ${i + 1}. ${p.name.padEnd(30)} ${p.quantity.toString().padStart(3)}× ${formatEuro(p.revenue).padStart(10)}`);
	});

	console.log("\n📊 COMPARAISON J-7");
	console.log(`   CA J-7          : ${formatEuro(data.compareJ7.ca.j7)} → ${formatEuro(data.compareJ7.ca.current)} (${formatPercent(data.compareJ7.ca.variation)})`);
	console.log(`   Ticket J-7      : ${formatEuro(data.compareJ7.ticketMoyen.j7)} → ${formatEuro(data.compareJ7.ticketMoyen.current)} (${formatPercent(data.compareJ7.ticketMoyen.variation)})`);
}

function printCompletZ(data) {
	console.log("💰 FINANCIERS");
	console.log(`   Résultat net    : ${formatEuro(data.netResult)}`);
	console.log(`   CA TTC          : ${formatEuro(data.caTTC)}`);
	console.log(`   CA HT           : ${formatEuro(data.caHT)}`);
	console.log(`   Marge brute     : ${formatEuro(data.grossMargin.amount)} (${data.grossMargin.percent}%)`);

	console.log("\n💸 COÛTS");
	console.log(`   Matières        : ${formatEuro(data.costs.foodCost)} (${data.costs.foodCostPercent}%)`);
	console.log(`   Main d'œuvre    : ${formatEuro(data.costs.laborCost)} (${data.costs.laborCostPercent}%)`);

	console.log("\n🧾 TVA");
	console.log(`   Total           : ${formatEuro(data.tva.total)}`);
	console.log(`   TVA 20%         : ${formatEuro(data.tva.tva20.amount)} (base: ${formatEuro(data.tva.tva20.base)})`);
	console.log(`   TVA 10%         : ${formatEuro(data.tva.tva10.amount)} (base: ${formatEuro(data.tva.tva10.base)})`);

	console.log("\n💳 PAIEMENTS");
	console.log(`   Espèces         : ${formatEuro(data.paymentBreakdown.cash)}`);
	console.log(`   Carte bancaire  : ${formatEuro(data.paymentBreakdown.card)}`);
	console.log(`   Autre           : ${formatEuro(data.paymentBreakdown.other)}`);

	console.log("\n💵 CAISSE");
	console.log(`   Attendu         : ${formatCents(data.cashVariance.expectedCents)}`);
	console.log(`   Compté          : ${formatCents(data.cashVariance.countedCents)}`);
	console.log(`   Écart           : ${formatCents(data.cashVariance.varianceCents)} (${data.cashVariance.variancePercent}%)`);

	console.log("\n💰 FRAIS BANCAIRES");
	console.log(`   Terminal CB     : ${formatEuro(data.bankingFees.cardTerminal)}`);
	console.log(`   PSP             : ${formatEuro(data.bankingFees.psp)}`);
	console.log(`   Total           : ${formatEuro(data.bankingFees.total)}`);

	console.log("\n🎫 TICKETS");
	console.log(`   Nombre          : ${data.ticketCount}`);
	console.log(`   Couverts        : ${data.totalCouverts}`);
	console.log(`   Ticket moyen    : ${formatEuro(data.ticketMoyen)}`);
	console.log(`   Ticket max      : ${formatEuro(data.maxTicket)}`);

	console.log("\n🎁 RÉDUCTIONS / ANNULATIONS");
	console.log(`   Remises         : ${formatEuro(data.discounts.total)}`);
	console.log(`   Offerts         : ${formatEuro(data.discounts.offerts.amount)} (${data.discounts.offerts.count}×)`);
	console.log(`   Annulations     : ${formatEuro(data.voids.amount)} (${data.voids.count} commandes, ${data.voids.items} items)`);

	console.log("\n🏆 TOP 5 PRODUITS");
	data.topProducts.slice(0, 5).forEach((p, i) => {
		console.log(`   ${i + 1}. ${p.name.padEnd(25)} ${p.quantity.toString().padStart(3)}× CA: ${formatEuro(p.revenue).padStart(8)} Marge: ${formatEuro(p.margin).padStart(8)}`);
	});

	if (data.cancelledProducts.length > 0) {
		console.log("\n❌ PRODUITS ANNULÉS");
		data.cancelledProducts.forEach((p, i) => {
			console.log(`   ${i + 1}. ${p.name.padEnd(30)} ${p.count}× ${formatEuro(p.amount)}`);
		});
	}

	console.log("\n⏱️  TEMPS MOYEN DE SERVICE");
	console.log(`   ${data.avgServiceTimeMinutes.toFixed(0)} minutes`);

	console.log("\n📈 HEURES DE PIC");
	console.log(`   ${data.peakHour.hour}h → ${formatEuro(data.peakHour.revenue)}`);

	console.log("\n🍽️  SERVICES");
	console.log(`   Midi            : ${formatEuro(data.serviceBreakdown.midi.revenue)} (${data.serviceBreakdown.midi.orders} tickets, ${data.serviceBreakdown.midi.couverts} couverts)`);
	console.log(`   Soir            : ${formatEuro(data.serviceBreakdown.soir.revenue)} (${data.serviceBreakdown.soir.orders} tickets, ${data.serviceBreakdown.soir.couverts} couverts)`);

	console.log("\n📊 COMPARAISONS");
	console.log(`   J-7 CA          : ${formatEuro(data.compareJ7.ca.j7)} → ${formatEuro(data.compareJ7.ca.current)} (${formatPercent(data.compareJ7.ca.variation)})`);
	console.log(`   J-7 Ticket moy. : ${formatEuro(data.compareJ7.ticketMoyen.j7)} → ${formatEuro(data.compareJ7.ticketMoyen.current)} (${formatPercent(data.compareJ7.ticketMoyen.variation)})`);
	console.log(`   Moy. mensuelle  : ${formatEuro(data.compareJ7.monthAvgDaily)} (${formatPercent(data.compareJ7.vsMonthAvg)})`);

	console.log("\n🔮 PROJECTIONS FIN DE MOIS");
	console.log(`   CA              : ${formatEuro(data.projections.monthRevenue)}`);
	console.log(`   Résultat        : ${formatEuro(data.projections.monthResult)}`);
	console.log(`   TVA             : ${formatEuro(data.projections.monthTVA)}`);

	if (data.alerts.length > 0) {
		console.log("\n⚠️  ALERTES");
		data.alerts.forEach((a) => {
			const icon = a.severity === "error" ? "🔴" : a.severity === "warning" ? "🟠" : "🔵";
			console.log(`   ${icon} [${a.type}] ${a.message}`);
		});
	}
}

function formatEuro(amount) {
	return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

function formatCents(cents) {
	return formatEuro(cents / 100);
}

function formatPercent(value) {
	const sign = value > 0 ? "+" : "";
	return `${sign}${value.toFixed(1)}%`;
}

main();
