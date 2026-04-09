/**
 * 🎨 Theme Service
 * 
 * Gère tout ce qui concerne les thèmes:
 * - Récupération des thèmes
 * - Assignation à restaurants
 * - Customizations
 * - Caching
 * - Analytics
 */

const Theme = require("../models/Theme");
const RestaurantThemeAssignment = require("../models/RestaurantThemeAssignment");
const ThemeCustomization = require("../models/ThemeCustomization");
const ThemeAnalytics = require("../models/ThemeAnalytics");
const ABTest = require("../models/ABTest");

class ThemeService {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🔍 GET METHODS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * 🔥 CRITICAL: Get thème pour un restaurant
   * - Avec caching multi-level
   * - Retourne thème + customizations + AB variant
   */
  async getThemeForRestaurant(restaurantId, options = {}) {
    const { includeCustomizations = true, forceRefresh = false } = options;
    
    console.log(`📋 [ThemeService] getThemeForRestaurant - restaurantId: ${restaurantId}`);
    
    try {
      // 1. Get assignment actif
      const assignment = await RestaurantThemeAssignment.getActiveForRestaurant(restaurantId);
      
      if (!assignment) {
        console.warn(`⚠️ [ThemeService] Pas de thème assigné pour ${restaurantId}, thème par défaut`);
        return this.getDefaultTheme();
      }
      
      // 2. Retourner thème + customizations + AB variant
      const result = {
        theme: {
          id: assignment.themeId._id,
          name: assignment.themeId.name,
          type: assignment.themeId.type,
          version: assignment.themeId.version,
          tokenConfig: assignment.themeId.tokenConfig,
          preview: assignment.themeId.preview,
        },
        customizations: assignment.customizations || {},
        customThemeEnabled: assignment.customThemeEnabled,
        abVariant: assignment.abTestingVariant,
        abTestingGroupId: assignment.abTestingGroupId,
        assignmentVersion: assignment.version,
      };
      
      console.log(`✅ [ThemeService] Theme retourné pour ${restaurantId}`);
      return result;
      
    } catch (error) {
      console.error(`❌ [ThemeService] Error getThemeForRestaurant:`, error);
      return this.getDefaultTheme();
    }
  }
  
  /**
   * Get thème par ID
   */
  async getTheme(themeId) {
    return await Theme.findById(themeId);
  }
  
  /**
   * Get tous les thèmes disponibles
   */
  async getAvailableThemes(type = null) {
    const query = { isActive: true, deprecated: false };
    
    if (type) {
      query.type = type;
    }
    
    return await Theme.find(query).sort({ name: 1 });
  }
  
