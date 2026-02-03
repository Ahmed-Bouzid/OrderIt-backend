const mongoose = require('mongoose');
require('dotenv').config();

async function checkAdminState() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Chercher l'admin par différents critères
    console.log('🔍 Recherche admin par email waraibeatbox@gmail.com...');
    const adminByEmail = await Admin.findOne({ email: 'waraibeatbox@gmail.com' });
    console.log('Admin par email:', adminByEmail ? 'TROUVÉ' : 'NON TROUVÉ');
    
    console.log('🔍 Recherche admin par googleEmail...');
    const adminByGoogleEmail = await Admin.findOne({ googleEmail: 'waraibeatbox@gmail.com' });
    console.log('Admin par googleEmail:', adminByGoogleEmail ? 'TROUVÉ' : 'NON TROUVÉ');
    
    console.log('🔍 Recherche admin du restaurant Chez Ahmed...');
    const adminByRestaurant = await Admin.findOne({ restaurantId: '686af511bb4cba684ff3b72e' });
    
    if (adminByRestaurant) {
      console.log('✅ Admin du restaurant trouvé:');
      console.log('- Email:', adminByRestaurant.email);
      console.log('- GoogleEmail:', adminByRestaurant.googleEmail);
      console.log('- GoogleId:', adminByRestaurant.googleId);
      console.log('- AuthProvider:', adminByRestaurant.authProvider);
      console.log('- RestaurantId:', adminByRestaurant.restaurantId);
    }
    
    // Le problème : le backend cherche par email exact
    // Il faut que l'admin ait email="waraibeatbox@gmail.com" OU que le code soit modifié
    
    console.log('\n🔧 Solution : Modifier l\'email principal pour Google...');
    if (adminByRestaurant && adminByRestaurant.googleEmail) {
      // Swap les emails
      const originalEmail = adminByRestaurant.email;
      adminByRestaurant.email = adminByRestaurant.googleEmail; // devient waraibeatbox@gmail.com
      adminByRestaurant.originalEmail = originalEmail; // garde admin@burger.com
      
      await adminByRestaurant.save();
      console.log('✅ Email principal changé pour Google !');
      console.log('✅ Email original sauvegardé dans originalEmail');
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

checkAdminState();