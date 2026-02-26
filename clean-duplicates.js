#!/usr/bin/env node
const mongoose = require('mongoose');
require('dotenv').config();
const Product = require('./models/Product');

const RESTAURANT_ID = '69a035934b395eaaba6b8d21';

async function cleanDuplicates() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté MongoDB');

    // Supprimer DÉFINITIVEMENT tous les anciens produits
    const deleted = await Product.deleteMany({
      restaurantId: RESTAURANT_ID,
      $or: [
        { archived: true },
        { archived: { $exists: false } },
        { available: false }
      ]
    });
    
    console.log(`🗑️ ${deleted.deletedCount} produits supprimés`);
    
    // Vérifier ce qui reste
    const remaining = await Product.find({
      restaurantId: RESTAURANT_ID
    }).select('name archived available options');
    
    console.log(`📋 ${remaining.length} produits restants`);
    
    // Vérifier les doublons Menu Enfant
    const menuEnfants = remaining.filter(p => /Menu Enfant/i.test(p.name));
    console.log(`\n👶 Menu Enfant trouvés: ${menuEnfants.length}`);
    menuEnfants.forEach((p, i) => {
      console.log(`${i+1}. ${p.name} - archived:${p.archived} - available:${p.available} - options:${p.options?.length || 0}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
}

cleanDuplicates();
