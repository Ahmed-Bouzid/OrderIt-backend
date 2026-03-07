const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
	{
		// ⭐⭐ RELATION ESSENTIELLE : Une commande appartient à une réservation
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: true,
			index: true,
		},

		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: false, // Optionnel pour les commandes fast-food sans table
			default: null,
			index: true,
		},
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
			index: true,
		},

		// ⭐⭐ CLIENT qui a créé la commande (pour les commandes client)
		clientId: {
			type: String,
			ref: "Client",
			required: false,
			index: true,
		},
		clientName: {
			type: String,
			required: false,
			trim: true,
		},
		clientPhone: {
			type: String,
			required: false,
			trim: true,
		},

		items: [
			{
				productId: {
					type: mongoose.Schema.Types.ObjectId,
					ref: "Product",
					required: false,
				},
				name: { type: String, required: true },
				quantity: {
					type: Number,
					required: true,
					min: 1,
					validate: {
						validator: Number.isInteger,
						message: "La quantité doit être un entier positif",
					},
				},
				price: {
					type: Number,
					required: true,
					min: 0,
				},
				notes: {
					type: String,
					default: "",
				},
				// ⭐⭐ Catégorie de l'item pour le plan de salle (dynamique)
				category: {
					type: String,
					required: true,
					trim: true,
					lowercase: true, // Normaliser les catégories
					default: "autre",
					validate: {
						validator: function (value) {
							// Validation simple : accepter toute chaîne non vide
							return value && value.trim().length > 0;
						},
						message: "La catégorie ne peut pas être vide",
					},
				},
				// ⭐⭐ Statut de l'article pour la cuisine (ajout de "confirmed")
				itemStatus: {
					type: String,
					enum: ["confirmed", "preparing", "ready", "served", "cancelled"],
					default: "confirmed",
				},
				// ⭐⭐ Timer pour le plan de salle
				startTime: {
					type: Date,
					required: false,
				},
				endTime: {
					type: Date,
					required: false,
				},
			},
		],

		// ⭐⭐ RENOMMÉ : totalAmount au lieu de total pour cohérence
		totalAmount: {
			type: Number,
			required: true,
			min: 0,
			default: 0,
		},

		// ⭐⭐ AMÉLIORÉ : Gestion du paiement avec plus de détails
		paymentStatus: {
			type: String,
			enum: ["unpaid", "partially_paid", "paid", "refunded"],
			default: "unpaid",
			index: true,
		},

		paidAmount: {
			type: Number,
			default: 0,
			min: 0,
		},

		paid: {
			type: Boolean,
			default: false,
			index: true,
		},

		tip: {
			type: Number,
			default: 0,
			min: 0,
		},

		paidBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: false,
		},

		paidAt: {
			type: Date,
			required: false,
		},

		// ⭐⭐ Statut de la commande (cuisine/service)
		orderStatus: {
			type: String,
			enum: [
				"pending",
				"confirmed",
				"in_progress",
				"ready",
				"completed",
				"cancelled",
			],
			default: "pending",
			index: true,
		},

		// ⭐⭐ Urgence de la commande (pour Express Orders)
		isUrgent: {
			type: Boolean,
			default: false,
			index: true,
		},

		paymentMethod: {
			type: String,
			enum: ["cash", "card", "app", "split"],
			default: "cash",
		},

		notes: {
			type: String,
			default: "",
		},

		// ⭐⭐ Origine de la commande
		origin: {
			type: String,
			enum: ["client", "server", "admin"],
			default: "server",
			index: true,
		},

		// ⭐⭐ Commande préparée et servie (foodtrucks uniquement)
		isMade: {
			type: Boolean,
			default: false,
			index: true,
		},

		// ⭐⭐ Pour le split payment
		splitDetails: [
			{
				clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
				clientName: { type: String },
				amount: { type: Number, min: 0 },
				paid: { type: Boolean, default: false },
			},
		],

		// ⭐⭐ Pour tracking
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: false,
		},

		// ⭐⭐ Dates importantes
		confirmedAt: { type: Date },
		completedAt: { type: Date },
		cancelledAt: { type: Date },
	},
	{
		timestamps: true,
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	},
);

