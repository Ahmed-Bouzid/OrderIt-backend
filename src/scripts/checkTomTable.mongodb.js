// Vérifier quelle table est assignée à Tom
use("easyqr-db");

const tomId = ObjectId("6a18bb89783bc48d240d7cab");
const tom = db.reservations.findOne({ _id: tomId });

print(`\n📋 Tom (${tomId}):`);
print(`restaurantId: ${tom.restaurantId}`);
print(`tableId: ${tom.tableId}`);

if (tom.tableId) {
  const table = db.tables.findOne({ _id: tom.tableId });
  if (table) {
    print(`\n✅ Table trouvée:`);
    print(`  number: ${table.number}`);
    print(`  capacity: ${table.capacity}`);
    print(`  restaurantId: ${table.restaurantId}`);
  } else {
    print(`\n❌ Table ${tom.tableId} non trouvée en BDD`);
  }
}

// Lister toutes les tables du restaurant de Tom
print(`\n\n🏪 Toutes les tables du restaurant ${tom.restaurantId}:`);
const allTables = db.tables.find({ restaurantId: tom.restaurantId }).toArray();
allTables.forEach(t => {
  print(`  Table ${t.number} (${t._id})`);
});
