const mongoose = require("mongoose");

const themeSchema = new mongoose.Schema(
  {
    // Identifiant et metadata
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    description: String,
    
    // Type de thème
    type: {
      type: String,
      enum: ["default", "premium", "enterprise"],
      default: "default",
      index: true,
    },
    
    // Versioning
    version: {
      type: String,
      required: true, // "1.0.0", "1.0.1", etc
      index: true,
    },
    
    // Configuration des tokens (Design Tokens)
    tokenConfig: {
      type: mongoose.Schema.Types.Mixed, // JSONB equivalent
      required: true,
      // Structure:
      // {
      //   colors: { primary: "#FF6B6B", secondary: "#4ECDC4", ... },
      //   typography: { headingFont: "Arial", bodyFont: "Helvetica", sizes: {...} },
      //   spacing: { small: 8, medium: 16, large: 24, ... },
      //   shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)", ... },
      //   radius: { sm: 4, md: 8, lg: 16, ... }
      // }
    },
    
    // Prévisualisation
    preview: {
      previewImageUrl: String,
      previewJsonUrl: String,
    },
    
    // Multi-tenancy (pour thèmes spécifiques à une organisation)
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null, // NULL = global/public theme
    },
    
    // Visibilité
    isPublic: {
      type: Boolean,
      default: true,
      index: true,
    },
    
    // Statut du thème
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    
    // Déprécation
    deprecated: {
      type: Boolean,
      default: false,
      index: true,
    },
    deprecationReason: String,
    deprecationDate: Date,
    
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

// Indexes composites
themeSchema.index({ type: 1, isActive: 1 });
themeSchema.index({ name: 1, version: 1 });
themeSchema.index({ organizationId: 1, isPublic: 1 });

// Static method: trouver thèmes disponibles
themeSchema.statics.findAvailable = function (includePrivate = false) {
  const query = {
    isActive: true,
    deprecated: false,
  };
  if (!includePrivate) {
    query.isPublic = true;
  }
  return this.find(query).sort({ type: 1, name: 1 });
};

// Static method: trouver par type
themeSchema.statics.findByType = function (type) {
  return this.find({
    type,
    isActive: true,
    deprecated: false,
    isPublic: true,
  });
};

module.exports = mongoose.model("Theme", themeSchema);
