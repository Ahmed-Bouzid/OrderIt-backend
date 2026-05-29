/**
 * Script de diagnostic rapide : lister les orders d'une table spécifique
 * 
 * Usage :
 *   node scripts/debug-table-orders.js <tableId>
 *   
 * Exemple :
 *   node scripts/debug-table-orders.js 6a038d457070bbe3ff0430e1
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');

async function debugTableOrders(tableId) {
  try {
    if (!tableId) {
      console.error('❌ Usage: node scripts/debug-table-orders.js <tableId>');
      process.exit(1);
    }

    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connecté à MongoDB\n');

    console.log(`🔍 Recherche des orders pour table=${tableId}\n`);

    // Étape 1 : Lister TOUS les orders de cette table (source=counter)
    const allOrders = await Order.find({
      tableId,
      source: 'counter',
    })
      .select('_id tableSessionId totalAmount orderStatus createdAt items')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📊 ${allOrders.length} orders comptoir trouvés pour cette table\n`);

    if (allOrders.length === 0) {
      console.log('✅ Aucun order trouvé pour cette table');
      return;
    }

    // Étape 2 : Regrouper par tableSessionId
    const bySession = {};
    const orphans = [];

    for (const order of allOrders) {
      const sessionId = order.tableSessionId ? String(order.tableSessionId) : 'MISSING';
      
      if (!order.tableSessionId) {
        orphans.push(order);
      } else if (!bySession[sessionId]) {
        bySession[sessionId] = [];
      }
      
      if (order.tableSessionId) {
        bySession[sessionId].push(order);
      }
    }

    // Étape 3 : Afficher par session
    console.log('📋 Orders groupés par session :\n');

    for (const [sessionId, orders] of Object.entries(bySession)) {
      const session = await TableSession.findById(sessionId).select('billStatus openedAt closedAt').lean();
      const sessionStatus = session 
        ? `${session.billStatus} (ouvert ${new Date(session.openedAt).toLocaleString('fr-FR')})`
        : '❌ SESSION INTROUVABLE';

      const total = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const cancelled = orders.filter(o => o.orderStatus === 'cancelled').length;

      console.log(`🔹 Session ${sessionId}`);
      console.log(`   Status: ${sessionStatus}`);
      console.log(`   Orders: ${orders.length} (${cancelled} annulés)`);
      console.log(`   Total: ${total.toFixed(2)}€\n`);

      orders.forEach((o, i) => {
        const itemsCount = o.items?.length || 0;
        console.log(`   ${i+1}. ${o._id}`);
        console.log(`      - ${o.totalAmount.toFixed(2)}€ · ${itemsCount} items · ${o.orderStatus}`);
        console.log(`      - ${new Date(o.createdAt).toLocaleString('fr-FR')}`);
      });
      console.log();
    }

    // Étape 4 : Orders orphelins (sans tableSessionId)
    if (orphans.length > 0) {
      console.log(`🔴 ${orphans.length} orders ORPHELINS (sans tableSessionId) :\n`);
      
      const orphanTotal = orphans.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      console.log(`   Total orphelins: ${orphanTotal.toFixed(2)}€\n`);

      orphans.forEach((o, i) => {
        const itemsCount = o.items?.length || 0;
        console.log(`   ${i+1}. ${o._id}`);
        console.log(`      - ${o.totalAmount.toFixed(2)}€ · ${itemsCount} items · ${o.orderStatus}`);
        console.log(`      - ${new Date(o.createdAt).toLocaleString('fr-FR')}`);
      });
      console.log();
    }

    // Étape 5 : Récapitulatif
    const totalAll = allOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalNonCancelled = allOrders
      .filter(o => o.orderStatus !== 'cancelled')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    console.log('📈 RÉCAPITULATIF :');
    console.log(`   Total brut (tous orders): ${totalAll.toFixed(2)}€`);
    console.log(`   Total net (excl. annulés): ${totalNonCancelled.toFixed(2)}€`);
    console.log(`   Sessions actives: ${Object.keys(bySession).length}`);
    console.log(`   Orders orphelins: ${orphans.length}`);

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB');
  }
}

// Exécution
const tableId = process.argv[2];
debugTableOrders(tableId)
  .then(() => {
    console.log('\n✅ Diagnostic terminé');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Erreur fatale:', err);
    process.exit(1);
  });