// ⭐⭐ VIRTUEL : Récupérer la réservation associée
orderSchema.virtual("reservation", {
	ref: "Reservation",
	localField: "reservationId",
	foreignField: "_id",
	justOne: true,
});

// ⭐⭐ VIRTUEL : Récupérer le client associé
orderSchema.virtual("client", {
	ref: "Client",
	localField: "clientId",
	foreignField: "_id",
	justOne: true,
});

// ⭐⭐ Index composés
orderSchema.index({ restaurantId: 1, orderStatus: 1 });
orderSchema.index({ tableId: 1, createdAt: -1 });
orderSchema.index({ reservationId: 1, createdAt: -1 }); // ⭐ NOUVEAU
orderSchema.index({ clientId: 1, createdAt: -1 }); // ⭐ NOUVEAU
orderSchema.index({ paymentStatus: 1, createdAt: -1 }); // ⭐ NOUVEAU

// ⭐⭐ VALIDATION : Calcul automatique du total
orderSchema.pre("save", function (next) {
	if (this.isModified("items") && this.items.length > 0) {
		const calculatedTotal = this.items.reduce(
			(sum, item) => sum + item.price * item.quantity,
			0,
		);

		// Mettre à jour le totalAmount
		this.totalAmount = calculatedTotal;

		// Mettre à jour le statut de paiement
		if (this.paidAmount >= this.totalAmount && this.totalAmount > 0) {
			this.paymentStatus = "paid";
			this.paid = true;
		} else if (this.paidAmount > 0 && this.paidAmount < this.totalAmount) {
			this.paymentStatus = "partially_paid";
			this.paid = false;
		} else {
			this.paymentStatus = "unpaid";
			this.paid = false;
		}
	}

	// Mettre à jour la date de confirmation
	if (
		this.isModified("orderStatus") &&
		this.orderStatus === "confirmed" &&
		!this.confirmedAt
	) {
		this.confirmedAt = new Date();
	}

	// Mettre à jour la date de complétion
	if (
		this.isModified("orderStatus") &&
		this.orderStatus === "completed" &&
		!this.completedAt
	) {
		this.completedAt = new Date();
	}

	// Mettre à jour la date d'annulation
	if (
		this.isModified("orderStatus") &&
		this.orderStatus === "cancelled" &&
		!this.cancelledAt
	) {
		this.cancelledAt = new Date();
	}

	next();
});

// ⭐⭐ MIDDLEWARE POST-SAVE : Mettre à jour la réservation après création/modification d'une commande
orderSchema.post("save", async function (doc) {
	try {
		if (doc.reservationId) {
			const Reservation = mongoose.model("Reservation");
			const reservation = await Reservation.findById(doc.reservationId);

			if (reservation) {
				// Ajouter l'order à la réservation si pas déjà présent
				const isNewOrder = !reservation.orderIds.includes(doc._id);
				if (isNewOrder) {
					reservation.orderIds.push(doc._id);
				}

				// ⭐ Audit : commande envoyée (uniquement pour les nouvelles commandes)
				if (isNewOrder) {
					try {
						const { addAudit } = require("../utils/auditHelper");
						// Récupérer le nom de l'utilisateur depuis la BDD
						let userName = "Système";
						let userType = "system";
						let userId = null;

						if (doc.serverId) {
							const Server = mongoose.model("Server");
							const server = await Server.findById(doc.serverId)
								.select("name")
								.lean();
							if (server) {
								userName = server.name || "Staff";
								userType = "server";
								userId = doc.serverId;
							} else {
								// Peut être un admin (serverId = adminId)
								const Admin = mongoose.model("Admin");
								const admin = await Admin.findById(doc.serverId)
									.select("name")
									.lean();
								userName = admin?.name || "Staff";
								userType = admin ? "admin" : "server";
								userId = doc.serverId;
							}
						} else if (doc.origin === "client") {
							userName = doc.clientName || "Client";
							userType = "system";
						}

						await addAudit(
							reservation,
							"order_sent",
							{ id: userId, type: userType, name: userName },
							{
								orderItems: doc.items,
								total: doc.totalAmount,
								orderId: doc._id,
							},
						);
					} catch (auditErr) {
						console.error("⚠️ Erreur audit order_sent:", auditErr.message);
					}
				}

				// Sauvegarder la réservation (le middleware pre('save') de Reservation calculera automatiquement totalAmount)
				await reservation.save();

				// ⭐ Émettre événement WebSocket pour notifier les clients
				const { emitReservationEvent } = require("../utils/socketEmitter");
				const io = require("../start").io;
				if (io && reservation.restaurantId) {
					emitReservationEvent(
						io,
						reservation.restaurantId.toString(),
						"updated",
						reservation,
					);
				}
			}
		}
	} catch (error) {
		console.error("❌ Erreur mise à jour réservation après commande:", error);
	}
});

