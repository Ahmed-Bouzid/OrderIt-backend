const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const Order = require("../models/Order");

// GET /accounting/summary - Résumé comptable pour admin/manager
router.get("/summary", auth, checkRoles(["admin", "manager", "developer"]), async (req, res) => {
	try {
		console.log("💰 [ACCOUNTING] Génération résumé comptable pour:", req.user.email);
		
		const { restaurantId } = req.user;
		const today = new Date();
		const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

		// Récupérer toutes les commandes du jour pour le restaurant
		const todaysOrders = await Order.find({
			restaurantId: restaurantId,
			createdAt: { $gte: startOfDay, $lt: endOfDay },
			status: { $ne: "cancelled" }
		});

		console.log(`📊 [ACCOUNTING] Commandes trouvées pour aujourd'hui: ${todaysOrders.length}`);

		// Calculs
		const totalRevenue = todaysOrders.reduce((sum, order) => sum + (order.total || 0), 0);
		const totalOrders = todaysOrders.length;
		const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

		// Produit le plus commandé (simplifié)
		const itemCounts = {};
		todaysOrders.forEach(order => {
			order.items?.forEach(item => {
				const productName = item.productName || item.name || "Produit inconnu";
				itemCounts[productName] = (itemCounts[productName] || 0) + (item.quantity || 1);
			});
		});

		const topProduct = Object.keys(itemCounts).length > 0 
			? Object.keys(itemCounts).reduce((a, b) => itemCounts[a] > itemCounts[b] ? a : b)
			: "Aucun produit";

		// Revenus du mois
		const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const monthlyOrders = await Order.find({
			restaurantId: restaurantId,
			createdAt: { $gte: startOfMonth, $lt: endOfDay },
			status: { $ne: "cancelled" }
		});
		
		const monthlyRevenue = monthlyOrders.reduce((sum, order) => sum + (order.total || 0), 0);

		const result = {
			success: true,
			data: {
				totalRevenue: Number(totalRevenue.toFixed(2)),
				totalOrders: totalOrders,
				averageOrderValue: Number(averageOrderValue.toFixed(2)),
				topProduct: topProduct,
				monthlyRevenue: Number(monthlyRevenue.toFixed(2)),
				period: "today",
				date: today.toISOString().split('T')[0]
			}
		};

		console.log("✅ [ACCOUNTING] Résumé généré:", result.data);
		res.json(result);

	} catch (error) {
		console.error("❌ [ACCOUNTING] Erreur génération résumé:", error);
		res.status(500).json({
			success: false,
			message: "Erreur lors de la génération du résumé comptable",
			error: error.message
		});
	}
});

// GET /accounting/details - Détails avancés pour export
router.get("/details", auth, checkRoles(["admin", "developer"]), async (req, res) => {
	try {
		const { restaurantId } = req.user;
		const { period = "today", startDate, endDate } = req.query;

		let dateFilter = {};
		if (period === "today") {
			const today = new Date();
			const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
			dateFilter = { createdAt: { $gte: startOfDay, $lt: endOfDay } };
		} else if (startDate && endDate) {
			dateFilter = { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } };
		}

		const orders = await Order.find({
			restaurantId: restaurantId,
			...dateFilter,
			status: { $ne: "cancelled" }
		}).sort({ createdAt: -1 });

		const details = orders.map(order => ({
			orderId: order._id,
			date: order.createdAt,
			total: order.total,
			items: order.items,
			status: order.status,
			tableId: order.tableId,
			serverId: order.serverId
		}));

		res.json({
			success: true,
			data: {
				orders: details,
				total: details.reduce((sum, order) => sum + order.total, 0),
				count: details.length
			}
		});

	} catch (error) {
		console.error("❌ [ACCOUNTING] Erreur récupération détails:", error);
		res.status(500).json({
			success: false,
			message: "Erreur lors de la récupération des détails",
			error: error.message
		});
	}
});

module.exports = router;