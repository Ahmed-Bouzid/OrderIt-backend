const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const Order = require("../models/Order");

// ═══════════════════════════════════════════════════════════════════════
// 🧮 HELPERS POUR CALCULS COMPTABLES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule les dates de début/fin selon la période demandée
 */
function getPeriodDates(period, customStart = null, customEnd = null) {
	const now = new Date();
	let startDate, endDate;

	switch (period) {
		case "today":
			startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
			break;

		case "week":
			// Lundi de cette semaine
			const dayOfWeek = now.getDay() || 7; // Dimanche = 7
			startDate = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate() - (dayOfWeek - 1),
			);
			endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
			break;

		case "month":
			startDate = new Date(now.getFullYear(), now.getMonth(), 1);
			endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
			break;

		case "year":
			startDate = new Date(now.getFullYear(), 0, 1);
			endDate = new Date(now.getFullYear() + 1, 0, 1);
			break;

		case "custom":
			startDate = customStart
				? new Date(customStart)
				: new Date(now.getFullYear(), now.getMonth(), now.getDate());
			endDate = customEnd ? new Date(customEnd) : new Date();
			break;

		default:
			startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
	}

	return { startDate, endDate };
}

/**
 * Calcule la TVA (20% par défaut pour la France)
 */
function calculateTVA(amountHT, tvaRate = 0.2) {
	const tva = amountHT * tvaRate;
	const amountTTC = amountHT + tva;
	return {
		amountHT: Number(amountHT.toFixed(2)),
		tva: Number(tva.toFixed(2)),
		amountTTC: Number(amountTTC.toFixed(2)),
		tvaRate: tvaRate,
	};
}

/**
 * Calcule les marges (supposant 30% de coût des matières premières)
 */
function calculateMargins(revenue, costRatio = 0.3) {
	const costs = revenue * costRatio;
	const grossMargin = revenue - costs;
	const marginPercent = revenue > 0 ? (grossMargin / revenue) * 100 : 0;

	return {
		revenue: Number(revenue.toFixed(2)),
		costs: Number(costs.toFixed(2)),
		grossMargin: Number(grossMargin.toFixed(2)),
		marginPercent: Number(marginPercent.toFixed(1)),
	};
}

