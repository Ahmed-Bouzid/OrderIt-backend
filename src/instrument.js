// 🔍 Sentry — doit être chargé EN PREMIER, avant tout autre module
// Ce fichier est require'd au tout début de server.js et start.js
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://17742b972734719b974f73b20f7ae0a7@o4511526145753088.ingest.de.sentry.io/4511526152634448",
  environment: process.env.NODE_ENV || "development",
  // sendDefaultPii: false — RGPD : pas d'IP ni d'email auto-collectés
  sendDefaultPii: false,
  // Tracing désactivé (Error monitoring uniquement)
  tracesSampleRate: 0,
});
