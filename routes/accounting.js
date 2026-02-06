const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const auth = require('../middlewares/auth');
const checkRoles = require('../middlewares/checkRoles');

// 🔐 Middleware sécurité : Admin/Developer uniquement
const requireAccountingAccess = [auth, checkRoles(['admin', 'developer'])];

// 📊 GET /accounting/summary - Résumé comptable global
router.get('/summary', requireAccountingAccess, async (req, res) => {
	try {
		const { startDate, endDate, restaurantId } = req.query;
		
		// Filtres de base
		const dateFilter = {};
		if (startDate && endDate) {
			dateFilter.createdAt = {
				$gte: new Date(startDate),
				$lte: new Date(endDate)
			};
		}
		
		const restaurantFilter = restaurantId ? { restaurantId } : {};
		const baseFilter = { ...dateFilter, ...restaurantFilter };

		// 🟢 Commandes payées
		const paidOrders = await Order.find({
			...baseFilter,
			status: 'paid'
		});

		// 🟡 Commandes offertes (remise 100%)
		const offeredOrders = await Order.find({
			...baseFilter,
			status: 'paid',
			discount: { $gte: 100 }
		});

		// 🔴 Commandes annulées
		const cancelledOrders = await Order.find({
			...baseFilter,
			status: 'cancelled'
		});

		// 🔵 Commandes en cours
		const pendingOrders = await Order.find({
			...baseFilter,
			status: { $in: ['pending', 'confirmed', 'preparing'] }
		});

		// Calculs totaux
		const paidTotal = paidOrders.reduce((sum, order) => sum + (order.total || 0), 0);
		const offeredTotal = offeredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
		const cancelledTotal = cancelledOrders.reduce((sum, order) => sum + (order.total || 0), 0);
		const pendingTotal = pendingOrders.reduce((sum, order) => sum + (order.total || 0), 0);

		// Moyenne panier (commandes payées)
		const avgBasket = paidOrders.length > 0 ? paidTotal / paidOrders.length : 0;

		// Taux de transformation
		const totalOrders = paidOrders.length + cancelledOrders.length;
		const conversionRate = totalOrders > 0 ? (paidOrders.length / totalOrders) * 100 : 0;

		// Ventes par jour (derniers 7 jours pour graphique)
		const last7Days = [];
		for (let i = 6; i >= 0; i--) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			date.setHours(0, 0, 0, 0);
			
			const nextDate = new Date(date);
			nextDate.setDate(nextDate.getDate() + 1);

			const dayOrders = await Order.find({
				...restaurantFilter,
				status: 'paid',
				createdAt: { $gte: date, $lt: nextDate }
			});

			const dayTotal = dayOrders.reduce((sum, order) => sum + (order.total || 0), 0);
			
			last7Days.push({
				date: date.toISOString().split('T')[0],
				sales: dayTotal,
				orders: dayOrders.length
			});
		}

		res.json({
			success: true,
			summary: {
				paid: {
					total: paidTotal,
					count: paidOrders.length,
					average: avgBasket
				},
				offered: {
					total: offeredTotal,
					count: offeredOrders.length
				},
				cancelled: {
					total: cancelledTotal,
					count: cancelledOrders.length
				},
				pending: {
					total: pendingTotal,
					count: pendingOrders.length
				},
				metrics: {
					conversionRate,
					netRevenue: paidTotal - offeredTotal
				},
				charts: {
					last7Days
				}
			}
		});

	} catch (error) {
		console.error('❌ Erreur summary comptabilité:', error);
		res.status(500).json({ 
			success: false, 
			message: 'Erreur lors du calcul du résumé comptable',
			error: error.message 
		});
	}
});

