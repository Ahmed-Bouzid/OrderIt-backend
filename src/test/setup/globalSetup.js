/**
 * globalSetup.js — s'exécute UNE FOIS avant tous les tests
 *
 * NOTE: server.js exporte uniquement `app` sans appeler `.listen()`.
 * Supertest utilise des ports éphémères → aucun kill de port nécessaire.
 * Ne pas tuer le port 3000 : il peut être utilisé par Expo/frontend en parallèle.
 */

module.exports = async function () {
  // Rien à faire : supertest n'a pas besoin d'un port fixe
};