// ═══════════════════════════════════════════════════════════════════════
// 🔍 GET /accounting/summary - Résumé comptable avec périodes
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/summary",
	auth,
	checkRoles(["admin", "manager", "developer"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;
			const {
				period = "today",
				startDate: customStart,
				endDate: customEnd,
			} = req.query;

			// Calcul des dates selon la période
			const { startDate, endDate } = getPeriodDates(
				period,
				customStart,
				customEnd,
			);

			console.log(
				`📅 [ACCOUNTING] Période: ${period}, du ${startDate.toISOString()} au ${endDate.toISOString()}`,
			);

			// Récupération des commandes de la période
			const orders = await Order.find({
				restaurantId: restaurantId,
				createdAt: { $gte: startDate, $lt: endDate },
				status: { $ne: "cancelled" },
			});

			console.log(`📊 [ACCOUNTING] Commandes trouvées: ${orders.length}`);

			// ═══ CALCULS DE BASE ═══
			const totalRevenue = orders.reduce(
				(sum, order) => sum + (order.total || 0),
				0,
			);
			const totalOrders = orders.length;
			const averageOrderValue =
				totalOrders > 0 ? totalRevenue / totalOrders : 0;

			// ═══ PRODUITS POPULAIRES ═══
			const itemCounts = {};
			const itemRevenues = {};

			orders.forEach((order) => {
				order.items?.forEach((item) => {
					const productName =
						item.productName || item.name || "Produit inconnu";
					const quantity = item.quantity || 1;
					const itemPrice = item.price || 0;

					itemCounts[productName] = (itemCounts[productName] || 0) + quantity;
					itemRevenues[productName] =
						(itemRevenues[productName] || 0) + itemPrice * quantity;
				});
			});

			const topProduct =
				Object.keys(itemCounts).length > 0
					? Object.keys(itemCounts).reduce((a, b) =>
							itemCounts[a] > itemCounts[b] ? a : b,
						)
					: "Aucun produit";

			const topProducts = Object.entries(itemCounts)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5)
				.map(([name, count]) => ({
					name,
					quantity: count,
					revenue: itemRevenues[name] || 0,
				}));

			// ═══ CALCULS COMPTABLES AVANCÉS ═══
			// Supposons 83.33% HT (TVA 20%)
			const revenueHT = totalRevenue / 1.2;
			const tvaCalculations = calculateTVA(revenueHT, 0.2);
			const marginCalculations = calculateMargins(revenueHT, 0.3); // 30% de coûts

			// ═══ COMPARAISON PÉRIODE PRÉCÉDENTE ═══
			let previousPeriodStart, previousPeriodEnd;
			const periodDuration = endDate - startDate;

			switch (period) {
				case "today":
					previousPeriodStart = new Date(
						startDate.getTime() - 24 * 60 * 60 * 1000,
					);
					previousPeriodEnd = new Date(startDate);
					break;
				case "week":
					previousPeriodStart = new Date(
						startDate.getTime() - 7 * 24 * 60 * 60 * 1000,
					);
					previousPeriodEnd = new Date(startDate);
					break;
				case "month":
					previousPeriodStart = new Date(
						startDate.getFullYear(),
						startDate.getMonth() - 1,
						1,
					);
					previousPeriodEnd = new Date(
						startDate.getFullYear(),
						startDate.getMonth(),
						1,
					);
					break;
				case "year":
					previousPeriodStart = new Date(startDate.getFullYear() - 1, 0, 1);
					previousPeriodEnd = new Date(startDate.getFullYear(), 0, 1);
					break;
				default:
					previousPeriodStart = new Date(startDate.getTime() - periodDuration);
					previousPeriodEnd = startDate;
			}

			const previousOrders = await Order.find({
				restaurantId: restaurantId,
				createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd },
				status: { $ne: "cancelled" },
			});

			const previousRevenue = previousOrders.reduce(
				(sum, order) => sum + (order.total || 0),
				0,
			);
			const growthRate =
				previousRevenue > 0
					? ((totalRevenue - previousRevenue) / previousRevenue) * 100
					: 0;

			// ═══ DONNÉES POUR GRAPHIQUES ═══
			const dailyRevenues = await getDailyRevenues(
				restaurantId,
				startDate,
				endDate,
			);

			// ═══ RÉSULTAT FINAL ═══
			const result = {
				success: true,
				data: {
					// Infos générales
					period: period,
					startDate: startDate.toISOString().split("T")[0],
					endDate: endDate.toISOString().split("T")[0],

					// Métriques de base
					totalRevenue: Number(totalRevenue.toFixed(2)),
					totalOrders: totalOrders,
					averageOrderValue: Number(averageOrderValue.toFixed(2)),

					// Comptabilité avancée
					revenueHT: tvaCalculations.amountHT,
					revenueTTC: tvaCalculations.amountTTC,
					tvaCollected: tvaCalculations.tva,

					// Marges et coûts
					costs: marginCalculations.costs,
					grossMargin: marginCalculations.grossMargin,
					marginPercent: marginCalculations.marginPercent,
					netResult: marginCalculations.grossMargin, // Simplifié

					// Évolution
					previousPeriodRevenue: Number(previousRevenue.toFixed(2)),
					growthRate: Number(growthRate.toFixed(1)),

					// Produits
					topProduct: topProduct,
					topProducts: topProducts,

					// Données graphiques
					dailyRevenues: dailyRevenues,
				},
			};

			console.log("✅ [ACCOUNTING] Résumé généré avec succès");
			res.json(result);
		} catch (error) {
			console.error("❌ [ACCOUNTING] Erreur génération résumé:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors de la génération du résumé comptable",
				error: error.message,
			});
		}
	},
);

/**
 * Helper pour obtenir les revenus quotidiens (pour graphiques)
 */
async function getDailyRevenues(restaurantId, startDate, endDate) {
	const revenues = [];
	const currentDate = new Date(startDate);

	while (currentDate < endDate) {
		const dayStart = new Date(currentDate);
		const dayEnd = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);

		const dayOrders = await Order.find({
			restaurantId: restaurantId,
			createdAt: { $gte: dayStart, $lt: dayEnd },
			status: { $ne: "cancelled" },
		});

		const dayRevenue = dayOrders.reduce(
			(sum, order) => sum + (order.total || 0),
			0,
		);

		revenues.push({
			date: currentDate.toISOString().split("T")[0],
			revenue: Number(dayRevenue.toFixed(2)),
			orders: dayOrders.length,
		});

		currentDate.setDate(currentDate.getDate() + 1);
	}

	return revenues;
}

// ═══════════════════════════════════════════════════════════════════════
// 📊 GET /accounting/charts - Données pour graphiques
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/charts",
	auth,
	checkRoles(["admin", "manager", "developer"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;
			const { period = "month", type = "revenue" } = req.query;

			const { startDate, endDate } = getPeriodDates(period);

			let chartData = [];

			switch (type) {
				case "revenue":
					chartData = await getRevenueChartData(
						restaurantId,
						startDate,
						endDate,
						period,
					);
					break;
				case "orders":
					chartData = await getOrdersChartData(
						restaurantId,
						startDate,
						endDate,
						period,
					);
					break;
				case "products":
					chartData = await getTopProductsChartData(
						restaurantId,
						startDate,
						endDate,
					);
					break;
				default:
					chartData = await getRevenueChartData(
						restaurantId,
						startDate,
						endDate,
						period,
					);
			}

			res.json({
				success: true,
				data: {
					period,
					type,
					chartData,
				},
			});
		} catch (error) {
			console.error("❌ [ACCOUNTING] Erreur génération graphiques:", error);
			res.status(500).json({
				success: false,
				error: error.message,
			});
		}
	},
);