// 📋 GET /accounting/details - Détails produit par produit
router.get('/details', requireAccountingAccess, async (req, res) => {
	try {
		const { startDate, endDate, category, status, paymentMethod, restaurantId } = req.query;
		
		// Filtres
		const dateFilter = {};
		if (startDate && endDate) {
			dateFilter.createdAt = {
				$gte: new Date(startDate),
				$lte: new Date(endDate)
			};
		}

		const baseFilter = { ...dateFilter };
		if (restaurantId) baseFilter.restaurantId = restaurantId;
		if (status) baseFilter.status = status;
		if (paymentMethod) baseFilter.paymentMethod = paymentMethod;

		// Récupération des commandes
		const orders = await Order.find(baseFilter).populate('items.productId');

		// Agrégation par produit
		const productStats = {};

		for (const order of orders) {
			if (!order.items) continue;

			for (const item of order.items) {
				const productId = item.productId?._id?.toString() || item.productId;
				const productName = item.productId?.name || item.name || 'Produit inconnu';
				const productCategory = item.productId?.category || item.category || 'Autres';
				const unitPrice = item.price || item.unitPrice || 0;
				const quantity = item.quantity || 1;

				if (!productStats[productId]) {
					productStats[productId] = {
						name: productName,
						category: productCategory,
						unitPrice,
						totalQuantity: 0,
						totalRevenue: 0,
						orders: {
							paid: 0,
							offered: 0,
							cancelled: 0
						},
						paymentMethods: {}
					};
				}

				const stats = productStats[productId];
				stats.totalQuantity += quantity;
				stats.totalRevenue += unitPrice * quantity;

				// Comptage par statut
				if (order.status === 'paid') {
					if (order.discount >= 100) {
						stats.orders.offered += 1;
					} else {
						stats.orders.paid += 1;
					}
				} else if (order.status === 'cancelled') {
					stats.orders.cancelled += 1;
				}

				// Comptage par méthode de paiement
				if (order.paymentMethod) {
					stats.paymentMethods[order.paymentMethod] = 
						(stats.paymentMethods[order.paymentMethod] || 0) + 1;
				}
			}
		}

		// Conversion en array et tri
		const details = Object.entries(productStats).map(([id, stats]) => ({
			productId: id,
			...stats
		})).sort((a, b) => b.totalRevenue - a.totalRevenue);

		// Filtrage par catégorie si demandé
		const filteredDetails = category ? 
			details.filter(item => item.category.toLowerCase().includes(category.toLowerCase())) : 
			details;

		res.json({
			success: true,
			details: filteredDetails,
			total: filteredDetails.length
		});

	} catch (error) {
		console.error('❌ Erreur details comptabilité:', error);
		res.status(500).json({ 
			success: false, 
			message: 'Erreur lors du calcul des détails comptables',
			error: error.message 
		});
	}
});

// 📥 GET /accounting/export - Export PDF/CSV
router.get('/export', requireAccountingAccess, async (req, res) => {
	try {
		const { format = 'csv', ...filters } = req.query;

		// Récupération des données (réutilise la logique /details)
		const detailsReq = { query: filters };
		const detailsRes = { 
			json: (data) => data,
			status: () => ({ json: (data) => data })
		};

		// Simulation d'appel interne (à optimiser)
		const detailsResult = await new Promise((resolve) => {
			// Ici on devrait refactoriser pour partager la logique
			// Pour l'instant, retour simple
			resolve({
				success: true,
				details: [],
				exportInfo: {
					format,
					generated: new Date().toISOString(),
					filters
				}
			});
		});

		if (format === 'csv') {
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', `attachment; filename="comptabilite_${new Date().toISOString().split('T')[0]}.csv"`);
			
			// CSV Header
			let csv = 'Produit,Catégorie,Quantité,Prix unitaire,Total,Payées,Offertes,Annulées\n';
			
			// CSV Rows (placeholder - à implémenter avec vraies données)
			csv += 'Burger Classic,Plats,15,12.00,180.00,10,3,2\n';
			csv += 'Soda Cola,Boissons,22,3.00,66.00,20,2,0\n';
			
			res.send(csv);
		} else {
			// Format JSON par défaut
			res.json(detailsResult);
		}

	} catch (error) {
		console.error('❌ Erreur export comptabilité:', error);
		res.status(500).json({ 
			success: false, 
			message: 'Erreur lors de l\'export comptable',
			error: error.message 
		});
	}
});

module.exports = router;