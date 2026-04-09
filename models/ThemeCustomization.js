const mongoose = require("mongoose");

const themeCustomizationSchema = new mongoose.Schema(
  {
    // Restaurant propriétaire
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    
    // Thème de base (template)
    baseThemeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Theme",
      required: true,
      index: true,
    },
    
    // Nom de la customization
    customizationName: {
      type: String,
      required: true,
    },
    
    // Customisations individuelles
    colors: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   primary: "#FF6B6B",
      //   secondary: "#4ECDC4",
      //   accent: "#FFE66D",
      //   background: "#F8F9FA",
      //   ...
      // }
    },
    
    typography: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   headingFont: "DXNacky",
      //   headingSize: 28,
      //   bodyFont: "Helvetica",
      //   bodySize: 14,
      //   ...
      // }
    },
    
    spacing: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   container: 16,
      //   cardPadding: 12,
      //   buttonRadius: 8,
      //   ...
      // }
    },
    
    components: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   button: { bgColor: "...", textColor: "..." },
      //   card: { shadow: "...", radius: "..." },
      //   ...
      // }
    },
    
    // Fallback CSS personnalisé
    cssOverrides: String,
    
    // Assets (images, logos, etc)
    assetUrls: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // {
      //   logoUrl: "https://...",
      //   bannerUrl: "https://...",
      //   faviconUrl: "https://...",
      //   ...
      // }
    },
    
    // Versioning
    version: {
      type: Number,
      default: 1,
    },
    
    // Publication
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    
    publishedAt: Date,
    
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
    
    notes: String,
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
themeCustomizationSchema.index({ restaurantId: 1, isPublished: 1 });
themeCustomizationSchema.index({ baseThemeId: 1 });
themeCustomizationSchema.index({ createdAt: -1 });

// Static method: obtenir toutes les customizations d'un restaurant
themeCustomizationSchema.statics.getForRestaurant = function (restaurantId) {
  return this.find({ restaurantId }).sort({ updatedAt: -1 });
};

// Static method: obtenir la customization publiée
themeCustomizationSchema.statics.getPublishedForRestaurant = function (restaurantId) {
  return this.findOne({
    restaurantId,
    isPublished: true,
  });
};

module.exports = mongoose.model("ThemeCustomization", themeCustomizationSchema);
