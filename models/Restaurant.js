const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema({
	name: { type: String, required: true },
	email: { type: String, required: true, unique: true },
	passwordHash: { type: String, required: true },
	phone: String,
	address: String,
	role: {
		type: String,
		enum: ["admin", "manager"],
		default: "admin",
	},
	// 🏢 Catégorie de restaurant (pour adapter l'interface)
	category: {
		type: String,
		enum: [
			"restaurant",
			"foodtruck",
			"fast-food",
			"cafe",
			"boulangerie",
			"bar",
		],
		default: "restaurant",
	},
	// 🎨 Clé du style appliqué (référence vers la table Style)
	styleKey: {
		type: String,
		default: "premium", // Style par défaut
		index: true,
	},
	servers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Server" }],
	createdAt: { type: Date, default: Date.now },
	products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
	// Assistant de réservations - Durée moyenne d'occupation (en minutes)
	turnoverTime: { type: Number, default: 120, min: 30, max: 300 },
	// 🕐 Horaires d'ouverture (format "HH:MM")
	openingHours: {
		open: { type: String, default: "12:00" },
		close: { type: String, default: "22:00" },
	},
	// 🔐 Activation du restaurant (toggle développeur)
	active: { type: Boolean, default: true, index: true },
	// 💳 Type d'abonnement SaaS (pour billing futur)
	subscriptionPlan: {
		type: String,
		enum: ["free", "starter", "pro", "enterprise"],
		default: "free",
	},
	// 💬 Activation de la messagerie client-serveur
	isMessagingEnabled: {
		type: Boolean,
		default: true,
		index: true,
	},
	// 🔧 Overrides de fonctionnalités par restaurant
	// Clé = nom de feature (ex: "chat_client"), valeur = true (activer) / false (désactiver)
	// Surcharge la matrice de base déterminée par la catégorie.
	featureOverrides: {
		type: Map,
		of: Boolean,
		default: () => new Map(),
	},
	// 🌟 Avis Google (redirection clients)
	googlePlaceId: {
		type: String,
		default: null,
		trim: true,
	},
	googleReviewUrl: {
		type: String,
		default: null,
		trim: true,
	},
});

// Middleware to handle category changes
// Removed as per user request
// restaurantSchema.pre("save", function (next) {
// 	if (this.isModified("category") && this.category !== "restaurant") {
// 		// Remove "entrée" and "dessert" categories if a new category is added and it's not "restaurant"
// 		this.products = this.products.filter((product) => {
// 			return product.category !== "entrée" && product.category !== "dessert";
// 		});
// 	}
// 	next();
// });

module.exports = mongoose.model("Restaurant", restaurantSchema);
