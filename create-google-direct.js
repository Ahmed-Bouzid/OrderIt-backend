const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function createGoogleAdminDirect() {
  let client;
  try {
    // Connexion directe MongoDB (sans Mongoose pour contourner validations)
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    console.log('✅ Connecté à MongoDB direct');
    
    const db = client.db();
    const adminsCollection = db.collection('admins');
    
    // Créer l'admin Google directement
    const googleAdmin = {
      serverId: 'GOOGLE_' + Date.now(),
      name: 'Admin (Google)',
      email: 'waraibeatbox@gmail.com',
      authProvider: 'google',
      googleId: 'waraibeatbox_google_' + Date.now(),
      role: 'admin',
      restaurantId: new ObjectId('686af511bb4cba684ff3b72e'),
      createdAt: new Date(),
      __v: 0
    };
    
    const result = await adminsCollection.insertOne(googleAdmin);
    console.log('✅ Admin Google créé avec succès !');
    console.log('ID:', result.insertedId);
    
    // Vérifier
    const created = await adminsCollection.findOne({ email: 'waraibeatbox@gmail.com' });
    if (created) {
      console.log('✅ Vérification : Admin Google trouvé !');
      console.log('- Email:', created.email);
      console.log('- AuthProvider:', created.authProvider);
      console.log('- RestaurantId:', created.restaurantId);
    }
    
    console.log('🎉 Reconnectez-vous avec Google dans l\'app !');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

createGoogleAdminDirect();