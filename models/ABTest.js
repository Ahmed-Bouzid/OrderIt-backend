const mongoose = require("mongoose");

const abTestSchema = new mongoose.Schema(
  {
    // Metadata
    name: {
      type: String,
      required: true,
      index: true,
    },
    
    description: String,
    
    // Type de test
    type: {
      type: String,
      enum: ["theme", "component", "feature"],
      default: "theme",
    },
    
    // Thèmes en test
    controlGroupThemeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Theme",
      required: true,
      index: true,
    },
    
    variantAThemeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Theme",
    },
    
    variantBThemeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Theme",
    },
    
    // Configuration du split
    splitPercentage: {
      type: Number,
      default: 50, // % des users dans variant
      min: 1,
      max: 99,
    },
    
    // Timing
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    
    endDate: Date,
    
    // Statut du test
    status: {
      type: String,
      enum: ["draft", "running", "completed", "archived"],
      default: "draft",
      index: true,
    },
    
    // Résultats
    winner: {
      type: String,
      enum: ["control", "a", "b"],
      default: null,
    },
    
    winningReasonality: String,
    
    // Métriques collectées
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   control: {
      //     impressions: 1000,
      //     conversions: 150,
      //     conversionRate: 0.15,
      //     avgLoadTime: 234,
      //     avgRenderTime: 45,
      //     userSatisfaction: 4.2,
      //   },
      //   variantA: {...},
      //   variantB: {...}
      // }
    },
    
    // Tracking
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    updatedAt: Date,
    
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
abTestSchema.index({ status: 1, startDate: 1 });
abTestSchema.index({ type: 1 });
abTestSchema.index({ controlGroupThemeId: 1, variantAThemeId: 1, variantBThemeId: 1 });

// Static method: obtenir tests en cours
abTestSchema.statics.getRunning = function () {
  return this.find({
    status: "running",
    startDate: { $lte: new Date() },
    $or: [{ endDate: null }, { endDate: { $gte: new Date() } }],
  });
};

// Static method: obtenir tests complétés
abTestSchema.statics.getCompleted = function () {
  return this.find({
    status: "completed",
  });
};

module.exports = mongoose.model("ABTest", abTestSchema);
