const mongoose = require('mongoose');
require('dotenv').config();

async function createGoogleAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Créer l'admin Google manuellement
    const googleAdmin = new Admin({
      email: 'waraibeatbox@gmail.com',
      name: 'Warai Admin',
      serverId: 'warai_google_' + Date.now(),
      authProvider: 'google',
      googleId: 'temp_google_id', // Sera remplacé par le vrai à la prochaine connexion
      restaurantId: '686af511bb4cba684ff3b72e'
    });
    
    await googleAdmin.save();
    console.log('✅ Admin Google créé et associé au restaurant Chez Ahmed !');
    console.log('🎉 Reconnectez-vous avec Google dans l\'app !');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

createGoogleAdmin();