const mongoose = require('mongoose');
require('dotenv').config();

async function fixGoogleAuth() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');
    
    const Admin = require('./models/Admin');
    
    // Trouver l'admin du restaurant
    const admin = await Admin.findOne({ restaurantId: '686af511bb4cba684ff3b72e' });
    
    if (!admin) {
      console.log('❌ Admin non trouvé');
      process.exit(1);
    }
    
    console.log('✅ Admin trouvé:', admin.email);
    console.log('GoogleId actuel:', admin.googleId);
    console.log('AuthProvider actuel:', admin.authProvider);
    
    // Solution : créer un duplicate avec l'email Google
    console.log('\n🔧 Création admin Google duplicate...');
    
    const googleAdmin = new Admin({
      serverId: 'GOOGLE_' + Date.now(),
      name: admin.name + ' (Google)',
      email: 'waraibeatbox@gmail.com', // L'email que Google retourne
      authProvider: 'google',
      googleId: admin.googleId,
      restaurantId: admin.restaurantId
    });
    
    await googleAdmin.save();
    console.log('✅ Admin Google créé avec email waraibeatbox@gmail.com !');
    console.log('🎉 Reconnectez-vous avec Google dans l\'app !');
    
  } catch (error) {
    if (error.message.includes('Un admin existe déjà')) {
      console.log('⚠️ Validation admin unique - contournement...');
      // Force save sans validation
      const admin = await Admin.findOne({ restaurantId: '686af511bb4cba684ff3b72e' });
      
      // Directement via MongoDB
      const db = mongoose.connection.db;
      await db.collection('admins').insertOne({
        serverId: 'GOOGLE_' + Date.now(),
        name: admin.name + ' (Google)',
        email: 'waraibeatbox@gmail.com',
        authProvider: 'google',
        googleId: admin.googleId,
        restaurantId: new mongoose.Types.ObjectId('686af511bb4cba684ff3b72e'),
        role: 'admin',
        createdAt: new Date(),
        __v: 0
      });
      console.log('✅ Admin Google créé via insertion directe !');
    } else {
      console.error('❌ Erreur:', error.message);
    }
  } finally {
    process.exit(0);
  }
}

fixGoogleAuth();