// ⭐⭐ MÉTHODE : Ajouter un paiement
orderSchema.methods.addPayment = function (
	amount,
	method = "cash",
	paidBy = null,
) {
	this.paidAmount += amount;

	if (this.paidAmount >= this.totalAmount) {
		this.paymentStatus = "paid";
		this.paid = true;
		this.paidAt = new Date();
		this.paymentMethod = method;
		if (paidBy) this.paidBy = paidBy;
	} else if (this.paidAmount > 0) {
		this.paymentStatus = "partially_paid";
		this.paid = false;
	}

	return this.save();
};

// ⭐⭐ MÉTHODE : Vérifier si la commande est complètement payée
orderSchema.methods.isFullyPaid = function () {
	return this.paymentStatus === "paid" && this.paid === true;
};

// ⭐⭐ MÉTHODE : Récupérer le montant restant à payer
orderSchema.methods.getRemainingAmount = function () {
	return Math.max(0, this.totalAmount - this.paidAmount);
};

// ⭐⭐ MIDDLEWARE : Normaliser les catégories avant sauvegarde
orderSchema.pre("save", async function (next) {
	if (this.items && this.items.length > 0) {
		for (let item of this.items) {
			if (item.category) {
				// Normaliser la catégorie
				item.category = item.category.toLowerCase().trim();

				// Mapper les variations communes
				const categoryMapping = {
					nouveautés: "nouveautes",
					"nouveautes tiramisu": "nouveautes",
					"nouveautés tiramisu": "nouveautes",
					entrée: "entree",
					entrées: "entree",
					boissons: "boisson",
					desserts: "dessert",
					plats: "plat",
					principal: "plat",
					main: "plat",
				};

				// Appliquer le mapping si trouvé
				if (categoryMapping[item.category]) {
					item.category = categoryMapping[item.category];
				}
			}
		}
	}
	next();
});

// ⭐⭐ MÉTHODE STATIQUE : Récupérer toutes les catégories d'un restaurant
orderSchema.statics.getRestaurantCategories = async function (restaurantId) {
	const Product = mongoose.model("Product");

	try {
		const categories = await Product.distinct("category", {
			restaurantId: restaurantId,
			isAvailable: true,
		});

		// Ajouter les catégories de base si elles n'existent pas
		const baseCategories = ["autre", "boisson", "entree", "plat", "dessert"];
		const allCategories = [...new Set([...categories, ...baseCategories])];

		return allCategories.filter((cat) => cat && cat.trim() !== "");
	} catch (error) {
		console.error("❌ Erreur récupération catégories restaurant:", error);
		return ["autre", "boisson", "entree", "plat", "dessert"];
	}
};

// ⭐⭐ MÉTHODE STATIQUE : Trouver les commandes d'une réservation
orderSchema.statics.findByReservation = function (reservationId) {
	return this.find({ reservationId })
		.populate("reservation")
		.sort({ createdAt: -1 })
		.maxTimeMS(10000);
};

// ⭐⭐ MÉTHODE STATIQUE : Trouver les commandes non payées d'une réservation
orderSchema.statics.findUnpaidByReservation = function (reservationId) {
	return this.find({
		reservationId,
		paymentStatus: { $in: ["unpaid", "partially_paid"] },
	}).maxTimeMS(10000);
};

// ⭐⭐ MÉTHODE STATIQUE : Trouver les commandes par statut
orderSchema.statics.findByStatus = function (status) {
	return this.find({ orderStatus: status })
		.populate("reservation", "clientName tableId")
		.maxTimeMS(10000);
};

module.exports = mongoose.model("Order", orderSchema);
