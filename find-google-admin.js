const mongoose = require('mongoose');
require('dotenv').config();

async function findAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Chercher tous les admins avec cet email
    console.log('🔍 Recherche de tous les admins avec cet email...');
    const allAdmins = await Admin.find({
      email: 'waraibeatbox@gmail.com'
    });
    
    console.log('Admins trouvés:', allAdmins.length);
    allAdmins.forEach(admin => {
      console.log('- Email:', admin.email);
      console.log('- AuthProvider:', admin.authProvider);
      console.log('- GoogleId:', admin.googleId);
      console.log('- RestaurantId:', admin.restaurantId);
      console.log('---');
    });
    
    // Chercher tous les admins Google
    console.log('🔍 Recherche de tous les admins Google...');
    const googleAdmins = await Admin.find({
      authProvider: 'google'
    });
    
    console.log('Admins Google trouvés:', googleAdmins.length);
    googleAdmins.forEach(admin => {
      console.log('- Email:', admin.email);
      console.log('- GoogleId:', admin.googleId);
      console.log('---');
    });
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

findAdmin();