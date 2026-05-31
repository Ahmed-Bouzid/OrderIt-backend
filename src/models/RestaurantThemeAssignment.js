const mongoose = require("mongoose");

const restaurantThemeAssignmentSchema = new mongoose.Schema(
  {
    // Restaurant et Thème
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    
    themeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Theme",
      required: true,
      index: true,
    },
    
    // Customizations par restaurant
    customizations: {
      type: mongoose.Schema.Types.Mixed, // JSONB
      default: {},
      // Structure optionnelle:
      // {
      //   colors: { primary: "#FF0000" }, // Overrides du thème
      //   logo: "https://...",
      //   favicon: "https://...",
      //   banner: "https://...",
      // }
    },
    
    // Flag pour customizations avancées
    customThemeEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    
    // Versioning de l'assignment
    version: {
      type: Number,
      default: 1,
    },
    
    // AB-Testing
    abTestingGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ABTest",
      default: null,
    },
    
    abTestingVariant: {
      type: String,
      enum: ["control", "variant_a", "variant_b"],
      default: "control",
    },
    
    // Statut
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    
    // Tracking
    activatedAt: {
      type: Date,
      default: Date.now,
    },
    
    deactivatedAt: Date,
    
    // Audit: Qui a appliqué le thème
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    
    appliedReason: String,
    
    // Métadonnées
    notes: String,
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ⭐ Contrainte unique: un seul assignment actif par restaurant
restaurantThemeAssignmentSchema.index(
  { restaurantId: 1, isActive: 1 },
  { unique: true, sparse: true }
);

// Autres indexes
restaurantThemeAssignmentSchema.index({ themeId: 1, isActive: 1 });
restaurantThemeAssignmentSchema.index({ abTestingGroupId: 1, abTestingVariant: 1 });
restaurantThemeAssignmentSchema.index({ activatedAt: -1 }); // Pour analytics

// Static method: obtenir l'assignment actif d'un restaurant
restaurantThemeAssignmentSchema.statics.getActiveForRestaurant = function (restaurantId) {
  return this.findOne({
    restaurantId,
    isActive: true,
  })
    .populate("themeId")
    .populate("abTestingGroupId");
};

// Static method: obtenir l'historique des thèmes d'un restaurant
restaurantThemeAssignmentSchema.statics.getHistoryForRestaurant = function (restaurantId, limit = 10) {
  return this.find({ restaurantId })
    .sort({ activatedAt: -1 })
    .limit(limit)
    .populate("themeId")
    .populate("appliedBy");
};

// Static method: obtenir tous les restaurants avec un thème spécifique
restaurantThemeAssignmentSchema.statics.getRestaurantsByTheme = function (themeId, onlyActive = true) {
  const query = { themeId };
  if (onlyActive) query.isActive = true;
  return this.find(query).populate("restaurantId");
};

module.exports = mongoose.model(
  "RestaurantThemeAssignment",
  restaurantThemeAssignmentSchema
);
