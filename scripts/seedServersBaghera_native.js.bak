/**
 * seedServersBaghera_native.js
 * Utilise le driver mongodb natif (pas mongoose) pour éviter les blocages.
 *
 * Usage :
 *   cd backend
 *   node scripts/seedServersBaghera_native.js
 *   node scripts/seedServersBaghera_native.js --reset
 */

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");

const RESTAURANT_ID = new ObjectId("6a0381c865b4fbf2f219e0f0");
const RESET = process.argv.includes("--reset");

const STAFF = [
  { name: "Djamel Kouider",  email: "djamel.kouider@baghera.fr",  serverId: "baghera-manager-djamel", password: "Baghera@Manager2026",  role: "manager" },
  { name: "Amine Said",      email: "amine.said@baghera.fr",      serverId: "baghera-srv-amine",       password: "Baghera@Amine26!",      role: "server" },
  { name: "Leila Hadj",      email: "leila.hadj@baghera.fr",      serverId: "baghera-srv-leila",       password: "Baghera@Leila26!",      role: "server" },
  { name: "Romain Ferri",    email: "romain.ferri@baghera.fr",    serverId: "baghera-srv-romain",      password: "Baghera@Romain26!",     role: "server" },
  { name: "Sara Benali",     email: "sara.benali@baghera.fr",     serverId: "baghera-srv-sara",        password: "Baghera@Sara2026!",     role: "server" },
  { name: "Mehdi Oussama",   email: "mehdi.oussama@baghera.fr",   serverId: "baghera-srv-mehdi",       password: "Baghera@Mehdi26!",      role: "server" },
  { name: "Ines Moreau",     email: "ines.moreau@baghera.fr",     serverId: "baghera-srv-ines",        password: "Baghera@Ines2026!",     role: "server" },
  { name: "Karim Djelloul",  email: "karim.djelloul@baghera.fr",  serverId: "baghera-srv-karim",       password: "Baghera@Karim26!",      role: "server" },
  { name: "Yasmine Cherif",  email: "yasmine.cherif@baghera.fr",  serverId: "baghera-srv-yasmine",     password: "Baghera@Yasmin26!",     role: "server" },
  { name: "Thomas Ricci",    email: "thomas.ricci@baghera.fr",    serverId: "baghera-srv-thomas",      password: "Baghera@Thomas26!",     role: "server" },
  { name: "Nadia Bensaid",   email: "nadia.bensaid@baghera.fr",   serverId: "baghera-srv-nadia",       password: "Baghera@Nadia26!",      role: "server" },
];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error("MONGO_URI non defini"); process.exit(1); }

  console.log("Connexion MongoDB...");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  console.log("Connecte.\n");

  const db = client.db();
  const servers = db.collection("servers");

  if (RESET) {
    const emails = STAFF.map((s) => s.email);
    const r = await servers.deleteMany({ email: { $in: emails } });
    console.log(`Reset: ${r.deletedCount} compte(s) supprime(s)\n`);
  }

  console.log("Creation des comptes...\n");
  const SALT = 10;

  for (const m of STAFF) {
    const existing = await servers.findOne({ email: m.email });
    if (existing) {
      console.log(`  SKIP ${m.name} (${m.role}) - deja present`);
      continue;
    }
    const passwordHash = await bcrypt.hash(m.password, SALT);
    const result = await servers.insertOne({
      restaurantId: RESTAURANT_ID,
      serverId: m.serverId,
      name: m.name,
      email: m.email,
      passwordHash,
      authProvider: "local",
      role: m.role,
      createdAt: new Date(),
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: [],
    });
    console.log(`  OK [${m.role.toUpperCase()}] ${m.name} - id: ${result.insertedId}`);
  }

  const managers = STAFF.filter((s) => s.role === "manager").length;
  const srvs = STAFF.filter((s) => s.role === "server").length;
  console.log(`\nTermine: ${managers} manager + ${srvs} serveurs crees pour Baghera.`);

  await client.close();
}

main().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
