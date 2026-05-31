// Trouver toutes les réservations Tom
use("easyqr-db");

const allToms = db.reservations.find({ clientName: "Tom" }).toArray();

print(`\n📋 ${allToms.length} réservation(s) Tom trouvée(s):\n`);

allToms.forEach((tom, i) => {
  print(`\n=== Tom #${i + 1} ===`);
  print(`_id: ${tom._id}`);
  print(`restaurantId: ${tom.restaurantId}`);
  print(`status: ${tom.status}`);
  print(`date: ${tom.reservationDate}`);
  print(`time: ${tom.reservationTime}`);
  print(`tableId: ${tom.tableId || 'null'}`);
  print(`createdAt: ${tom.createdAt}`);
});

// Chercher la table 3 pour chaque restaurant
print("\n\n🏪 Tables 3 disponibles:");
const tables3 = db.tables.find({ number: 3 }).toArray();
tables3.forEach(t => {
  print(`Table 3 (${t._id}) → restaurant ${t.restaurantId}`);
});
