const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const checkUserRestaurant = require("../middlewares/checkUserRestaurant");
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
const Server = require("../models/Server");
const ClientMessage = require("../models/ClientMessage");
const Table = require("../models/Table");
const { body, query, validationResult } = require("express-validator");

/**
 * 🎯 Module CRM - Performance des équipes
 * Analyse toutes les données opérationnelles pour optimiser les performances
 *
 * Accès: Admins et Managers uniquement
 */

// ═══════════════════════════════════════════════════════════════════════════
// 📊 GET /crm/dashboard - Dashboard principal avec KPI globaux
// ═══════════════════════════════════════════════════════════════════════════
router.get(
	"/dashboard",
	auth,
	checkRoles(["admin", "manager"]),
	[
		query("period").optional().isIn(["today", "week", "month", "quarter"]),
		query("startDate").optional().isISO8601(),
		query("endDate").optional().isISO8601(),
		query("restaurantId").optional().isMongoId(),
	],
	async (req, res) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const { period = "week", startDate, endDate, restaurantId } = req.query;
			const targetRestaurantId = restaurantId || req.user.restaurantId;

			// Calculer les dates selon la période
			const { start, end } = getPeriodDates(period, startDate, endDate);

			console.log(
				`📊 [CRM] Dashboard ${period} pour restaurant ${targetRestaurantId} du ${start} au ${end}`,
			);

			// Récupérer toutes les données en parallèle
			const [
				ordersData,
				reservationsData,
				serversData,
				messagesData,
				tablesData,
			] = await Promise.all([
				getOrdersAnalytics(targetRestaurantId, start, end),
				getReservationsAnalytics(targetRestaurantId, start, end),
				getServersData(targetRestaurantId),
				getMessagesAnalytics(targetRestaurantId, start, end),
				getTablesData(targetRestaurantId),
			]);

			// Calculer les KPI principales
			const kpi = {
				// 📈 Volume d'activité
				totalOrders: ordersData.totalOrders,
				totalRevenue: ordersData.totalRevenue,
				averageOrderValue: ordersData.averageOrderValue,

				// 🏃 Performance équipe
				activeServers: serversData.activeCount,
				averageOrdersPerServer: Math.round(
					ordersData.totalOrders / serversData.activeCount,
				),
				topPerformers: ordersData.topPerformers.slice(0, 3),

				// ⚡ Temps de service
				averageServiceTime: ordersData.averageServiceTime,
				fastestServer: ordersData.fastestServer,
				slowestTable: ordersData.slowestTable,

				// 💬 Communication client-serveur
				totalMessages: messagesData.totalMessages,
				averageResponseTime: messagesData.averageResponseTime,
				unreadMessages: messagesData.unreadCount,

				// 🍽️ Table management
				tablesTurnover: calculateTableTurnover(tablesData, reservationsData),
				busiestTables: reservationsData.busiestTables.slice(0, 5),

				// 💰 Upsells et add-ons
				upsellRate: ordersData.upsellRate,
				totalAddOns: ordersData.totalAddOns,
				addOnRevenue: ordersData.addOnRevenue,
			};

			// Trends (comparaison avec période précédente)
			const previousPeriod = getPreviousPeriodDates(start, end);
			const previousOrdersData = await getOrdersAnalytics(
				targetRestaurantId,
				previousPeriod.start,
				previousPeriod.end,
			);

			const trends = {
				ordersGrowth: calculateGrowth(
					ordersData.totalOrders,
					previousOrdersData.totalOrders,
				),
				revenueGrowth: calculateGrowth(
					ordersData.totalRevenue,
					previousOrdersData.totalRevenue,
				),
				serviceTimeGrowth: calculateGrowth(
					ordersData.averageServiceTime,
					previousOrdersData.averageServiceTime,
					true,
				), // inverse = better
			};

			res.json({
				success: true,
				data: {
					period,
					dateRange: { start, end },
					kpi,
					trends,
					charts: {
						ordersTimeline: ordersData.timeline,
						revenueByServer: ordersData.revenueByServer,
						messagesHeatmap: messagesData.hourlyDistribution,
						tableOccupancy: calculateTableOccupancy(
							reservationsData,
							tablesData,
						),
					},
				},
			});
		} catch (error) {
			console.error("❌ [CRM] Erreur dashboard:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors du calcul des KPI",
				error:
					process.env.NODE_ENV === "development" ? error.message : undefined,
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// 👥 GET /crm/servers - Analyse détaillée par serveur
// ═══════════════════════════════════════════════════════════════════════════
router.get(
	"/servers",
	auth,
	checkRoles(["admin", "manager"]),
	[
		query("period").optional().isIn(["today", "week", "month", "quarter"]),
		query("serverId").optional().isMongoId(),
		query("detailed").optional().isBoolean(),
	],
	async (req, res) => {
		try {
			const { period = "week", serverId, detailed = false } = req.query;
			const restaurantId = req.user.restaurantId;
			const { start, end } = getPeriodDates(period);

			console.log(
				`👥 [CRM] Analyse serveurs restaurant ${restaurantId} du ${start} au ${end}`,
			);

			// Récupérer tous les serveurs du restaurant
			const servers = await Server.find({ restaurantId }).select(
				"name email role",
			);

			// Analyser chaque serveur
			const serversAnalysis = await Promise.all(
				servers.map(async (server) => {
					const analysis = await getServerPerformance(
						server._id,
						restaurantId,
						start,
						end,
						detailed,
					);
					return {
						...server.toObject(),
						performance: analysis,
					};
				}),
			);

			// Trier par performance globale
			serversAnalysis.sort(
				(a, b) => b.performance.totalSales - a.performance.totalSales,
			);

			// Recommandations de coaching
			const recommendations = generateCoachingRecommendations(serversAnalysis);

			res.json({
				success: true,
				data: {
					servers: serversAnalysis,
					recommendations,
					period,
					dateRange: { start, end },
				},
			});
		} catch (error) {
			console.error("❌ [CRM] Erreur analyse serveurs:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors de l'analyse des serveurs",
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// 🏆 GET /crm/leaderboard - Classement des performances
// ═══════════════════════════════════════════════════════════════════════════
router.get(
	"/leaderboard",
	auth,
	checkRoles(["admin", "manager"]),
	[
		query("period").optional().isIn(["today", "week", "month", "quarter"]),
		query("metric")
			.optional()
			.isIn(["sales", "orders", "speed", "upsells", "satisfaction"]),
	],
	async (req, res) => {
		try {
			const { period = "week", metric = "sales" } = req.query;
			const restaurantId = req.user.restaurantId;
			const { start, end } = getPeriodDates(period);

			const leaderboard = await generateLeaderboard(
				restaurantId,
				start,
				end,
				metric,
			);

			res.json({
				success: true,
				data: {
					leaderboard,
					metric,
					period,
					dateRange: { start, end },
				},
			});
		} catch (error) {
			console.error("❌ [CRM] Erreur leaderboard:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors du calcul du classement",
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// 📈 GET /crm/trends - Tendances et évolutions
// ═══════════════════════════════════════════════════════════════════════════
router.get(
	"/trends",
	auth,
	checkRoles(["admin", "manager"]),
	async (req, res) => {
		try {
			const restaurantId = req.user.restaurantId;

			// Analyser les 3 derniers mois par semaine
			const trends = await calculateTrends(restaurantId);

			res.json({
				success: true,
				data: trends,
			});
		} catch (error) {
			console.error("❌ [CRM] Erreur trends:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors du calcul des tendances",
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// 📊 GET /crm/reports/export - Export des données
// ═══════════════════════════════════════════════════════════════════════════
router.get(
	"/reports/export",
	auth,
	checkRoles(["admin", "manager"]),
	[
		query("period").optional().isIn(["today", "week", "month", "quarter"]),
		query("format").optional().isIn(["json", "csv"]),
	],
	async (req, res) => {
		try {
			const { period = "month", format = "json" } = req.query;
			const restaurantId = req.user.restaurantId;
			const { start, end } = getPeriodDates(period);

			const reportData = await generateFullReport(restaurantId, start, end);

			if (format === "csv") {
				res.setHeader("Content-Type", "text/csv");
				res.setHeader(
					"Content-Disposition",
					`attachment; filename="crm-report-${period}.csv"`,
				);
				res.send(convertToCSV(reportData));
			} else {
				res.json({
					success: true,
					data: reportData,
					metadata: {
						generatedAt: new Date(),
						period,
						dateRange: { start, end },
						restaurantId,
					},
				});
			}
		} catch (error) {
			console.error("❌ [CRM] Erreur export:", error);
			res.status(500).json({
				success: false,
				message: "Erreur lors de l'export des données",
			});
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcule les dates selon la période
 */
function getPeriodDates(period, customStart, customEnd) {
	const now = new Date();
	let start,
		end = now;

	if (customStart && customEnd) {
		return {
			start: new Date(customStart),
			end: new Date(customEnd),
		};
	}

	switch (period) {
		case "today":
			start = new Date(now.setHours(0, 0, 0, 0));
			end = new Date(now.setHours(23, 59, 59, 999));
			break;
		case "week":
			start = new Date(now.setDate(now.getDate() - 7));
			break;
		case "month":
			start = new Date(now.setDate(now.getDate() - 30));
			break;
		case "quarter":
			start = new Date(now.setDate(now.getDate() - 90));
			break;
		default:
			start = new Date(now.setDate(now.getDate() - 7));
	}

	return { start, end: new Date() };
}

/**
 * Analyse des commandes
 */
async function getOrdersAnalytics(restaurantId, start, end) {
	const pipeline = [
		{
			$match: {
				restaurantId: restaurantId,
				createdAt: { $gte: start, $lte: end },
			},
		},
		{
			$lookup: {
				from: "servers",
				localField: "serverId",
				foreignField: "_id",
				as: "server",
			},
		},
		{
			$addFields: {
				serverName: { $arrayElemAt: ["$server.name", 0] },
				serviceTime: {
					$subtract: [
						{ $ifNull: ["$completedAt", "$updatedAt"] },
						"$createdAt",
					],
				},
			},
		},
		{
			$group: {
				_id: null,
				totalOrders: { $sum: 1 },
				totalRevenue: { $sum: "$totalAmount" },
				averageServiceTime: { $avg: "$serviceTime" },
				ordersByServer: {
					$push: {
						serverId: "$serverId",
						serverName: "$serverName",
						amount: "$totalAmount",
						serviceTime: "$serviceTime",
					},
				},
			},
		},
	];

	const [analytics] = await Order.aggregate(pipeline);

	if (!analytics) {
		return {
			totalOrders: 0,
			totalRevenue: 0,
			averageOrderValue: 0,
			averageServiceTime: 0,
			topPerformers: [],
			timeline: [],
			revenueByServer: {},
		};
	}

	// Calculer les performers
	const serverPerformance = {};
	analytics.ordersByServer.forEach((order) => {
		const serverId = order.serverId?.toString();
		if (serverId) {
			if (!serverPerformance[serverId]) {
				serverPerformance[serverId] = {
					name: order.serverName,
					totalSales: 0,
					totalOrders: 0,
					totalServiceTime: 0,
				};
			}
			serverPerformance[serverId].totalSales += order.amount;
			serverPerformance[serverId].totalOrders += 1;
			serverPerformance[serverId].totalServiceTime += order.serviceTime || 0;
		}
	});

	const topPerformers = Object.entries(serverPerformance)
		.map(([id, data]) => ({
			serverId: id,
			name: data.name,
			totalSales: data.totalSales,
			totalOrders: data.totalOrders,
			averageServiceTime: data.totalServiceTime / data.totalOrders,
		}))
		.sort((a, b) => b.totalSales - a.totalSales);

	return {
		totalOrders: analytics.totalOrders,
		totalRevenue: analytics.totalRevenue,
		averageOrderValue: analytics.totalRevenue / analytics.totalOrders,
		averageServiceTime: analytics.averageServiceTime / (1000 * 60), // en minutes
		topPerformers,
		timeline: [], // TODO: implémenter timeline détaillée
		revenueByServer: serverPerformance,
		fastestServer: topPerformers.sort(
			(a, b) => a.averageServiceTime - b.averageServiceTime,
		)[0],
		upsellRate: 15, // TODO: calculer via les add-ons
		totalAddOns: 0, // TODO: calculer
		addOnRevenue: 0, // TODO: calculer
	};
}

/**
 * Analyse des réservations
 */
async function getReservationsAnalytics(restaurantId, start, end) {
	const reservations = await Reservation.find({
		restaurantId,
		createdAt: { $gte: start, $lte: end },
	}).populate("tableId", "number");

	const tableStats = {};
	reservations.forEach((res) => {
		const tableNumber = res.tableId?.number || "Inconnue";
		if (!tableStats[tableNumber]) {
			tableStats[tableNumber] = { count: 0, revenue: 0 };
		}
		tableStats[tableNumber].count += 1;
		tableStats[tableNumber].revenue += res.totalAmount || 0;
	});

	const busiestTables = Object.entries(tableStats)
		.map(([table, stats]) => ({ table, ...stats }))
		.sort((a, b) => b.count - a.count);

	return {
		totalReservations: reservations.length,
		busiestTables,
	};
}

/**
 * Récupération des données serveurs
 */
async function getServersData(restaurantId) {
	const servers = await Server.find({ restaurantId });

	return {
		total: servers.length,
		activeCount: servers.filter((s) => s.role && s.role !== "inactive").length,
		servers: servers,
	};
}

/**
 * Analyse des messages client-serveur
 */
async function getMessagesAnalytics(restaurantId, start, end) {
	const messages = await ClientMessage.find({
		restaurantId,
		createdAt: { $gte: start, $lte: end },
	});

	const totalMessages = messages.length;
	const unreadCount = messages.filter((m) => m.status === "sent").length;

	// Calculer temps de réponse moyen
	const readMessages = messages.filter((m) => m.readAt);
	const totalResponseTime = readMessages.reduce((sum, m) => {
		return sum + (new Date(m.readAt) - new Date(m.createdAt));
	}, 0);

	const averageResponseTime =
		readMessages.length > 0
			? totalResponseTime / readMessages.length / (1000 * 60) // en minutes
			: 0;

	return {
		totalMessages,
		unreadCount,
		averageResponseTime,
		hourlyDistribution: {}, // TODO: implémenter distribution horaire
	};
}

/**
 * Récupération données tables
 */
async function getTablesData(restaurantId) {
	const tables = await Table.find({ restaurantId });
	return tables;
}

/**
 * Performance individuelle d'un serveur
 */
async function getServerPerformance(
	serverId,
	restaurantId,
	start,
	end,
	detailed = false,
) {
	const orders = await Order.find({
		serverId,
		restaurantId,
		createdAt: { $gte: start, $lte: end },
	});

	const messages = await ClientMessage.find({
		serverId,
		restaurantId,
		createdAt: { $gte: start, $lte: end },
	});

	const totalOrders = orders.length;
	const totalSales = orders.reduce(
		(sum, order) => sum + (order.totalAmount || 0),
		0,
	);
	const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

	// Temps de service moyen
	const completedOrders = orders.filter((o) => o.completedAt);
	const averageServiceTime =
		completedOrders.length > 0
			? completedOrders.reduce(
					(sum, o) => sum + (new Date(o.completedAt) - new Date(o.createdAt)),
					0,
				) /
				completedOrders.length /
				(1000 * 60)
			: 0;

	// Messages traités
	const messagesHandled = messages.filter((m) => m.readAt).length;
	const averageResponseTime =
		messages.filter((m) => m.readAt).length > 0
			? messages
					.filter((m) => m.readAt)
					.reduce(
						(sum, m) => sum + (new Date(m.readAt) - new Date(m.createdAt)),
						0,
					) /
				messages.filter((m) => m.readAt).length /
				(1000 * 60)
			: 0;

	return {
		totalOrders,
		totalSales,
		averageOrderValue,
		averageServiceTime,
		messagesHandled,
		averageResponseTime,
		efficiency: calculateServerEfficiency(
			totalOrders,
			averageServiceTime,
			messagesHandled,
		),
		...(detailed && {
			orderHistory: orders.map((o) => ({
				id: o._id,
				createdAt: o.createdAt,
				completedAt: o.completedAt,
				amount: o.totalAmount,
				serviceTime: o.completedAt
					? new Date(o.completedAt) - new Date(o.createdAt)
					: null,
			})),
		}),
	};
}

/**
 * Génère des recommandations de coaching
 */
function generateCoachingRecommendations(serversAnalysis) {
	const recommendations = [];

	serversAnalysis.forEach((server) => {
		const perf = server.performance;

		// Service trop lent
		if (perf.averageServiceTime > 30) {
			recommendations.push({
				serverId: server._id,
				serverName: server.name,
				type: "speed",
				priority: "high",
				message: `Temps de service élevé (${Math.round(perf.averageServiceTime)}min). Formation sur l'efficacité recommandée.`,
			});
		}

		// Peu de ventes
		if (perf.totalOrders < 10) {
			recommendations.push({
				serverId: server._id,
				serverName: server.name,
				type: "volume",
				priority: "medium",
				message: `Volume de commandes faible (${perf.totalOrders}). Coaching sur prospection suggéré.`,
			});
		}

		// Réponses lentes aux messages
		if (perf.averageResponseTime > 10) {
			recommendations.push({
				serverId: server._id,
				serverName: server.name,
				type: "communication",
				priority: "medium",
				message: `Temps de réponse aux clients élevé (${Math.round(perf.averageResponseTime)}min).`,
			});
		}
	});

	return recommendations;
}

/**
 * Calcule l'efficacité d'un serveur
 */
function calculateServerEfficiency(orders, serviceTime, messagesHandled) {
	// Score basé sur volume, rapidité et réactivité
	let score = 0;

	// Volume (40% du score)
	score += Math.min(orders / 10, 1) * 40;

	// Rapidité (40% du score) - inverse du temps de service
	if (serviceTime > 0) {
		score += Math.max(0, 1 - serviceTime / 30) * 40;
	}

	// Réactivité messages (20% du score)
	score += Math.min(messagesHandled / 5, 1) * 20;

	return Math.round(score);
}

/**
 * Génère un leaderboard selon la métrique
 */
async function generateLeaderboard(restaurantId, start, end, metric) {
	const servers = await Server.find({ restaurantId });

	const leaderboard = await Promise.all(
		servers.map(async (server) => {
			const performance = await getServerPerformance(
				server._id,
				restaurantId,
				start,
				end,
			);
			return {
				serverId: server._id,
				name: server.name,
				value: performance[getMetricField(metric)],
				performance,
			};
		}),
	);

	// Trier selon la métrique
	leaderboard.sort((a, b) => {
		if (metric === "speed") {
			return a.value - b.value; // Plus rapide = meilleur
		}
		return b.value - a.value; // Plus grand = meilleur
	});

	return leaderboard.map((item, index) => ({
		...item,
		rank: index + 1,
	}));
}

/**
 * Mapping métrique vers champ
 */
function getMetricField(metric) {
	const mapping = {
		sales: "totalSales",
		orders: "totalOrders",
		speed: "averageServiceTime",
		upsells: "totalSales", // TODO: calculer upsells réels
		satisfaction: "efficiency",
	};
	return mapping[metric] || "totalSales";
}

/**
 * Calcule les tendances sur 3 mois
 */
async function calculateTrends(restaurantId) {
	// TODO: Implémenter calcul détaillé des tendances
	return {
		weekly: [],
		monthly: [],
		seasonality: {},
	};
}

/**
 * Génère un rapport complet
 */
async function generateFullReport(restaurantId, start, end) {
	// TODO: Implémenter génération de rapport complet
	return {
		summary: {},
		servers: [],
		tables: [],
		trends: {},
	};
}

/**
 * Convertit en CSV
 */
function convertToCSV(data) {
	// TODO: Implémenter conversion CSV
	return "TODO: CSV Export";
}

/**
 * Calcule les dates de la période précédente
 */
function getPreviousPeriodDates(start, end) {
	const duration = end.getTime() - start.getTime();
	return {
		start: new Date(start.getTime() - duration),
		end: new Date(start.getTime()),
	};
}

/**
 * Calcule la croissance en pourcentage
 */
function calculateGrowth(current, previous, inverse = false) {
	if (!previous || previous === 0) return 0;
	const growth = ((current - previous) / previous) * 100;
	return inverse ? -growth : growth;
}

/**
 * Calcule la rotation des tables
 */
function calculateTableTurnover(tablesData, reservationsData) {
	// TODO: Implémenter calcul de rotation
	return {
		average: 2.5,
		byTable: {},
	};
}

/**
 * Calcule l'occupation des tables
 */
function calculateTableOccupancy(reservationsData, tablesData) {
	// TODO: Implémenter calcul d'occupation
	return {
		current: 65,
		peak: 85,
		byHour: {},
	};
}

module.exports = router;
