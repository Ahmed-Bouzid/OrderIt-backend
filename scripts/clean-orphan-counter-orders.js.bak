/**
 * Script de nettoyage des orders orphelins en mode Comptoir
 * 
 * Contexte : Les orders créés AVANT l'implémentation du système tableSessionId
 * peuvent causer des décalages entre l'affichage carte (45€) et modal (0€).
 * 
 * Ce script annule tous les orders comptoir sans tableSessionId valide.
 * 
 * Usage :
 *   node scripts/clean-orphan-counter-orders.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');

async function cleanOrphanCounterOrders() {
  try {
    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Étape 1 : Trouver tous les orders comptoir
    const counterOrders = await Order.find({
      source: 'counter',
      orderStatus: { $ne: 'cancelled' },
    }).select('_id tableSessionId totalAmount createdAt tableId');

    console.log(`📊 ${counterOrders.length} orders comptoir actifs trouvés\n`);

    if (counterOrders.length === 0) {
      console.log('✅ Aucun order orphelin à nettoyer');
      return;
    }

    // Étape 2 : Identifier les orders orphelins (sans session valide)
    const orphans = [];
    const validOrders = [];

    for (const order of counterOrders) {
      if (!order.tableSessionId) {
        // Order sans tableSessionId → orphelin
        orphans.push(order);
        continue;
      }

      // Vérifier si la session existe et est ouverte
      const session = await TableSession.findOne({
        _id: order.tableSessionId,
        billStatus: { $ne: 'closed' },
      });

      if (!session) {
        // Session fermée ou inexistante → orphelin
        orphans.push(order);
      } else {
        validOrders.push(order);
      }
    }

    console.log(`🟢 ${validOrders.length} orders valides (session active)`);
    console.log(`🔴 ${orphans.length} orders orphelins (à annuler)\n`);

    if (orphans.length === 0) {
      console.log('✅ Aucun order orphelin à nettoyer');
      return;
    }

    // Afficher les détails des orphelins
    console.log('📋 Détail des orders orphelins :');
    orphans.forEach((o, i) => {
      console.log(`  ${i+1}. Order ${o._id} - ${o.totalAmount.toFixed(2)}€ - ${new Date(o.createdAt).toLocaleString('fr-FR')} - session: ${o.tableSessionId || 'MISSING'}`);
    });

    console.log('\n⚠️  Ces orders vont être annulés (orderStatus → cancelled)');
    console.log('⏳ Attente de 5 secondes pour annuler (Ctrl+C pour arrêter)...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Étape 3 : Annuler les orders orphelins
    const orphanIds = orphans.map(o => o._id);
    const result = await Order.updateMany(
      { _id: { $in: orphanIds } },
      { $set: { orderStatus: 'cancelled' } }
    );

    console.log(`✅ ${result.modifiedCount} orders orphelins annulés`);
    console.log('\n🔄 Rafraîchissez l\'app frontend pour voir les changements');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB');
  }
}

// Exécution
cleanOrphanCounterOrders()
  .then(() => {
    console.log('\n✅ Script terminé');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Erreur fatale:', err);
    process.exit(1);
  });
