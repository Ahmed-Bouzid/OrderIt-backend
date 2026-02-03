const mongoose = require('mongoose');
require('dotenv').config();

async function addGoogleToExistingAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Trouver l'admin existant du restaurant Chez Ahmed
    const existingAdmin = await Admin.findOne({
      restaurantId: '686af511bb4cba684ff3b72e'
    });
    
    if (!existingAdmin) {
      console.log('❌ Aucun admin trouvé pour ce restaurant');
      process.exit(1);
    }
    
    console.log('✅ Admin existant trouvé:', existingAdmin.email);
    
    // Ajouter les infos Google à l'admin existant
    existingAdmin.googleId = 'waraibeatbox_google_id';
    // On garde authProvider = "local" pour conserver le login email/password aussi
    
    await existingAdmin.save();
    console.log('✅ Admin existant mis à jour avec Google !');
    
    // Créer un nouvel admin spécifiquement pour Google
    console.log('🔄 Création d\'un admin Google séparé...');
    
    // D'abord, supprimer la contrainte d'un seul admin par restaurant temporairement
    const googleAdmin = new Admin({
      email: 'waraibeatbox@gmail.com',
      name: 'Warai (Google)',
      serverId: 'warai_google_' + Date.now(),
      authProvider: 'google',
      googleId: 'waraibeatbox_google_id_unique',
      restaurantId: '686af511bb4cba684ff3b72e'
    });
    
    // Sauvegarder en ignorant la validation unique restaurant
    await googleAdmin.save({ validateBeforeSave: false });
    console.log('✅ Admin Google créé !');
    console.log('🎉 Reconnectez-vous avec Google dans l\'app !');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

addGoogleToExistingAdmin();