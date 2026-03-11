/**
 * printDaemon.js
 * ─────────────────────────────────────────────────────────
 * Micro-serveur d'impression thermique ESC/POS pour le Mac.
 * À démarrer UNE FOIS sur le Mac qui a l'imprimante :
 *
 *   node printDaemon.js
 *
 * Il écoute sur le port 5555 et expose :
 *   POST http://192.168.1.162:5555/print/ticket
 *
 * Ce fichier est INDÉPENDANT du backend Render.
 * Pas d'auth (il est local et non exposé sur Internet).
 * ─────────────────────────────────────────────────────────
 */

const http = require("http");
const { printTicket } = require("./services/printingService");

const PORT = 5555;
const ALLOWED_RESTAURANT_ID = "686af511bb4cba684ff3b72e";

// ── Helper : lire le body JSON ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(new Error("Body JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

// ── Helper : réponse JSON ─────────────────────────────────────────────────────
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    // CORS permissif (local uniquement, pas exposé sur Internet)
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(payload);
}

// ── Serveur ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  // Seule route disponible
  if (req.method === "POST" && req.url === "/print/ticket") {
    try {
      const body = await readBody(req);
      const { restaurantId, tableNumber, items, total, note } = body;

      if (restaurantId !== ALLOWED_RESTAURANT_ID) {
        return send(res, 403, { message: "Impression non autorisée." });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return send(res, 400, { message: "Aucun article à imprimer." });
      }

      await printTicket({
        tableNumber: tableNumber ?? "N/A",
        items,
        total: Number(total) || 0,
        note: note || "",
      });

      return send(res, 200, { success: true, message: "Ticket imprimé." });
    } catch (err) {
      console.error("[DAEMON] Erreur impression :", err.message);
      return send(res, 500, { message: `Erreur impression : ${err.message}` });
    }
  }

  return send(res, 404, { message: "Route inconnue." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🖨️  Print daemon prêt sur http://0.0.0.0:${PORT}/print/ticket`);
  console.log(`   Ctrl+C pour arrêter`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} déjà utilisé. Changez PORT dans printDaemon.js.`);
  } else {
    console.error("[DAEMON] Erreur serveur :", err.message);
  }
  process.exit(1);
});
