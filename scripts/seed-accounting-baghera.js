/**
 * seed-accounting-baghera.js — Commandes fictives démo comptabilité pour Baghera
 *
 * Volumes intentionnellement irréguliers pour rendu réaliste :
 *   - Cette semaine (01–07 juin 2026) : 348 commandes
 *   - Sem. 25–31 mai 2026             : 621 commandes
 *   - Avril–Mai (hors sem. ci-dessus) : 2 847 commandes
 *   - 2025 : volumes mensuels variables (1 100 à 2 200 selon saison)
 *
 * Usage :
 *   node scripts/seed-accounting-baghera.js          → dry run
 *   DRY_RUN=false node scripts/seed-accounting-baghera.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Order = require("../src/models/Order");
const Server = require("../src/models/Server");
const Restaurant = require("../src/models/Restaurant");

const DRY_RUN = process.env.DRY_RUN !== "false";

// ── Helpers ────────────────────────────────────────────────────────────────

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = (n, pct = 0.12) =>
  Math.max(1, Math.round(n + n * pct * (Math.random() * 2 - 1)));

// Menu Baghera — restaurant méditerranéen, style brasserie marseillaise (panier cible ~65€)
const MENU_ITEMS = [
  // Entrées
  { name: "Tartare de daurade",         price: 11.00, category: "entrée" },
  { name: "Burrata tomates confites",   price: 9.50,  category: "entrée" },
  { name: "Velouté de poisson",         price: 8.00,  category: "entrée" },
  { name: "Planche charcuterie",        price: 10.00, category: "entrée" },
  // Plats
  { name: "Loup entier grillé",         price: 22.00, category: "plat" },
  { name: "Entrecôte frites",           price: 24.00, category: "plat" },
  { name: "Risotto aux crevettes",      price: 18.00, category: "plat" },
  { name: "Magret de canard",           price: 20.00, category: "plat" },
  { name: "Poulpe grillé pommes écrasées", price: 19.00, category: "plat" },
  { name: "Tartine du pêcheur",         price: 15.00, category: "plat" },
  { name: "Formule déjeuner",           price: 14.50, category: "plat" },
  // Desserts
  { name: "Moelleux au chocolat",       price: 6.50,  category: "dessert" },
  { name: "Panna cotta fruits rouges",  price: 5.50,  category: "dessert" },
  { name: "Tarte citron meringuée",     price: 6.00,  category: "dessert" },
  // Boissons
  { name: "Pichet rosé Provence 50cl",  price: 9.00,  category: "boisson" },
  { name: "Verre de vin rouge",         price: 5.50,  category: "boisson" },
  { name: "San Pellegrino 50cl",        price: 3.50,  category: "boisson" },
  { name: "Café allongé",              price: 2.50,  category: "boisson" },
  { name: "Pastis",                    price: 3.50,  category: "boisson" },
  // Accompagnements
  { name: "Frites maison",             price: 4.50,  category: "accompagnement" },
  { name: "Légumes rôtis",             price: 5.00,  category: "accompagnement" },
];

const PAYMENT_METHODS = ["card", "card", "card", "cash", "app"]; // card majoritaire
const CLIENT_NAMES = [
  "Kouider", "Benali", "Ferri", "Moreau", "Hadj",
  "Ricci", "Oussama", "Djelloul", "Chérif", "Saïd",
  "Dupont", "Martin", "Garcia", "Bernard", "Fontaine",
  "Marchetti", "Russo", "Gentile", "Blanc", "Arnaud",
];

// Volumes mensuels 2025 — saison basse jan/fév, peak été juil/août
const MONTHLY_VOLUMES_2025 = {
  0:  1143,  // jan  — creux post-fêtes
  1:  1087,  // fév  — creux
  2:  1382,  // mar  — reprise
  3:  1621,  // avr  — bon mois
  4:  1758,  // mai  — terrasse ouvre
  5:  2074,  // jun  — peak début été
  6:  2189,  // jul  — plein été
  7:  2204,  // aoû  — pic
  8:  1943,  // sep  — fin saison
  9:  1582,  // oct  — retombée
  10: 1261,  // nov  — creux
  11: 1834,  // déc  — fêtes
};

const randomDateInDay = (date) => {
  const d = new Date(date);
  // Service midi (12h–14h30) ou soir (19h–22h30) — brasserie réaliste
  const isMidi = Math.random() < 0.4;
  if (isMidi) {
    d.setHours(rand(12, 14), rand(0, 59), rand(0, 59), 0);
  } else {
    d.setHours(rand(19, 22), rand(0, 59), rand(0, 59), 0);
  }
  return d;
};

const makeOrder = (date, restaurantId, serverIds) => {
  // Baghera — 2 à 4 items par commande, panier cible ~65€
  const numItems = rand(2, 4);
  const items = Array.from({ length: numItems }, () => {
    const item = pick(MENU_ITEMS);
    const qty = rand(1, 3);
    return {
      name: item.name,
      quantity: qty,
      price: item.price,
      category: item.category,
      itemStatus: "served",
    };
  });

  const totalAmount = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const method = pick(PAYMENT_METHODS);
  const createdAt = randomDateInDay(date);

  return {
    restaurantId,
    serverId: pick(serverIds),
    clientName: pick(CLIENT_NAMES),
    items,
    totalAmount: Math.round(totalAmount * 100) / 100,
    paymentStatus: "paid",
    paid: true,
    paidAmount: Math.round(totalAmount * 100) / 100,
    paymentMethod: method,
    orderStatus: "completed",
    source: "server",
    origin: "server",
    createdAt,
    updatedAt: createdAt,
  };
};

const datesInRange = (start, end) => {
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

const spreadOrders = (n, dates, restaurantId, serverIds) => {
  const orders = [];
  for (let i = 0; i < n; i++) {
    orders.push(makeOrder(pick(dates), restaurantId, serverIds));
  }
  return orders;
};

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🌱 Seed Baghera — Mode : ${DRY_RUN ? "DRY RUN" : "⚠️  INSERTION RÉELLE"}\n`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connecté\n");

  // Récupérer le restaurant Baghera
  const BAGHERA_ID = "6a0381c865b4fbf2f219e0f0";
  const restaurant = await Restaurant.findById(BAGHERA_ID).lean();
  if (!restaurant) throw new Error("Restaurant Baghera introuvable (ID: " + BAGHERA_ID + ")");
  const restaurantId = restaurant._id;
  console.log(`🏪 Restaurant : ${restaurant.name || restaurantId}`);

  // Récupérer les serveurs Baghera
  const servers = await Server.find({ restaurantId }).lean();
  if (!servers.length) throw new Error("Aucun serveur trouvé pour Baghera");
  const serverIds = servers.map((s) => s._id);
  console.log(`👥 Serveurs (${servers.length}) : ${servers.map((s) => s.name || s.email).join(", ")}\n`);

  const allOrders = [];

  // ── Lot 1 : 348 commandes × 1–7 juin 2026 ───────────────────────────────
  const vol1 = jitter(348);
  const lot1Dates = datesInRange(new Date("2026-06-01"), new Date("2026-06-07"));
  const lot1 = spreadOrders(vol1, lot1Dates, restaurantId, serverIds);
  allOrders.push(...lot1);
  console.log(`📅 Lot 1 — Juin 01–07        : ${lot1.length} commandes`);

  // ── Lot 2 : 621 commandes × 25–31 mai 2026 ──────────────────────────────
  const vol2 = jitter(621);
  const lot2Dates = datesInRange(new Date("2026-05-25"), new Date("2026-05-31"));
  const lot2 = spreadOrders(vol2, lot2Dates, restaurantId, serverIds);
  allOrders.push(...lot2);
  console.log(`📅 Lot 2 — Mai 25–31         : ${lot2.length} commandes`);

  // ── Lot 3 : ~2847 commandes × avr + mai (hors sem. 25–31) ───────────────
  const vol3 = jitter(2847);
  const lot3Dates = [
    ...datesInRange(new Date("2026-04-01"), new Date("2026-04-30")),
    ...datesInRange(new Date("2026-05-01"), new Date("2026-05-24")),
  ];
  const lot3 = spreadOrders(vol3, lot3Dates, restaurantId, serverIds);
  allOrders.push(...lot3);
  console.log(`📅 Lot 3 — Avr–Mai (hors S5) : ${lot3.length} commandes`);

  // ── Lot 4 : 2025 mois par mois, volumes saisonniers ─────────────────────
  for (let month = 0; month < 12; month++) {
    const baseVol = MONTHLY_VOLUMES_2025[month];
    const vol = jitter(baseVol, 0.08); // ±8% de variation
    const firstDay = new Date(2025, month, 1);
    const lastDay = new Date(2025, month + 1, 0);
    const monthDates = datesInRange(firstDay, lastDay);
    const monthOrders = spreadOrders(vol, monthDates, restaurantId, serverIds);
    allOrders.push(...monthOrders);
    const label = firstDay.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    console.log(`📅 2025 — ${label.padEnd(20)} : ${monthOrders.length} commandes`);
  }

  const totalAmount = allOrders.reduce((s, o) => s + o.totalAmount, 0);
  const avgOrder = totalAmount / allOrders.length;
  console.log(`\n📊 Total commandes à insérer : ${allOrders.length.toLocaleString()}`);
  console.log(`💰 CA total simulé           : ${totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`);
  console.log(`🧾 Panier moyen              : ${avgOrder.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`);

  if (DRY_RUN) {
    console.log("\n⛔  DRY RUN — rien n'a été inséré.");
    console.log("    Pour exécuter : DRY_RUN=false node scripts/seed-accounting-baghera.js\n");
    await mongoose.disconnect();
    return;
  }

  // Insertion par lots de 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < allOrders.length; i += BATCH) {
    const batch = allOrders.slice(i, i + BATCH);
    await Order.insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`\r💾 Insérées : ${inserted}/${allOrders.length}`);
  }

  console.log(`\n\n✅ Seed Baghera terminé — ${inserted.toLocaleString()} commandes insérées.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\n❌ Erreur :", err.message);
  process.exit(1);
});
