/**
 * routes/print.js
 * Route d'impression thermique ESC/POS.
 * Restreinte au restaurant Chez Ahmed : 686af511bb4cba684ff3b72e
 */

const express = require("express");
const router  = express.Router();
const { printTicket } = require("../services/printingService");

const ALLOWED_RESTAURANT_ID = "686af511bb4cba684ff3b72e";

/**
 * POST /print/ticket
 * Body : { restaurantId, tableNumber, items, total, note }
 * items : [{ name, quantity, price }]
 */
router.post("/ticket", async (req, res) => {
  try {
    const { restaurantId, tableNumber, items, total, note } = req.body;

    // ── Vérification restaurant autorisé ─────────────────────────────────────
    if (!restaurantId || restaurantId !== ALLOWED_RESTAURANT_ID) {
      return res.status(403).json({
        message: "Impression non autorisée pour ce restaurant.",
      });
    }

    // ── Validation basique ────────────────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Aucun article à imprimer." });
    }

    // ── Impression ────────────────────────────────────────────────────────────
    await printTicket({
      tableNumber: tableNumber ?? "N/A",
      items,
      total:  Number(total)  || 0,
      note:   note           || "",
    });

    return res.json({ success: true, message: "Ticket imprimé avec succès." });
  } catch (error) {
    console.error("[PRINT ROUTE] Erreur :", error.message);
    return res.status(500).json({
      message: `Erreur impression : ${error.message}`,
    });
  }
});

module.exports = router;
