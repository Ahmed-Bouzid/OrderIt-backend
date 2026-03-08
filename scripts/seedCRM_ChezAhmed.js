/**
 * 🍽️  Seed CRM – Chez Ahmed
 * Génère des données de simulation réalistes pour 3 serveurs :
 *   - Sofia, Karim, Nabil
 * Couvre les 30 derniers jours (visible sur period = week, month, quarter)
 *
 * Usage (depuis le dossier backend/) :
 *   node scripts/seedCRM_ChezAhmed.js
 *
 * Options :
 *   --reset   Supprime les données de seed précédentes avant d'insérer
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Server = require("../models/Server");
const Reservation = require("../models/Reservation");
const Order = require("../models/Order");

// ─────────────────────────────────────────────
// CONFIG
// Passer --restaurantId=<id> pour cibler un restaurant différent
// ─────────────────────────────────────────────
const argId = process.argv.find((a) => a.startsWith("--restaurantId="))?.split("=")[1];
const RESTAURANT_ID = new mongoose.Types.ObjectId(argId || "686af511bb4cba684ff3b72e");
const RESET = process.argv.includes("--reset");
console.log(`🎯 Restaurant ciblé : ${RESTAURANT_ID}`);

const SERVERS_SEED = [
  {
    name: "Sofia",
    email: `sofia@seed-${RESTAURANT_ID}.com`,
    serverId: `seed-sofia-${RESTAURANT_ID}`,
    role: "server",
    avgServiceMin: 18,
    avgTicket: 34,
    ordersCount: 22,
  },
  {
    name: "Karim",
    email: `karim@seed-${RESTAURANT_ID}.com`,
    serverId: `seed-karim-${RESTAURANT_ID}`,
    role: "server",
    avgServiceMin: 25,
    avgTicket: 27,
    ordersCount: 28,
  },
  {
    name: "Nabil",
    email: `nabil@seed-${RESTAURANT_ID}.com`,
    serverId: `seed-nabil-${RESTAURANT_ID}`,
    role: "manager",
    avgServiceMin: 32,
    avgTicket: 48,
    ordersCount: 14,
  },
];

// Plats réalistes pour un restaurant oriental/méditerranéen
const MENU_ITEMS = [
  { name: "Couscous Royal", price: 18, category: "plats" },
  { name: "Tajine d'agneau", price: 16, category: "plats" },
  { name: "Chorba", price: 7, category: "entrées" },
  { name: "Brick à l'œuf", price: 6, category: "entrées" },
  { name: "Merguez grillées", price: 12, category: "plats" },
  { name: "Salade marocaine", price: 5, category: "entrées" },
  { name: "Pastilla au poulet", price: 14, category: "plats" },
  { name: "Thé à la menthe", price: 3, category: "boissons" },
  { name: "Jus de grenadine", price: 4, category: "boissons" },
  { name: "Eau minérale", price: 2.5, category: "boissons" },
  { name: "Baklava", price: 5, category: "desserts" },
  { name: "Mhalabia", price: 4, category: "desserts" },
  { name: "Makroud", price: 3.5, category: "desserts" },
];

const CLIENT_NAMES = [
  "Ahmed B.", "Marie L.", "Pierre D.", "Fatima S.", "Julien R.",
  "Nathalie M.", "Youssef K.", "Isabelle T.", "Mehdi A.", "Claire V.",
  "Thomas G.", "Sara H.", "Baptiste C.", "Amina N.", "Lucas P.",
  "Camille F.", "Rachid O.", "Emma B.", "Karim L.", "Laura D.",
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Nombre aléatoire entier dans [min, max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Nombre aléatoire flottant avec variance autour d'une moyenne */
function randAround(avg, variance = 0.25) {
  const factor = 1 + (Math.random() * 2 - 1) * variance;
  return avg * factor;
}

