const mongoose = require('mongoose');
require('dotenv').config();

async function findAndAssociateAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Trouver l'admin du restaurant Chez Ahmed
    const restaurantId = '686af511bb4cba684ff3b72e';
    const admin = await Admin.findOne({
      restaurantId: restaurantId
    });
    
    if (!admin) {
      console.log('❌ Aucun admin trouvé pour ce restaurant');
      process.exit(1);
    }
    
    console.log('✅ Admin trouvé pour le restaurant Chez Ahmed:');
    console.log('- ID:', admin._id);
    console.log('- Email:', admin.email);
    console.log('- Nom:', admin.name);
    console.log('- ServerId:', admin.serverId);
    console.log('- AuthProvider:', admin.authProvider);
    console.log('- RestaurantId:', admin.restaurantId);
    
    // Demander confirmation (simulation)
    console.log('\n🤔 Voulez-vous associer votre compte Google à cet admin ?');
    console.log('Cela permettra de vous connecter soit avec:', admin.email);
    console.log('Soit avec votre compte Google: waraibeatbox@gmail.com');
    
    // Association Google à cet admin existant
    console.log('\n🔄 Association en cours...');
    
    // On garde l'email principal mais on ajoute une référence Google
    admin.googleId = 'waraibeatbox_google_' + Date.now();
    // On ajoute un champ pour l'email Google (optionnel)
    admin.googleEmail = 'waraibeatbox@gmail.com';
    
    await admin.save();
    
    console.log('✅ Admin mis à jour avec succès !');
    console.log('🎉 Vous pouvez maintenant vous connecter avec:');
    console.log('- Email/password:', admin.email);
    console.log('- Ou avec Google: waraibeatbox@gmail.com');
    console.log('\n📱 Testez la connexion Google dans l\'app !');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    process.exit(0);
  }
}

findAndAssociateAdmin();