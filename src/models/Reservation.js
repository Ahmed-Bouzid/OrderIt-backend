const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
	{
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: false,
			index: true,
		},
		// ⭐ Multi-tables (grands groupes) — array de tables
		tableIds: [{
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
		}],
		// ⭐ Réassignation de table (CAS 13 — conflit overbooking)
		originalTableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			default: null,
		},
		actualTableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			default: null,
		},
		reassignReason: {
			type: String,
			default: null,
		},
		// ⭐ Link vers TableSession (quand client arrive)
		tableSessionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "TableSession",
			default: null,
			index: true,
		},
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
			index: true,
		},

		// ⭐ Nom du serveur/admin qui a ouvert la réservation (dénormalisé pour affichage)
		openedBy: {
			type: String,
			default: null,
		},

		// ⭐⭐ NOUVEAU : Liste des commandes liées à cette réservation ⭐⭐
		orderIds: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Order",
			},
		],

		status: {
			type: String,
			enum: ["pending", "confirmed", "completed", "cancelled", "no_show"],
			default: "pending",
			index: true,
		},
		clientName: { type: String, required: true, trim: true },
		phone: { type: String, default: "" },
		email: { type: String, default: "", trim: true, lowercase: true },
		nbPersonnes: { type: Number, default: 1 },
		reservationDate: { type: Date, required: true },
		reservationTime: { type: String, default: "" },
		arrivalTime: { type: Date },
		reservationSource: {
			type: String,
			enum: ["on_site", "online", "walk_in", "Sur place"],
			default: "on_site",
		},

		allergies: { type: String, default: "" },
		restrictions: { type: String, default: "" },
		notes: { type: String, default: "" },

		// ⭐ Notes staff (visibles uniquement côté serveur/admin)
		staffNotes: { type: String, default: "" },
		staffNotesUpdatedAt: { type: Date },

		orderSummary: { type: String, default: "" },
		dishStatus: {
			type: String,
			enum: ["En attente", "En cours", "Annulé", "Terminé"],
			default: "En attente",
		},

		paymentMethod: {
			type: String,
			enum: ["Carte", "Espèces", "Autre"],
			default: "Autre",
		},

		// ⭐⭐ MIS À JOUR : Calculé dynamiquement depuis les commandes
		totalAmount: { type: Number, default: 0 },
		paidAmount: { type: Number, default: 0 }, // Montant déjà payé
		remainingAmount: { type: Number, default: 0 }, // Montant restant à payer

		// 🛡️ Lock pessimiste "payeur de toute la table"
		// Un seul client à la fois peut payer les items des autres.
		// Le lock expire automatiquement (TTL ~5 min) pour ne pas bloquer la table.
		paymentLock: {
			clientId: { type: String, default: null },
			clientName: { type: String, default: null },
			lockedAt: { type: Date, default: null },
			expiresAt: { type: Date, default: null },
		},

		isPresent: { type: Boolean, default: false },
		canceled: { type: Boolean, default: false },
		canceledAt: { type: Date },

		// ⭐⭐ NOUVEAU : Historique d'audit des modifications
		auditLog: [
			{
				timestamp: { type: Date, default: Date.now },
				action: {
					type: String,
					enum: [
						"created",
						"created_client",
						"joined",
						"table_assigned",
						"table_changed",
						"table_released",
						"status_changed",
						"payment",
						"order_sent",
						"present_changed",
						"cancelled",
						"auto_cancelled",
						"closed_client",
						"deleted",
						"dish_status_changed",
						"field_updated",
					],
				},
				userId: { type: mongoose.Schema.Types.ObjectId },
				userType: { type: String, enum: ["server", "admin", "system"] },
				userName: { type: String },
				message: { type: String },
				metadata: { type: mongoose.Schema.Types.Mixed },
			},
		],

		createdAt: { type: Date, default: Date.now, index: true },
		updatedAt: { type: Date, default: Date.now },
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	},
);

// ⭐⭐ VIRTUEL : Récupérer toutes les commandes avec populate
reservationSchema.virtual("orders", {
	ref: "Order",
	localField: "orderIds",
	foreignField: "_id",
	justOne: false,
});

// ⭐⭐ VIRTUEL : Récupérer les commandes payées
reservationSchema.virtual("paidOrders", {
	ref: "Order",
	localField: "orderIds",
	foreignField: "_id",
	justOne: false,
	match: { paymentStatus: "paid" },
});

