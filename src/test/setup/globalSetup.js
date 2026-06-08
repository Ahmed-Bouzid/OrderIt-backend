/**
 * globalSetup.js — s'exécute UNE FOIS avant tous les tests
 *
 * Libère le port 3000 si un processus externe le retient déjà
 * (ex: serveur de dev lancé dans un terminal parallèle).
 * Supertest n'a pas besoin d'un port fixe, mais Socket.io dans server.js
 * peut provoquer EADDRINUSE si le port est pris lors de l'initialisation du module.
 */
const { execSync } = require("child_process");

module.exports = async function () {
  const port = process.env.PORT || 3000;
  try {
    // Tenter de tuer tout processus occupant le port (macOS/Linux uniquement)
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
    });
    console.log(`[globalSetup] Port ${port} libéré avant les tests`);
  } catch {
    // Si lsof n'est pas disponible ou le port est libre → ignorer silencieusement
  }
  // Laisser le temps au process de se terminer
  await new Promise((resolve) => setTimeout(resolve, 300));
};