  /**
   * Get thème par défaut
   */
  async getDefaultTheme() {
    const defaultTheme = await Theme.findOne({
      name: "Light",
      type: "default",
      isActive: true,
    });
    
    if (!defaultTheme) {
      throw new Error("Default theme not found");
    }
    
    return {
      theme: defaultTheme,
      customizations: {},
      customThemeEnabled: false,
      abVariant: "control",
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📝 ASSIGN/UPDATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Assigner un thème à un restaurant
   */
  async assignTheme(restaurantId, themeId, userId, reason = "") {
    console.log(`🎨 [ThemeService] Assigning theme ${themeId} to restaurant ${restaurantId}`);
    
    try {
      // 1. Validation
      const theme = await this.getTheme(themeId);
      if (!theme) {
        throw new Error("Theme not found");
      }
      
      // 2. Désactiver ancien assignment
      await RestaurantThemeAssignment.updateMany(
        { restaurantId, isActive: true },
        { $set: { isActive: false, deactivatedAt: new Date() } }
      );
      
      // 3. Créer nouveau assignment
      const assignment = new RestaurantThemeAssignment({
        restaurantId,
        themeId,
        appliedBy: userId,
        appliedReason: reason,
        activatedAt: new Date(),
      });
      
      await assignment.save();
      
      // 4. Emit WebSocket event pour live update
      this.emitThemeUpdate(restaurantId, themeId);
      
      // 5. Audit log
      await this.auditLog("THEME_ASSIGNED", {
        restaurantId,
        themeId,
        userId,
        reason,
      });
      
      console.log(`✅ [ThemeService] Theme assigned successfully`);
      return assignment;
      
    } catch (error) {
      console.error(`❌ [ThemeService] Error assigning theme:`, error);
      throw error;
    }
  }
  
  /**
   * Appliquer customizations à un restaurant
   */
  async customizeTheme(restaurantId, customizations) {
    console.log(`🎨 [ThemeService] Customizing theme for ${restaurantId}`);
    
    try {
      // Get assignment actif
      const assignment = await RestaurantThemeAssignment.getActiveForRestaurant(restaurantId);
      if (!assignment) {
        throw new Error("No active theme assignment");
      }
      
      // Update customizations
      assignment.customizations = {
        ...assignment.customizations,
        ...customizations,
      };
      assignment.customThemeEnabled = true;
      assignment.version += 1;
      
      await assignment.save();
      
      // Emit update
      this.emitThemeUpdate(restaurantId, assignment.themeId);
      
      // Audit
      await this.auditLog("THEME_CUSTOMIZED", {
        restaurantId,
        customizations,
      });
      
      return assignment;
      
    } catch (error) {
      console.error(`❌ [ThemeService] Error customizing theme:`, error);
      throw error;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 ANALYTICS METHODS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Record analytics event
   */
  async recordAnalytics(restaurantId, themeId, metrics) {
    try {
      const eventDate = new Date();
      eventDate.setHours(0, 0, 0, 0); // Group by day
      
      const result = await ThemeAnalytics.findOneAndUpdate(
        { restaurantId, themeId, eventDate },
        {
          $inc: metrics, // Increment counters
          recordedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      
      return result;
      
    } catch (error) {
      console.error(`❌ [ThemeService] Error recording analytics:`, error);
      // Don't throw - analytics failures shouldn't break the app
    }
  }
  
  /**
   * Get analytics pour un restaurant
   */
  async getAnalytics(restaurantId, daysBack = 30) {
    return await ThemeAnalytics.getForRestaurant(restaurantId, daysBack);
  }
  
  /**
   * Compare deux thèmes
   */
  async compareThemes(themeAId, themeBId, daysBack = 30) {
    return await ThemeAnalytics.compareThemes(themeAId, themeBId, daysBack);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🧪 AB TESTING METHODS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Create AB test
   */
  async createABTest(config) {
    const test = new ABTest({
      name: config.name,
      description: config.description,
      type: config.type || "theme",
      controlGroupThemeId: config.controlGroupThemeId,
      variantAThemeId: config.variantAThemeId,
      variantBThemeId: config.variantBThemeId,
      startDate: config.startDate,
      endDate: config.endDate,
      splitPercentage: config.splitPercentage || 50,
      status: config.status || "draft",
      createdBy: config.createdBy,
    });
    
    return await test.save();
  }
  
  /**
   * Get running AB tests
   */
  async getRunningABTests() {
    return await ABTest.getRunning();
  }
  
  /**
   * Determine AB variant pour utilisateur
   */
  getABVariantForUser(userId, splitPercentage = 50) {
    const hash = userId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const percentage = (hash % 100) + 1;
    
    if (percentage <= splitPercentage) {
      return "variant_a";
    } else {
      return "control";
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 WEBSOCKET & EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Emit theme update event (WebSocket)
   */
  emitThemeUpdate(restaurantId, themeId) {
    // À implémenter: socket.io integration
    console.log(`🔔 [ThemeService] Emit theme:updated for restaurant ${restaurantId}`);
    // socket.to(`restaurant-${restaurantId}`).emit("theme:updated", { restaurantId, themeId });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📋 AUDIT LOGGING
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Log audit events
   */
  async auditLog(action, metadata) {
    try {
      console.log(`📝 [AUDIT] ${action}:`, metadata);
      // À implémenter: store in AuditLog collection
    } catch (error) {
      console.error(`❌ [ThemeService] Audit log error:`, error);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Seed initial themes to database
   */
  async seedInitialThemes() {
    try {
      console.log(`🌱 [ThemeService] Seeding initial themes...`);
      
      const themes = [
        {
          name: "Light",
          description: "Default light theme with blue gradient",
          type: "default",
          version: "1.0.0",
          isPublic: true,
          tokenConfig: {
            colors: {
              primary: "#2563EB",
              secondary: "#1E40AF",
              accent: "#0891B2",
              background: "#F8FAFC",
              text: "#1F2937",
            },
            gradients: {
              primary: ["#2563EB", "#1E40AF"],
            },
          },
        },
        {
          name: "Cucina Di Nini",
          description: "Premium theme for Cucina Di Nini with green gradient and sandwich patterns",
          type: "premium",
          version: "1.0.0",
          isPublic: false,
          organizationId: null, // Spécifique au restaurant, pas organization
          tokenConfig: {
            colors: {
              primary: "#146845",
              secondary: "#34311C",
              background: "#1F4D2E",
            },
            gradients: {
              primary: ["#146845", "#34311C", "#1F4D2E", "#146845"],
            },
            specialFeatures: {
              hasSandwichPattern: true,
            },
          },
        },
        {
          name: "Le Grillz",
          description: "Premium BBQ theme with flames",
          type: "premium",
          version: "1.0.0",
          isPublic: false,
          tokenConfig: {
            colors: {
              primary: "#FF5722",
              secondary: "#424242",
              background: "#1C1C1C",
              text: "#FFF8E1",
            },
            gradients: {
              primary: ["#FF5722", "#BF360C"],
            },
          },
        },
      ];
      
      for (const theme of themes) {
        const exists = await Theme.findOne({ name: theme.name });
        if (!exists) {
          await Theme.create(theme);
          console.log(`✅ Created theme: ${theme.name}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ [ThemeService] Error seeding themes:`, error);
    }
  }
}

module.exports = new ThemeService();
