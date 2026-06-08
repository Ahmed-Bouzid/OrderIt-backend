/**
 * cleanup-test-items.js — Supprime les ordres/items de test
 *
 * ÉTAPE 1 (DRY RUN) : affiche ce qui serait supprimé
 * ÉTAPE 2 : passer DRY_RUN=false pour exécuter
 *
 * Usage :
 *   node scripts/cleanup-test-items.js           → dry run
 *   DRY_RUN=false node scripts/cleanup-test-items.js  → suppression réelle
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Order = require("../src/models/Order");

const DRY_RUN = process.env.DRY_RUN !== "false";

// Noms de produits de test à supprimer (exact match, insensible à la casse)
const TEST_NAMES = ["test", "test item"];

const isTestItem = (name) =>
  TEST_NAMES.includes((name || "").toLowerCase().trim());

async function run() {
  console.log(`\n🔍 Mode : ${DRY_RUN ? "DRY RUN (aucune modif)" : "⚠️  SUPPRESSION RÉELLE"}\n`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connecté\n");

  // ── 1. Ordres dont TOUS les items sont des items de test ────────────────
  const allOrders = await Order.find({
    "items.name": { $regex: /^test( item)?$/i },
  }).lean();

  const fullTestOrders = allOrders.filter((order) =>
    order.items.every((item) => isTestItem(item.name))
  );

  const mixedOrders = allOrders.filter((order) =>
    order.items.some((item) => isTestItem(item.name)) &&
    !order.items.every((item) => isTestItem(item.name))
  );

  // ── Rapport ─────────────────────────────────────────────────────────────
  console.log(`📦 Ordres 100% test (à supprimer entièrement) : ${fullTestOrders.length}`);
  fullTestOrders.slice(0, 5).forEach((o) => {
    const items = o.items.map((i) => `${i.name} x${i.quantity}`).join(", ");
    console.log(`  → ${o._id} | ${items}`);
  });
  if (fullTestOrders.length > 5) console.log(`  ... (${fullTestOrders.length - 5} autres)`);

  console.log(`\n🔀 Ordres mixtes (items test à retirer, ordre gardé) : ${mixedOrders.length}`);
  mixedOrders.slice(0, 5).forEach((o) => {
    const testItems = o.items.filter((i) => isTestItem(i.name));
    console.log(`  → ${o._id} | test items: ${testItems.map((i) => `${i.name} x${i.quantity}`).join(", ")}`);
  });

  // Comptage total d'items test
  let totalTestQty = 0;
  allOrders.forEach((o) => {
    o.items.forEach((i) => {
      if (isTestItem(i.name)) totalTestQty += i.quantity || 0;
    });
  });
  console.log(`\n📊 Total quantité items test dans ces ordres : ${totalTestQty.toLocaleString()}`);

  if (DRY_RUN) {
    console.log("\n⛔  DRY RUN — rien n'a été modifié.");
    console.log("    Pour exécuter : DRY_RUN=false node scripts/cleanup-test-items.js\n");
    await mongoose.disconnect();
    return;
  }

  // ── SUPPRESSION ─────────────────────────────────────────────────────────
  let deletedOrders = 0;
  let updatedOrders = 0;

  // 1. Supprimer les ordres 100% test
  if (fullTestOrders.length > 0) {
    const ids = fullTestOrders.map((o) => o._id);
    const result = await Order.deleteMany({ _id: { $in: ids } });
    deletedOrders = result.deletedCount;
    console.log(`\n🗑️  Ordres supprimés : ${deletedOrders}`);
  }

  // 2. Retirer les items test des ordres mixtes
  for (const order of mixedOrders) {
    await Order.updateOne(
      { _id: order._id },
      { $pull: { items: { name: { $regex: /^test( item)?$/i } } } }
    );
    updatedOrders++;
  }
  if (updatedOrders > 0) {
    console.log(`✂️  Ordres mixtes nettoyés : ${updatedOrders}`);
  }

  console.log("\n✅ Nettoyage terminé.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
