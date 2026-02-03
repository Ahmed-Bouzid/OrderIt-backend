const mongoose = require('mongoose');
require('dotenv').config();

async function updateAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Trouver l'admin Google
    const admin = await Admin.findOne({
      email: 'waraibeatbox@gmail.com',
      authProvider: 'google'
    });
    
    if (!admin) {
      console.log('❌ Admin Google non trouvé');
      process.exit(1);
    }
    
    console.log('✅ Admin trouvé:', admin.email);
    
    // Associer au restaurant
    admin.restaurantId = '686af511bb4cba684ff3b72e';
    await admin.save();
    
    console.log('✅ Admin associé au restaurant Chez Ahmed');
    console.log('🎉 Reconnectez-vous avec Google dans l\'app !');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

updateAdmin();