async function getRevenueChartData(restaurantId, startDate, endDate, period) {
	// Implementation dépend de la période demandée
	return await getDailyRevenues(restaurantId, startDate, endDate);
}

async function getOrdersChartData(restaurantId, startDate, endDate, period) {
	const dailyData = await getDailyRevenues(restaurantId, startDate, endDate);
	return dailyData.map((day) => ({
		date: day.date,
		value: day.orders,
	}));
}

async function getTopProductsChartData(restaurantId, startDate, endDate) {
	const orders = await Order.find({
		restaurantId: restaurantId,
		createdAt: { $gte: startDate, $lt: endDate },
		status: { $ne: "cancelled" },
	});

	const productStats = {};

	orders.forEach((order) => {
		order.items?.forEach((item) => {
			const productName = item.productName || item.name || "Produit inconnu";
			const quantity = item.quantity || 1;
			const revenue = (item.price || 0) * quantity;

			if (!productStats[productName]) {
				productStats[productName] = { quantity: 0, revenue: 0 };
			}

			productStats[productName].quantity += quantity;
			productStats[productName].revenue += revenue;
		});
	});

	return Object.entries(productStats)
		.sort(([, a], [, b]) => b.revenue - a.revenue)
		.slice(0, 10)
		.map(([name, stats]) => ({
			name,
			quantity: stats.quantity,
			revenue: Number(stats.revenue.toFixed(2)),
		}));
}

