/**
 * seedServersBaghera.js
 *
 * Crée 10 serveurs + 1 manager pour le restaurant Baghera.
 * Restaurant : Baghera — 29 Grand Rue, 13002 Marseille
 * _id        : 6a0381c865b4fbf2f219e0f0
 *
 * Usage :
 *   cd backend
 *   node scripts/seedServersBaghera.js
 *
 * Options :
 *   --reset   Supprime d'abord les comptes créés par ce script avant de les recréer
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Server = require("../models/Server");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const RESTAURANT_ID = new mongoose.Types.ObjectId("6a0381c865b4fbf2f219e0f0");
const RESET = process.argv.includes("--reset");

const STAFF = [
  // ── Manager ───────────────────────────────
  {
    name: "Djamel Kouider",
    email: "djamel.kouider@baghera.fr",
    serverId: "baghera-manager-djamel",
    password: "Baghera@Manager2026",
    role: "manager",
  },
  // ── Serveurs ──────────────────────────────
  {
    name: "Amine Saïd",
    email: "amine.said@baghera.fr",
    serverId: "baghera-srv-amine",
    password: "Baghera@Amine26!",
    role: "server",
  },
  {
    name: "Leila Hadj",
    email: "leila.hadj@baghera.fr",
    serverId: "baghera-srv-leila",
    password: "Baghera@Leila26!",
    role: "server",
  },
  {
    name: "Romain Ferri",
    email: "romain.ferri@baghera.fr",
    serverId: "baghera-srv-romain",
    password: "Baghera@Romain26!",
    role: "server",
  },
  {
    name: "Sara Benali",
    email: "sara.benali@baghera.fr",
    serverId: "baghera-srv-sara",
    password: "Baghera@Sara2026!",
    role: "server",
  },
  {
    name: "Mehdi Oussama",
    email: "mehdi.oussama@baghera.fr",
    serverId: "baghera-srv-mehdi",
    password: "Baghera@Mehdi26!",
    role: "server",
  },
  {
    name: "Inès Moreau",
    email: "ines.moreau@baghera.fr",
    serverId: "baghera-srv-ines",
    password: "Baghera@Ines2026!",
    role: "server",
  },
  {
    name: "Karim Djelloul",
    email: "karim.djelloul@baghera.fr",
    serverId: "baghera-srv-karim",
    password: "Baghera@Karim26!",
    role: "server",
  },
  {
    name: "Yasmine Chérif",
    email: "yasmine.cherif@baghera.fr",
    serverId: "baghera-srv-yasmine",
    password: "Baghera@Yasmin26!",
    role: "server",
  },
  {
    name: "Thomas Ricci",
    email: "thomas.ricci@baghera.fr",
    serverId: "baghera-srv-thomas",
    password: "Baghera@Thomas26!",
    role: "server",
  },
  {
    name: "Nadia Bensaïd",
    email: "nadia.bensaid@baghera.fr",
    serverId: "baghera-srv-nadia",
    password: "Baghera@Nadia26!",
    role: "server",
  },
];

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGO_URI ou MONGODB_URI non défini dans .env");
    process.exit(1);
  }

  console.log("Connexion a MongoDB...");
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 20000,
  });
  console.log(`Connecte - Restaurant Baghera (${RESTAURANT_ID})\n`);

  // ── Reset optionnel ──────────────────────────
  if (RESET) {
    console.log("--reset : suppression des comptes Baghera existants...");
    const emails = STAFF.map((s) => s.email);
    const result = await Server.deleteMany({ email: { $in: emails } });
    console.log(`  ${result.deletedCount} compte(s) supprime(s)\n`);
  }

  // ── Création des comptes ─────────────────────
  console.log("Creation des comptes...\n");
  const SALT_ROUNDS = 10;

  for (const member of STAFF) {
    const existing = await Server.findOne({ email: member.email });
    if (existing) {
      console.log(
        `  SKIP ${member.name} (${member.role}) - deja present (id: ${existing._id})`
      );
      continue;
    }

    const passwordHash = await bcrypt.hash(member.password, SALT_ROUNDS);

    const doc = await Server.create({
      restaurantId: RESTAURANT_ID,
      serverId: member.serverId,
      name: member.name,
      email: member.email,
      passwordHash,
      authProvider: "local",
      role: member.role,
    });

    const icon = member.role === "manager" ? "[MANAGER]" : "[SERVER]";
    console.log(
      `  ${icon} ${member.name} (${member.role}) cree - id: ${doc._id}`
    );
  }

  const managerCount = STAFF.filter((s) => s.role === "manager").length;
  const serverCount = STAFF.filter((s) => s.role === "server").length;

  console.log(
    `\nTermine - ${managerCount} manager + ${serverCount} serveurs pour Baghera`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Erreur :", err.message);
  process.exit(1);
});