// ⭐⭐ VIRTUEL : Récupérer les commandes impayées
reservationSchema.virtual("unpaidOrders", {
	ref: "Order",
	localField: "orderIds",
	foreignField: "_id",
	justOne: false,
	match: { paymentStatus: { $in: ["unpaid", "partially_paid"] } },
});

// ⭐⭐ MIDDLEWARE : Mettre à jour les montants avant sauvegarde
reservationSchema.pre("save", async function (next) {
	// Mettre à jour la date de modification
	this.updatedAt = Date.now();

	// Si on a des orderIds, on peut calculer les montants
	if (this.orderIds && this.orderIds.length > 0) {
		try {
			const Order = mongoose.model("Order");
			const orders = await Order.find({ _id: { $in: this.orderIds } });

			// Calculer les montants
			let total = 0;
			let paid = 0;

			orders.forEach((order) => {
				const orderTotal = order.totalAmount || 0;
				total += orderTotal;
				// Correction : on vérifie paymentStatus (Order n'a pas de champ 'status')
				if (order.paymentStatus === "paid") {
					paid += orderTotal;
				}
			});

			this.totalAmount = total;
			this.paidAmount = paid;
			this.remainingAmount = total - paid;

			// Mettre à jour le statut automatiquement
			if (this.remainingAmount <= 0 && this.totalAmount > 0) {
			this.status = "completed"; // Tout payé = completed
			this.isPresent = false; // ⭐ RÈGLE MÉTIER: isPresent=false si completed
		} else if (this.status === "completed" && this.remainingAmount > 0) {
			this.status = "confirmed"; // Ré-ouvrir si encore des impayés
			}
		} catch (error) {
			console.error("Erreur calcul montants réservation:", error);
		}
	}

	next();
});

// ⭐⭐ MÉTHODE : Ajouter une commande à la réservation
reservationSchema.methods.addOrder = function (orderId) {
	if (!this.orderIds.includes(orderId)) {
		this.orderIds.push(orderId);
		return this.save();
	}
	return Promise.resolve(this);
};

// ⭐⭐ MÉTHODE : Retirer une commande de la réservation
reservationSchema.methods.removeOrder = function (orderId) {
	const index = this.orderIds.indexOf(orderId);
	if (index > -1) {
		this.orderIds.splice(index, 1);
		return this.save();
	}
	return Promise.resolve(this);
};

// ⭐⭐ MÉTHODE : Vérifier si toutes les commandes sont payées
reservationSchema.methods.areAllOrdersPaid = async function () {
	try {
		const Order = mongoose.model("Order");
		const orders = await Order.find({ _id: { $in: this.orderIds } });

		if (orders.length === 0) return false;

		return orders.every((order) => order.paymentStatus === "paid");
	} catch (error) {
		console.error("Erreur vérification paiement:", error);
		return false;
	}
};

// ⭐⭐ MÉTHODE : Calculer le montant restant
reservationSchema.methods.calculateRemainingAmount = async function () {
	try {
		const Order = mongoose.model("Order");
		const orders = await Order.find({ _id: { $in: this.orderIds } });

		let remaining = 0;
		orders.forEach((order) => {
			if (order.paymentStatus !== "paid") {
				remaining += order.totalAmount || 0;
			}
		});

		return remaining;
	} catch (error) {
		console.error("Erreur calcul montant restant:", error);
		return 0;
	}
};

// ⭐⭐ MÉTHODE : Ajouter une entrée d'audit
reservationSchema.methods.addAuditEntry = function ({
	action,
	userId,
	userType,
	userName,
	message,
	metadata,
}) {
	if (!this.auditLog) this.auditLog = [];

	this.auditLog.push({
		timestamp: new Date(),
		action,
		userId,
		userType: userType || "system",
		userName: userName || "Système",
		message,
		metadata: metadata || {},
	});

	return this;
};

// Index pour retrouver rapidement toutes les réservations d'une table ou d'un restaurant
reservationSchema.index({ tableId: 1, reservationDate: 1 });
reservationSchema.index({ restaurantId: 1, reservationDate: 1 });
reservationSchema.index({ orderIds: 1 }); // ⭐ NOUVEAU index pour les orderIds

module.exports = mongoose.model("Reservation", reservationSchema);
