// Corriger le restaurantId de Chloé et Alexandre pour matcher celui de Tom
use("easyqr-db");

const targetRestaurantId = ObjectId("6a0381c865b4fbf2f219e0f0"); // Restaurant de Tom

const result = db.reservations.updateMany(
  {
    clientName: { $in: ["Chloé Laurent", "Alexandre Simon"] }
  },
  {
    $set: { restaurantId: targetRestaurantId }
  }
);

print(`✅ ${result.modifiedCount} réservations mises à jour`);
print(`Restaurant ID: ${targetRestaurantId}`);
