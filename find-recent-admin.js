const mongoose = require('mongoose');
require('dotenv').config();

async function findRecentAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Chercher les admins créés récemment (dernières 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    console.log('🔍 Recherche admins créés récemment...');
    const recentAdmins = await Admin.find({
      createdAt: { $gte: yesterday }
    }).sort({ createdAt: -1 });
    
    console.log('Admins récents trouvés:', recentAdmins.length);
    recentAdmins.forEach(admin => {
      console.log('- Email:', admin.email);
      console.log('- AuthProvider:', admin.authProvider);
      console.log('- CreatedAt:', admin.createdAt);
      console.log('- RestaurantId:', admin.restaurantId);
      console.log('---');
    });
    
    // Si on trouve l'admin Google, l'associer au restaurant
    const googleAdmin = recentAdmins.find(admin => 
      admin.email === 'waraibeatbox@gmail.com' && admin.authProvider === 'google'
    );
    
    if (googleAdmin) {
      console.log('✅ Admin Google trouvé ! Association au restaurant...');
      googleAdmin.restaurantId = '686af511bb4cba684ff3b72e';
      await googleAdmin.save();
      console.log('🎉 Admin associé au restaurant Chez Ahmed !');
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

findRecentAdmin();