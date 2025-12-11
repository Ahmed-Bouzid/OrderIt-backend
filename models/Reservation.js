const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
	{
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: false,
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

		// ⭐⭐ NOUVEAU : Liste des commandes liées à cette réservation ⭐⭐
		orderIds: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Order",
				index: true,
			},
		],

		status: {
			type: String,
			enum: ["ouverte", "fermee", "annulee", "en attente"],
			default: "en attente",
			index: true,
		},
		clientName: { type: String, required: true, trim: true },
		nbPersonnes: { type: Number, default: 1 },
		reservationDate: { type: Date, required: true },
		reservationTime: { type: String, default: "" },
		arrivalTime: { type: Date },
		reservationSource: {
			type: String,
			enum: ["Sur place", "À distance", "Sans réservation"],
			default: "Sur place",
		},

		allergies: { type: String, default: "" },
		restrictions: { type: String, default: "" },
		notes: { type: String, default: "" },

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

		isPresent: { type: Boolean, default: false },
		canceled: { type: Boolean, default: false },
		canceledAt: { type: Date },

		createdAt: { type: Date, default: Date.now, index: true },
		updatedAt: { type: Date, default: Date.now },
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
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
	match: { status: "paid" },
});

// ⭐⭐ VIRTUEL : Récupérer les commandes impayées
reservationSchema.virtual("unpaidOrders", {
	ref: "Order",
	localField: "orderIds",
	foreignField: "_id",
	justOne: false,
	match: { status: { $in: ["pending", "unpaid"] } },
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

				if (order.status === "paid") {
					paid += orderTotal;
				}
			});

			this.totalAmount = total;
			this.paidAmount = paid;
			this.remainingAmount = total - paid;

			// Mettre à jour le statut automatiquement
			if (this.remainingAmount <= 0 && this.totalAmount > 0) {
				this.status = "fermee"; // Tout payé = fermée
			} else if (this.status === "fermee" && this.remainingAmount > 0) {
				this.status = "ouverte"; // Ré-ouvrir si encore des impayés
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

		return orders.every((order) => order.status === "paid");
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
			if (order.status !== "paid") {
				remaining += order.totalAmount || 0;
			}
		});

		return remaining;
	} catch (error) {
		console.error("Erreur calcul montant restant:", error);
		return 0;
	}
};

// Index pour retrouver rapidement toutes les réservations d'une table ou d'un restaurant
reservationSchema.index({ tableId: 1, reservationDate: 1 });
reservationSchema.index({ restaurantId: 1, reservationDate: 1 });
reservationSchema.index({ orderIds: 1 }); // ⭐ NOUVEAU index pour les orderIds

module.exports = mongoose.model("Reservation", reservationSchema);