/** Date aléatoire dans les N derniers jours */
function randDateInPastDays(maxDaysAgo = 30) {
  const msAgo = randInt(0, maxDaysAgo) * 24 * 60 * 60 * 1000
    + randInt(0, 23) * 60 * 60 * 1000
    + randInt(0, 59) * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

/** Génère un tableau d'items de commande réalistes */
function generateItems(targetTotal) {
  const items = [];
  let total = 0;

  // 1 ou 2 plats principaux
  const nbPlats = randInt(1, 2);
  for (let i = 0; i < nbPlats; i++) {
    const plats = MENU_ITEMS.filter((m) => m.category === "plats");
    const item = plats[randInt(0, plats.length - 1)];
    items.push({ name: item.name, quantity: 1, price: item.price, category: item.category, itemStatus: "served" });
    total += item.price;
  }

  // Entrée optionnelle
  if (Math.random() > 0.4) {
    const entrees = MENU_ITEMS.filter((m) => m.category === "entrées");
    const item = entrees[randInt(0, entrees.length - 1)];
    items.push({ name: item.name, quantity: 1, price: item.price, category: item.category, itemStatus: "served" });
    total += item.price;
  }

  // Boisson(s)
  const nbBoissons = randInt(1, 2);
  for (let i = 0; i < nbBoissons; i++) {
    const boissons = MENU_ITEMS.filter((m) => m.category === "boissons");
    const item = boissons[randInt(0, boissons.length - 1)];
    items.push({ name: item.name, quantity: 1, price: item.price, category: item.category, itemStatus: "served" });
    total += item.price;
  }

  // Dessert optionnel
  if (Math.random() > 0.5) {
    const desserts = MENU_ITEMS.filter((m) => m.category === "desserts");
    const item = desserts[randInt(0, desserts.length - 1)];
    items.push({ name: item.name, quantity: 1, price: item.price, category: item.category, itemStatus: "served" });
    total += item.price;
  }

  return { items, total: Math.round(total * 100) / 100 };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGO_URI ou MONGODB_URI non défini dans .env");
    process.exit(1);
  }

  console.log("🔌 Connexion à MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("✅ Connecté");

  // ── Reset optionnel ──────────────────────────
  if (RESET) {
    console.log("🗑️  --reset : suppression des données de seed précédentes...");
    const seedEmails = SERVERS_SEED.map((s) => s.email);
    const existingServers = await Server.find({ email: { $in: seedEmails } });
    const existingServerIds = existingServers.map((s) => s._id);

    await Order.deleteMany({ serverId: { $in: existingServerIds } });
    await Reservation.deleteMany({
      serverId: { $in: existingServerIds },
      clientName: { $in: CLIENT_NAMES },
    });
    await Server.deleteMany({ email: { $in: seedEmails } });

    console.log(
      `  ↳ Supprimé : ${existingServers.length} serveur(s) + commandes/réservations liées`
    );
  }

  // ── Création des Server documents ───────────
  console.log("\n👨‍🍳 Création des serveurs...");
  const passwordHash = await bcrypt.hash("SeedPassword123!", 10);

  const serverDocs = [];
  for (const s of SERVERS_SEED) {
    const existing = await Server.findOne({ email: s.email });
    if (existing) {
      console.log(`  ↳ ${s.name} : déjà présent (id: ${existing._id})`);
      serverDocs.push({ ...s, _id: existing._id });
    } else {
      const doc = await Server.create({
        restaurantId: RESTAURANT_ID,
        serverId: s.serverId,
        name: s.name,
        email: s.email,
        passwordHash,
        authProvider: "local",
        role: s.role,
      });
      console.log(`  ↳ ${s.name} créé (id: ${doc._id})`);
      serverDocs.push({ ...s, _id: doc._id });
    }
  }

  // ── Création des Reservations + Orders ──────
  console.log("\n📋 Création des réservations et commandes...");
  let totalReservations = 0;
  let totalOrders = 0;

  for (const server of serverDocs) {
    console.log(`\n  → ${server.name} (${server.ordersCount} commandes prévues)...`);

    for (let i = 0; i < server.ordersCount; i++) {
      const createdAt = randDateInPastDays(30);
      const serviceMinutes = Math.round(randAround(server.avgServiceMin, 0.3));
      const completedAt = new Date(createdAt.getTime() + serviceMinutes * 60 * 1000);

      const clientName = CLIENT_NAMES[randInt(0, CLIENT_NAMES.length - 1)];
      const nbPersonnes = randInt(1, 6);

      // Réservation
      const reservation = await Reservation.create({
        restaurantId: RESTAURANT_ID,
        serverId: server._id,
        clientName,
        nbPersonnes,
        reservationDate: createdAt,
        reservationTime: `${createdAt.getHours()}h${String(createdAt.getMinutes()).padStart(2, "0")}`,
        arrivalTime: createdAt,
        reservationSource: "Sur place",
        status: "terminée",
        dishStatus: "Terminé",
        openedBy: server.name,
        createdAt,
        updatedAt: completedAt,
      });
      totalReservations++;

      // Items + montant
      const targetTotal = Math.round(randAround(server.avgTicket, 0.3) * nbPersonnes);
      const { items, total } = generateItems(targetTotal);

      // Order
      await Order.create({
        restaurantId: RESTAURANT_ID,
        reservationId: reservation._id,
        serverId: server._id,
        items,
        totalAmount: total,
        paymentStatus: "paid",
        createdAt,
        completedAt,
        updatedAt: completedAt,
      });
      totalOrders++;
    }

    console.log(`    ✅ ${server.ordersCount} commande(s) créée(s) pour ${server.name}`);
  }

  // ── Résumé ─────────────────────────────────
  console.log("\n" + "─".repeat(50));
  console.log("🎉 Seed terminé !");
  console.log(`   Serveurs    : ${serverDocs.length}`);
  console.log(`   Réservations: ${totalReservations}`);
  console.log(`   Commandes   : ${totalOrders}`);
  console.log("─".repeat(50));
  console.log("\n📊 Récap estimé par serveur :");
  for (const s of serverDocs) {
    console.log(
      `   ${s.name.padEnd(8)} | ~${s.ordersCount} cmd | ticket ~${s.avgTicket}€ | service ~${s.avgServiceMin} min`
    );
  }
  console.log(
    "\n✅ Les données sont visibles dans le CRM (périodes : semaine, mois, trimestre)"
  );

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  mongoose.connection.close();
  process.exit(1);
});
