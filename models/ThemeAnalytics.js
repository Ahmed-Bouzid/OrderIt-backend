const mongoose = require("mongoose");

const themeAnalyticsSchema = new mongoose.Schema(
  {
    // Identification
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
    
    // Date d'enregistrement (groupé par jour)
    eventDate: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Métriques d'engagement
    impressions: {
      type: Number,
      default: 0, // Nombre de fois que le thème a été vu
    },
    
    clicks: {
      type: Number,
      default: 0, // Interactions utilisateur
    },
    
    conversions: {
      type: Number,
      default: 0, // Orders placées
    },
    
    uniqueUsers: {
      type: Number,
      default: 0,
    },
    
    sessionsCount: {
      type: Number,
      default: 0,
    },
    
    // Taux dérivés
    clickThroughRate: Number, // clicks / impressions
    conversionRate: Number, // conversions / impressions
    sessionDuration: Number, // en secondes
    
    // Métriques de performance
    avgLoadTimeMs: Number,
    avgRenderTimeMs: Number,
    errorRate: Number, // % d'erreurs
    
    // UX Metrics
    userSatisfactionScore: Number, // 1-5
    bounceRate: Number,
    
    // Revenue impact
    totalRevenue: {
      type: Number,
      default: 0,
    },
    
    revenuePerUser: Number,
    
    // Device breakdown
    deviceMetrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   mobile: { impressions: 500, conversions: 75 },
      //   tablet: { impressions: 200, conversions: 30 },
      //   web: { impressions: 300, conversions: 45 }
      // }
    },
    
    // Geographic data
    geoMetrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // { FR: { impressions: 800, conversions: 120 }, ... }
    },
    
    // Tracking
    recordedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ⭐ Composite unique: un record par restaurant/thème/jour
themeAnalyticsSchema.index(
  { restaurantId: 1, themeId: 1, eventDate: 1 },
  { unique: true }
);

// Autres indexes
themeAnalyticsSchema.index({ eventDate: -1 }); // Queries par date
themeAnalyticsSchema.index({ themeId: 1, eventDate: -1 }); // Performance
themeAnalyticsSchema.index({ recordedAt: -1 }); // Recent records

// Static method: obtenir analytics d'un restaurant
themeAnalyticsSchema.statics.getForRestaurant = function (restaurantId, daysBack = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  return this.find({
    restaurantId,
    eventDate: { $gte: startDate },
  }).sort({ eventDate: -1 });
};

// Static method: agréguer les stats d'un thème
themeAnalyticsSchema.statics.aggregateStats = function (themeId, daysBack = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  return this.aggregate([
    {
      $match: {
        themeId: new mongoose.Types.ObjectId(themeId),
        eventDate: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalImpressions: { $sum: "$impressions" },
        totalClicks: { $sum: "$clicks" },
        totalConversions: { $sum: "$conversions" },
        totalRevenue: { $sum: "$totalRevenue" },
        avgLoadTime: { $avg: "$avgLoadTimeMs" },
        avgRenderTime: { $avg: "$avgRenderTimeMs" },
        avgUserSatisfaction: { $avg: "$userSatisfactionScore" },
        avgConversionRate: { $avg: "$conversionRate" },
      },
    },
  ]);
};

// Static method: comparer deux thèmes
themeAnalyticsSchema.statics.compareThemes = function (themeA, themeB, daysBack = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  return this.aggregate([
    {
      $match: {
        themeId: { $in: [new mongoose.Types.ObjectId(themeA), new mongoose.Types.ObjectId(themeB)] },
        eventDate: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$themeId",
        totalImpressions: { $sum: "$impressions" },
        totalConversions: { $sum: "$conversions" },
        avgLoadTime: { $avg: "$avgLoadTimeMs" },
        conversionRate: { $avg: "$conversionRate" },
      },
    },
  ]);
};

module.exports = mongoose.model("ThemeAnalytics", themeAnalyticsSchema);
