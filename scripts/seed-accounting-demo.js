/**
 * seed-accounting-demo.js — Génère des commandes fictives pour démo comptabilité
 *
 * Volumes :
 *   - 50  commandes × 7 derniers jours   (1–7 juin 2026)
 *   - 350 commandes × semaine 25–31 mai 2026
 *   - 1500 commandes × mois avril–mai 2026 (hors semaine ci-dessus)
 *   - 1500 commandes × chaque mois de 2025 (jan–dec) = 18 000
 *
 * Usage :
 *   node scripts/seed-accounting-demo.js          → dry run
 *   DRY_RUN=false node scripts/seed-accounting-demo.js
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

const MENU_ITEMS = [
  { name: "Formule midi",     price: 13.50, category: "plat" },
  { name: "Burger maison",    price: 12.00, category: "plat" },
  { name: "Salade César",     price: 9.50,  category: "entrée" },
  { name: "Entrecôte",        price: 22.00, category: "plat" },
  { name: "Tiramisu",         price: 6.50,  category: "dessert" },
  { name: "Coca-Cola",        price: 3.00,  category: "boisson" },
  { name: "Eau pétillante",   price: 2.50,  category: "boisson" },
  { name: "Cappuccino",       price: 3.50,  category: "boisson" },
  { name: "Pizza Margherita", price: 11.00, category: "plat" },
  { name: "Frites",           price: 4.00,  category: "accompagnement" },
  { name: "Tarte tatin",      price: 7.00,  category: "dessert" },
  { name: "Saumon gravlax",   price: 14.00, category: "entrée" },
];

const PAYMENT_METHODS = ["cash", "card", "app"];
const CLIENT_NAMES = [
  "Martin", "Bernard", "Dupont", "Durand", "Moreau",
  "Simon", "Laurent", "Lefebvre", "Michel", "Garcia",
  "David", "Bertrand", "Roux", "Vincent", "Fournier",
];

/** Génère une date aléatoire dans la journée donnée */
const randomDateInDay = (date) => {
  const d = new Date(date);
  d.setHours(rand(11, 22), rand(0, 59), rand(0, 59), 0);
  return d;
};

/** Génère une commande fictive */
const makeOrder = (date, restaurantId, serverIds) => {
  const numItems = rand(1, 4);
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

/** Génère des dates pour un range */
const datesInRange = (start, end) => {
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

/** Répartit N commandes sur un tableau de dates */
const spreadOrders = (n, dates, restaurantId, serverIds) => {
  const orders = [];
  for (let i = 0; i < n; i++) {
    orders.push(makeOrder(pick(dates), restaurantId, serverIds));
  }
  return orders;
};

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🌱 Seed comptabilité — Mode : ${DRY_RUN ? "DRY RUN" : "⚠️  INSERTION RÉELLE"}\n`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connecté\n");

  // Récupérer le premier restaurant
  const restaurant = await Restaurant.findOne().lean();
  if (!restaurant) throw new Error("Aucun restaurant trouvé en BDD");
  const restaurantId = restaurant._id;
  console.log(`🏪 Restaurant : ${restaurant.name || restaurantId}`);

  // Récupérer les serveurs
  const servers = await Server.find({ restaurantId }).lean();
  if (!servers.length) throw new Error("Aucun serveur trouvé");
  const serverIds = servers.map((s) => s._id);
  console.log(`👥 Serveurs disponibles : ${servers.map((s) => s.name || s.email).join(", ")}\n`);

  const allOrders = [];

  // ── Lot 1 : 50 commandes × 7 derniers jours (1–7 juin 2026) ─────────────
  const lot1Dates = datesInRange(new Date("2026-06-01"), new Date("2026-06-07"));
  const lot1 = spreadOrders(50, lot1Dates, restaurantId, serverIds);
  allOrders.push(...lot1);
  console.log(`📅 Lot 1 — Juin 01–07 : ${lot1.length} commandes`);

  // ── Lot 2 : 350 commandes × sem. 25–31 mai 2026 ──────────────────────────
  const lot2Dates = datesInRange(new Date("2026-05-25"), new Date("2026-05-31"));
  const lot2 = spreadOrders(350, lot2Dates, restaurantId, serverIds);
  allOrders.push(...lot2);
  console.log(`📅 Lot 2 — Mai 25–31  : ${lot2.length} commandes`);

  // ── Lot 3 : 1500 commandes × avril + mai (hors sem. 25–31) ───────────────
  const lot3Dates = [
    ...datesInRange(new Date("2026-04-01"), new Date("2026-04-30")),
    ...datesInRange(new Date("2026-05-01"), new Date("2026-05-24")),
  ];
  const lot3 = spreadOrders(1500, lot3Dates, restaurantId, serverIds);
  allOrders.push(...lot3);
  console.log(`📅 Lot 3 — Avr–Mai    : ${lot3.length} commandes`);

  // ── Lot 4 : 1500 × 12 mois de 2025 ──────────────────────────────────────
  for (let month = 0; month < 12; month++) {
    const firstDay = new Date(2025, month, 1);
    const lastDay = new Date(2025, month + 1, 0);
    const monthDates = datesInRange(firstDay, lastDay);
    const monthOrders = spreadOrders(1500, monthDates, restaurantId, serverIds);
    allOrders.push(...monthOrders);
    const label = firstDay.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    console.log(`📅 Lot 4 — ${label.padEnd(18)} : ${monthOrders.length} commandes`);
  }

  const totalAmount = allOrders.reduce((s, o) => s + o.totalAmount, 0);
  console.log(`\n📊 Total commandes à insérer : ${allOrders.length.toLocaleString()}`);
  console.log(`💰 CA total simulé           : ${totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`);

  if (DRY_RUN) {
    console.log("\n⛔  DRY RUN — rien n'a été inséré.");
    console.log("    Pour exécuter : DRY_RUN=false node scripts/seed-accounting-demo.js\n");
    await mongoose.disconnect();
    return;
  }

  // Insertion par lots de 500 pour éviter timeout
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < allOrders.length; i += BATCH) {
    const batch = allOrders.slice(i, i + BATCH);
    await Order.insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`\r💾 Insérées : ${inserted}/${allOrders.length}`);
  }

  console.log(`\n\n✅ Seed terminé — ${inserted.toLocaleString()} commandes insérées.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\n❌ Erreur :", err.message);
  process.exit(1);
});