// ═══════════════════════════════════════════════════════════════════════
// 📋 GET /accounting/details - Détails avancés pour export
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/details",
	auth,
	checkRoles(["admin", "developer"]),
	async (req, res) => {
		try {
			const { restaurantId } = req.user;
			const {
				period = "today",
				startDate: customStart,
				endDate: customEnd,
			} = req.query;

			const { startDate, endDate } = getPeriodDates(
				period,
				customStart,
				customEnd,
			);

			const orders = await Order.find({
				restaurantId: restaurantId,
				createdAt: { $gte: startDate, $lt: endDate },
				status: { $ne: "cancelled" },
			}).sort({ createdAt: -1 });

			const details = orders.map((order) => ({
				orderId: order._id,
				date: order.createdAt,
				total: order.total,
				items: order.items,
				status: order.status,
				tableId: order.tableId,
				serverId: order.serverId,
			}));

			res.json({
				success: true,
				data: {
					orders: details,
					total: details.reduce((sum, order) => sum + order.total, 0),
					count: details.length,
				},
			});
		} catch (error) {
			console.error("❌ [ACCOUNTING] Erreur récupération détails:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors de la récupération des détails",
				error: error.message,
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════
// 📥 GET /accounting/export - Export CSV des données comptables
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/export",
	auth,
	checkRoles(["admin", "developer"]),
	async (req, res) => {
		try {
			const { restaurantId, restaurantName = "Restaurant" } = req.user;
			const {
				period = "month",
				startDate: customStart,
				endDate: customEnd,
				format = "csv",
			} = req.query;

			const { startDate, endDate } = getPeriodDates(
				period,
				customStart,
				customEnd,
			);

			// Récupération données complètes
			const orders = await Order.find({
				restaurantId: restaurantId,
				createdAt: { $gte: startDate, $lt: endDate },
				status: { $ne: "cancelled" },
			}).sort({ createdAt: -1 });

			// ═══ CALCULS GLOBAUX ═══
			const totalRevenue = orders.reduce(
				(sum, order) => sum + (order.total || 0),
				0,
			);
			const revenueHT = totalRevenue / 1.2;
			const tvaCalculations = calculateTVA(revenueHT, 0.2);
			const marginCalculations = calculateMargins(revenueHT, 0.3);

			// ═══ ANALYSIS PRODUITS ═══
			const productStats = {};
			orders.forEach((order) => {
				order.items?.forEach((item) => {
					const productName =
						item.productName || item.name || "Produit inconnu";
					const quantity = item.quantity || 1;
					const revenue = (item.price || 0) * quantity;

					if (!productStats[productName]) {
						productStats[productName] = {
							quantity: 0,
							revenue: 0,
							orders: new Set(),
						};
					}

					productStats[productName].quantity += quantity;
					productStats[productName].revenue += revenue;
					productStats[productName].orders.add(order._id.toString());
				});
			});

			// ═══ GÉNÉRATION CSV ═══
			let csvContent = "";

			// Header du rapport
			csvContent += `RAPPORT COMPTABLE - ${restaurantName}\n`;
			csvContent += `Période;${startDate.toISOString().split("T")[0]};${endDate.toISOString().split("T")[0]}\n`;
			csvContent += `Généré le;${new Date().toLocaleString("fr-FR")}\n\n`;

			// Résumé financier
			csvContent += `RÉSUMÉ FINANCIER\n`;
			csvContent += `Chiffre d'Affaires TTC;€${totalRevenue.toFixed(2)}\n`;
			csvContent += `Chiffre d'Affaires HT;€${tvaCalculations.amountHT}\n`;
			csvContent += `TVA Collectée (20%);€${tvaCalculations.tva}\n`;
			csvContent += `Coûts Estimés;€${marginCalculations.costs}\n`;
			csvContent += `Marge Brute;€${marginCalculations.grossMargin}\n`;
			csvContent += `Taux de Marge;${marginCalculations.marginPercent}%\n`;
			csvContent += `Nombre de Commandes;${orders.length}\n`;
			csvContent += `Panier Moyen;€${orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : "0.00"}\n\n`;

			// Détail des commandes
			csvContent += `DÉTAIL DES COMMANDES\n`;
			csvContent += `Date;Heure;ID Commande;Table;Montant TTC;Montant HT;TVA;Statut\n`;

			orders.forEach((order) => {
				const orderDate = new Date(order.createdAt);
				const orderHT = (order.total || 0) / 1.2;
				const orderTVA = (order.total || 0) - orderHT;

				csvContent += `${orderDate.toLocaleDateString("fr-FR")};`;
				csvContent += `${orderDate.toLocaleTimeString("fr-FR")};`;
				csvContent += `${order._id};`;
				csvContent += `${order.tableId || "N/A"};`;
				csvContent += `€${(order.total || 0).toFixed(2)};`;
				csvContent += `€${orderHT.toFixed(2)};`;
				csvContent += `€${orderTVA.toFixed(2)};`;
				csvContent += `${order.status}\n`;
			});

			csvContent += `\n`;

			// Top produits
			csvContent += `ANALYSE DES PRODUITS\n`;
			csvContent += `Produit;Quantité Vendue;Chiffre d'Affaires;Nombre de Commandes;CA Moyen\n`;

			Object.entries(productStats)
				.sort(([, a], [, b]) => b.revenue - a.revenue)
				.forEach(([productName, stats]) => {
					const avgRevenue =
						stats.orders.size > 0 ? stats.revenue / stats.orders.size : 0;
					csvContent += `${productName};`;
					csvContent += `${stats.quantity};`;
					csvContent += `€${stats.revenue.toFixed(2)};`;
					csvContent += `${stats.orders.size};`;
					csvContent += `€${avgRevenue.toFixed(2)}\n`;
				});

			csvContent += `\n`;

			// Analyse quotidienne
			const dailyStats = {};
			orders.forEach((order) => {
				const dateKey = new Date(order.createdAt).toISOString().split("T")[0];
				if (!dailyStats[dateKey]) {
					dailyStats[dateKey] = { revenue: 0, orders: 0 };
				}
				dailyStats[dateKey].revenue += order.total || 0;
				dailyStats[dateKey].orders += 1;
			});

			csvContent += `ÉVOLUTION QUOTIDIENNE\n`;
			csvContent += `Date;Chiffre d'Affaires;Nombre de Commandes;Panier Moyen\n`;

			Object.entries(dailyStats)
				.sort(([a], [b]) => a.localeCompare(b))
				.forEach(([date, stats]) => {
					const avgOrder = stats.orders > 0 ? stats.revenue / stats.orders : 0;
					csvContent += `${date};`;
					csvContent += `€${stats.revenue.toFixed(2)};`;
					csvContent += `${stats.orders};`;
					csvContent += `€${avgOrder.toFixed(2)}\n`;
				});

			// Configuration response
			const filename = `comptabilite-${restaurantName.replace(/[^a-zA-Z0-9]/g, "")}-${period}-${new Date().toISOString().split("T")[0]}.csv`;

			res.setHeader("Content-Type", "text/csv; charset=utf-8");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${filename}"`,
			);
			res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

			// BOM UTF-8 pour Excel
			res.write("\ufeff");
			res.write(csvContent);
			res.end();

			console.log(`✅ [ACCOUNTING] Export généré: ${filename}`);
		} catch (error) {
			console.error("❌ [ACCOUNTING] Erreur génération export:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors de la génération de l'export",
				error: error.message,
			});
		}
	},
);

module.exports = router;
