require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/Order");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connecté\n");

  const TABLE_ID = "6a038d467070bbe3ff0430ef"; // Tab3

  const orders = await Order.find({ tableId: TABLE_ID })
    .populate("serverId", "name email role")
    .populate("tableId", "number name")
    .sort({ createdAt: -1 })
    .lean();

  console.log(`📦 ${orders.length} commande(s) trouvée(s) pour Tab3\n`);

  for (const o of orders) {
    console.log("─────────────────────────────────────");
    console.log(`ID         : ${o._id}`);
    console.log(`Status     : ${o.status}`);
    console.log(`Créée le   : ${o.createdAt}`);
    console.log(`Mise à jour: ${o.updatedAt}`);
    console.log(`ServerId   : ${o.serverId ? JSON.stringify(o.serverId) : "NULL ❌"}`);
    console.log(`SessionId  : ${o.tableSessionId || "NULL ❌"}`);
    console.log(`Origin     : ${o.origin}`);
    console.log(`Total      : ${o.totalAmount}€`);
    console.log(`Items (${o.items?.length}) :`);
    o.items?.forEach((item) => {
      console.log(`  - ${item.name} | status: ${item.itemStatus} | prix: ${item.price}€`);
    });
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
