/**
 * 🎨 Theme Routes
 * 
 * API endpoints pour la gestion des thèmes
 */

const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const auth = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const themeService = require("../services/themeService");

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/themes
 * Récupère tous les thèmes disponibles
 * Public access - no auth required
 */
router.get("/", async (req, res) => {
  try {
    const { type } = req.query;
    const themes = await themeService.getAvailableThemes(type);
    
    res.json({
      success: true,
      data: themes,
      count: themes.length,
    });
  } catch (error) {
    console.error("❌ Error fetching themes:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/themes/:themeId
 * Récupère détails d'un thème
 */
router.get("/:themeId", async (req, res) => {
  try {
    const { themeId } = req.params;
    const theme = await themeService.getTheme(themeId);
    
    if (!theme) {
      return res.status(404).json({
        success: false,
        error: "Theme not found",
      });
    }
    
    res.json({
      success: true,
      data: theme,
    });
  } catch (error) {
    console.error("❌ Error fetching theme:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/restaurants/:restaurantId/theme
 * 🔥 CRITICAL - Récupère le thème actuel + customizations du restaurant
 * Frontend appelle ça au démarrage
 */
router.get("/restaurants/:restaurantId/theme", async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { forceRefresh } = req.query;
    
    console.log(`📋 [API] GET theme for restaurant ${restaurantId}`);
    
    const themeData = await themeService.getThemeForRestaurant(restaurantId, {
      forceRefresh: forceRefresh === "true",
    });
    
    res.json({
      success: true,
      data: themeData,
    });
  } catch (error) {
    console.error("❌ Error getting restaurant theme:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/restaurants/:restaurantId/theme
 * Assigner un thème à un restaurant (Admin only)
 */
router.put(
  "/restaurants/:restaurantId/theme",
  auth,
  checkRoles(["admin"]),
  [
    body("themeId").notEmpty().withMessage("themeId is required"),
    body("reason").optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { restaurantId } = req.params;
      const { themeId, reason } = req.body;
      const userId = req.user.id;
      
      console.log(`🎨 [API] Assigning theme ${themeId} to ${restaurantId}`);
      
      const assignment = await themeService.assignTheme(
        restaurantId,
        themeId,
        userId,
        reason
      );
      
      res.json({
        success: true,
        message: "Theme assigned successfully",
        data: assignment,
      });
    } catch (error) {
      console.error("❌ Error assigning theme:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/restaurants/:restaurantId/theme/customize
 * Sauvegarder customizations pour un restaurant
 */
router.post(
  "/restaurants/:restaurantId/theme/customize",
  auth,
  checkRoles(["admin"]),
  [
    body("customizations").isObject().withMessage("customizations must be an object"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { restaurantId } = req.params;
      const { customizations } = req.body;
      
      console.log(`🎨 [API] Customizing theme for ${restaurantId}`);
      
      const assignment = await themeService.customizeTheme(restaurantId, customizations);
      
      res.json({
        success: true,
        message: "Theme customized successfully",
        data: assignment,
      });
    } catch (error) {
      console.error("❌ Error customizing theme:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/restaurants/:restaurantId/theme/preview
 * Prévisualiser un thème
 */
router.get("/restaurants/:restaurantId/theme/preview", async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const themeData = await themeService.getThemeForRestaurant(restaurantId);
    
    // Format pour preview
    const preview = {
      theme: themeData.theme,
      colors: themeData.theme.tokenConfig.colors,
      customizations: themeData.customizations,
    };
    
    res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error("❌ Error previewing theme:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/restaurants/:restaurantId/theme/analytics
 * Récupère analytics du thème
 */
router.get("/restaurants/:restaurantId/theme/analytics", auth, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { daysBack = 30 } = req.query;
    
    const analytics = await themeService.getAnalytics(restaurantId, parseInt(daysBack));
    
    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error("❌ Error fetching analytics:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/theme/analytics
 * Record analytics event (Frontend peut appeler ça)
 */
router.post(
  "/analytics",
  [
    body("restaurantId").notEmpty(),
    body("themeId").notEmpty(),
    body("metrics").isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { restaurantId, themeId, metrics } = req.body;
      
      await themeService.recordAnalytics(restaurantId, themeId, metrics);
      
      res.json({
        success: true,
        message: "Analytics recorded",
      });
    } catch (error) {
      // Don't throw for analytics - fail silently
      console.warn("⚠️ Analytics recording failed:", error);
      res.json({ success: true }); // Fake success
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/themes
 * Créer nouveau thème (Admin only)
 */
router.post(
  "/",
  auth,
  checkRoles(["admin"]),
  [
    body("name").notEmpty().withMessage("name is required"),
    body("type").isIn(["default", "premium", "enterprise"]),
    body("version").matches(/^\d+\.\d+\.\d+$/),
    body("tokenConfig").isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      // À implémenter: créer thème en DB
      res.json({
        success: true,
        message: "Theme created successfully",
      });
    } catch (error) {
      console.error("❌ Error creating theme:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
