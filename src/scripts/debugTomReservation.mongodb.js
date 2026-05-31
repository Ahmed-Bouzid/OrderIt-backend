// Vérifier la réservation Tom et ses tableId/tableIds
use("easyqr-db");

const tom = db.reservations.findOne({ clientName: "Tom" });

print("\n📋 Réservation Tom:");
print(JSON.stringify(tom, null, 2));

print("\n🔍 Vérification:");
print(`tableId: ${tom.tableId}`);
print(`tableIds: ${JSON.stringify(tom.tableIds)}`);

// Trouver la table 3 pour comparer l'ID
const table3 = db.tables.findOne({ 
  restaurantId: tom.restaurantId,
  number: 3 
});

if (table3) {
  print(`\n✅ Table 3 trouvée: ${table3._id}`);
  
  const tableIdMatch = tom.tableId && tom.tableId.toString() === table3._id.toString();
  const tableIdsMatch = tom.tableIds && tom.tableIds.some(tid => tid.toString() === table3._id.toString());
  
  print(`\nMatch tableId: ${tableIdMatch}`);
  print(`Match tableIds: ${tableIdsMatch}`);
  
  if (!tableIdMatch && !tableIdsMatch) {
    print("\n❌ PROBLÈME: tableId ne matche pas la table 3!");
  }
} else {
  print("\n❌ Table 3 non trouvée");
}
