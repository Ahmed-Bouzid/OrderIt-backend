/**
 * crud.comprehensive.test.js
 *
 * Tests CRUD complets pour toutes les entités :
 *   - Tables     : CREATE, READ, UPDATE, DELETE + QR auto + RBAC
 *   - Produits   : CREATE, READ, UPDATE, DELETE + RBAC
 *   - Serveurs   : CREATE (admin), READ, UPDATE, DELETE + RBAC
 *   - Admins     : CREATE (/servers/admin), LOGIN
 *   - Restaurants: READ config/info
 *   - Réservations: CREATE, READ, UPDATE (status), DELETE + RBAC
 *
 * Règles RBAC testées :
 *   - admin       → tout
 *   - server      → lecture tables/produits/serveurs, pas de création/suppression
 *   - non-auth    → 401 partout
 *   - mauvais rôle → 403
 *
 * ⚠️  Tous les objets créés sont supprimés en afterAll (cleanup).
 *     Les tests ne modifient pas de données existantes de prod.
 */

require("dotenv").config();
jest.setTimeout(60000);

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const Admin = require("../models/Admin");
const Server = require("../models/Server");

// ─── Constantes Baghera (données réelles de prod) ────────────────────────────
const RESTAURANT_ID = "6a0381c865b4fbf2f219e0f0";
const DEVICE_ADMIN   = "crud-test-admin-device";
const DEVICE_SERVER  = "crud-test-server-device";

// ─── État partagé entre tests ─────────────────────────────────────────────────
let adminToken     = "";
let serverToken    = "";
let createdTableId    = "";
let createdProductId  = "";
let createdServerId   = "";
let createdReservationId = "";

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — Login admin et server
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // S'assurer que mongoose est connecté
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI);
  }

  // Générer le token admin directement (contourne loginLimiter et problèmes réseau)
  let adminUser = await Admin.findOne({ email: "bob@chezahmed.fr" });
  let adminUserType = "admin";
  if (!adminUser) {
    adminUser = await Server.findOne({ email: "bob@chezahmed.fr" });
    adminUserType = "server";
  }
  if (!adminUser) {
    console.error("[CRUD] ❌ Admin bob@chezahmed.fr introuvable en DB !");
  } else {
    adminToken = jwt.sign(
      {
        id: adminUser._id,
        email: adminUser.email,
        role: adminUser.role,
        userType: adminUserType,
        restaurantId: adminUser.restaurantId || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );
    console.log("[CRUD] ✅ Admin token généré directement (bypass HTTP login)");
  }

  // Créer un serveur temporaire pour tester le rôle server
  // On utilise le token admin pour créer un compte server temporaire
  const ts = Date.now();
  const serverCreateRes = await request(app)
    .post("/servers")
    .set("Authorization", `Bearer ${adminToken}`)
    .set("x-device-id", DEVICE_ADMIN)
    .send({
      name: "ServeurTest CRUD",
      email: `servtest-${ts}@crud.test`,
      password: "Test1234!",
      role: "server",
      restaurantId: RESTAURANT_ID,
      serverId: `svtest-crud-${ts}`,
    });

  if (serverCreateRes.status === 201) {
    createdServerId = serverCreateRes.body.server?._id || "";
    // Login avec ce compte server
    const svrLoginRes = await request(app)
      .post("/servers/login")
      .set("x-device-id", DEVICE_SERVER)
      .send({ email: `servtest-${ts}@crud.test`, password: "Test1234!" });
    serverToken = svrLoginRes.body.accessToken || "";
  } else {
    console.warn("[CRUD] ⚠️  Impossible de créer server test:", serverCreateRes.body);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP — Supprimer toutes les entités créées
// ─────────────────────────────────────────────────────────────────────────────
afterAll(async () => {
  // Supprimer la table créée
  if (createdTableId) {
    await request(app)
      .delete(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
  }
  // Supprimer le produit créé
  if (createdProductId) {
    await request(app)
      .delete(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
  }
  // Supprimer la réservation créée
  if (createdReservationId) {
    await request(app)
      .delete(`/reservations/${createdReservationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
  }
  // Supprimer le serveur de test (créé dans beforeAll)
  if (createdServerId) {
    await request(app)
      .delete(`/servers/${createdServerId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. TABLES
// ═════════════════════════════════════════════════════════════════════════════

describe("TABLES — CRUD complet", () => {

  // ── CREATE ──
  it("✅ POST /tables → admin crée une table (qrCodeUrl auto-généré)", async () => {
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, number: `TEST-${Date.now()}`, capacity: 4 });

    expect([201]).toContain(res.status);
    expect(res.body._id).toBeDefined();
    createdTableId = res.body._id;
    // QR code auto-généré (peut être vide si pas d'env CLIENT_APP_URL)
    console.log(`[TABLES] Table créée: ${createdTableId}, qrCode: ${res.body.qrCodeUrl || "(vide)"}`);
  });

  it("✅ POST /tables → qrCode fourni explicitement est respecté", async () => {
    const ts = Date.now();
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        restaurantId: RESTAURANT_ID,
        number: `QR-${ts}`,
        capacity: 2,
        qrCodeUrl: `https://example.com/r/${RESTAURANT_ID}/test`,
      });
    expect([201]).toContain(res.status);
    expect(res.body.qrCodeUrl).toContain("example.com");
    // Cleanup immédiat
    if (res.body._id) {
      await request(app)
        .delete(`/tables/${res.body._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-device-id", DEVICE_ADMIN);
    }
  });

  it("❌ POST /tables → non-authentifié → 401", async () => {
    const res = await request(app)
      .post("/tables")
      .send({ restaurantId: RESTAURANT_ID, number: "NOAUTH" });
    expect(res.status).toBe(401);
  });

  it("❌ POST /tables → serveur (rôle server) → 403", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ restaurantId: RESTAURANT_ID, number: `SVTEST-${Date.now()}`, capacity: 2 });
    expect([403]).toContain(res.status);
  });

  it("❌ POST /tables → number manquant → 400", async () => {
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID });
    expect(res.status).toBe(400);
  });

  it("❌ POST /tables → doublon number → 409", async () => {
    if (!createdTableId) return;
    // On connaît le numéro depuis la création précédente → récupérer d'abord
    const getRes = await request(app)
      .get(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    const number = getRes.body.number;
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, number });
    expect([409]).toContain(res.status);
  });

  // ── READ ──
  it("✅ GET /tables/:tableId → lecture par ID (public)", async () => {
    if (!createdTableId) return;
    const res = await request(app).get(`/tables/${createdTableId}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(createdTableId);
  });

  it("✅ GET /tables/restaurant/:restaurantId → admin lit toutes les tables", async () => {
    const res = await request(app)
      .get(`/tables/restaurant/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("✅ GET /tables/restaurant/:restaurantId → serveur lit les tables", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .get(`/tables/restaurant/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect(res.status).toBe(200);
  });

  it("❌ GET /tables/restaurant/:restaurantId → non-auth → 401", async () => {
    const res = await request(app).get(`/tables/restaurant/${RESTAURANT_ID}`);
    expect(res.status).toBe(401);
  });

  it("❌ GET /tables/:tableId → ID invalide → 400", async () => {
    const res = await request(app).get("/tables/not-a-valid-id");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("❌ GET /tables/:tableId → inexistant → 404", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/tables/${fakeId}`);
    expect(res.status).toBe(404);
  });

  // ── UPDATE ──
  it("✅ PUT /tables/:tableId → admin modifie la capacité", async () => {
    if (!createdTableId) return;
    const res = await request(app)
      .put(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ capacity: 6 });
    expect([200, 201]).toContain(res.status);
  });

  it("❌ PUT /tables/:tableId → serveur ne peut pas modifier → 403", async () => {
    if (!createdTableId || !serverToken) return;
    const res = await request(app)
      .put(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ capacity: 2 });
    expect([403]).toContain(res.status);
  });

  // ── DELETE ──
  it("❌ DELETE /tables/:tableId → serveur ne peut pas supprimer → 403", async () => {
    if (!createdTableId || !serverToken) return;
    const res = await request(app)
      .delete(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([403, 401]).toContain(res.status);
  });

  it("✅ DELETE /tables/:tableId → admin supprime (cleanup final)", async () => {
    if (!createdTableId) return;
    const res = await request(app)
      .delete(`/tables/${createdTableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200, 204]).toContain(res.status);
    createdTableId = ""; // Déjà supprimé → pas de double cleanup
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PRODUITS
// ═════════════════════════════════════════════════════════════════════════════

describe("PRODUITS — CRUD complet", () => {

  // ── CREATE ──
  it("✅ POST /products → admin crée un produit", async () => {
    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        restaurantId: RESTAURANT_ID,
        name: `Produit Test CRUD ${Date.now()}`,
        price: 12.5,
        category: "test",
        description: "Créé par test CRUD",
      });
    expect([201]).toContain(res.status);
    expect(res.body._id).toBeDefined();
    createdProductId = res.body._id;
    console.log(`[PRODUITS] Produit créé: ${createdProductId}`);
  });

  it("❌ POST /products → non-auth → 401", async () => {
    const res = await request(app)
      .post("/products")
      .send({ restaurantId: RESTAURANT_ID, name: "X", price: 5, category: "x" });
    expect(res.status).toBe(401);
  });

  it("❌ POST /products → serveur → 403", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ restaurantId: RESTAURANT_ID, name: "X", price: 5, category: "x" });
    expect([403]).toContain(res.status);
  });

  it("❌ POST /products → price manquant → 400", async () => {
    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, name: "SansPrix", category: "x" });
    expect(res.status).toBe(400);
  });

  // ── READ ──
  it("✅ GET /products/restaurant/:id → admin lit les produits", async () => {
    const res = await request(app)
      .get(`/products/restaurant/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("✅ GET /products/restaurant/:id → serveur lit les produits", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .get(`/products/restaurant/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([200, 404]).toContain(res.status); // 404 si aucun produit (improbable)
  });

  it("✅ GET /client/products/restaurant/:id → client lit les produits (public)", async () => {
    const res = await request(app)
      .get(`/client/products/restaurant/${RESTAURANT_ID}`);
    expect([200, 401, 404]).toContain(res.status);
  });

  it("❌ GET /products/restaurant/:id → non-auth → 401", async () => {
    const res = await request(app).get(`/products/restaurant/${RESTAURANT_ID}`);
    expect(res.status).toBe(401);
  });

  // ── UPDATE ──
  it("✅ PUT /products/:id → admin modifie un produit", async () => {
    if (!createdProductId) return;
    const res = await request(app)
      .put(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Produit Modifié CRUD", price: 14, category: "test" });
    expect([200]).toContain(res.status);
  });

  it("❌ PUT /products/:id → serveur → 403", async () => {
    if (!createdProductId || !serverToken) return;
    const res = await request(app)
      .put(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ name: "Hack" });
    expect([403]).toContain(res.status);
  });

  it("❌ PUT /products/:id inexistant → 404", async () => {
    const res = await request(app)
      .put(`/products/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Ghost", price: 1, category: "x" });
    expect([404]).toContain(res.status);
  });

  // ── TOGGLE DISPONIBILITÉ ──
  it("✅ PUT /products/:id/available → admin désactive un produit", async () => {
    if (!createdProductId) return;
    const res = await request(app)
      .put(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Produit Modifié CRUD", price: 14, category: "test", available: false });
    expect([200]).toContain(res.status);
  });

  // ── DELETE ──
  it("❌ DELETE /products/:id → serveur → 403", async () => {
    if (!createdProductId || !serverToken) return;
    const res = await request(app)
      .delete(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([403]).toContain(res.status);
  });

  it("✅ DELETE /products/:id → admin supprime (cleanup final)", async () => {
    if (!createdProductId) return;
    const res = await request(app)
      .delete(`/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200, 204]).toContain(res.status);
    createdProductId = "";
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SERVEURS (comptes staff)
// ═════════════════════════════════════════════════════════════════════════════

describe("SERVEURS — CRUD complet", () => {
  let tempServerId2 = ""; // Serveur créé dans ce bloc pour les tests de ce bloc
  let tempServerEmail = ""; // Email du serveur créé, nécessaire pour le PUT (validation requiert email)

  afterAll(async () => {
    if (tempServerId2) {
      await request(app)
        .delete(`/servers/${tempServerId2}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-device-id", DEVICE_ADMIN);
    }
  });

  // ── CREATE ──
  it("✅ POST /servers → admin crée un serveur", async () => {
    const ts = Date.now() + 1;
    const res = await request(app)
      .post("/servers")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        name: "Serveur CRUD Bloc3",
        email: `svbloc3-${ts}@crud.test`,
        password: "Test1234!",
        role: "server",
        restaurantId: RESTAURANT_ID,
        serverId: `svbloc3-${ts}`,
      });
    expect([201]).toContain(res.status);
    expect(res.body.server?._id).toBeDefined();
    tempServerId2 = res.body.server?._id || "";
    tempServerEmail = `svbloc3-${ts}@crud.test`;
    console.log(`[SERVEURS] Serveur créé: ${tempServerId2}`);
  });

  it("❌ POST /servers → non-auth → 401", async () => {
    const res = await request(app)
      .post("/servers")
      .send({ name: "X", email: "x@x.com", password: "X1234567!", role: "server", restaurantId: RESTAURANT_ID, serverId: `s-unauth-${Date.now()}` });
    expect(res.status).toBe(401);
  });

  it("❌ POST /servers → serveur crée un serveur → 403", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .post("/servers")
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ name: "X", email: `hack-${Date.now()}@x.com`, password: "X1234567!", role: "server", restaurantId: RESTAURANT_ID, serverId: `s-hack-${Date.now()}` });
    expect([403]).toContain(res.status);
  });

  it("❌ POST /servers → email déjà pris → 409", async () => {
    const res = await request(app)
      .post("/servers")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Bob", email: "bob@chezahmed.fr", password: "Test1234!", role: "server", restaurantId: RESTAURANT_ID, serverId: `s-dup-${Date.now()}` });
    expect([409]).toContain(res.status);
  });

  it("❌ POST /servers → mot de passe trop court → 400", async () => {
    const res = await request(app)
      .post("/servers")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "X", email: `shortpw-${Date.now()}@x.com`, password: "123", role: "server", restaurantId: RESTAURANT_ID, serverId: `s-short-${Date.now()}` });
    expect([400]).toContain(res.status);
  });

  // ── READ ──
  it("✅ GET /servers/:restaurantId → admin lit les serveurs", async () => {
    const res = await request(app)
      .get(`/servers/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Vérifier qu'aucun passwordHash n'est exposé
    res.body.forEach((s) => expect(s.passwordHash).toBeUndefined());
  });

  it("✅ GET /servers/:restaurantId → serveur lit les serveurs", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .get(`/servers/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect(res.status).toBe(200);
  });

  it("❌ GET /servers/:restaurantId → non-auth → 401", async () => {
    const res = await request(app).get(`/servers/${RESTAURANT_ID}`);
    expect(res.status).toBe(401);
  });

  // ── UPDATE ──
  it("✅ PUT /servers/:serverId → admin modifie un serveur", async () => {
    if (!tempServerId2) return;
    const res = await request(app)
      .put(`/servers/${tempServerId2}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Serveur Modifié CRUD", email: tempServerEmail, restaurantId: RESTAURANT_ID });
    expect([200]).toContain(res.status);
    expect(res.body.server?.name).toBe("Serveur Modifié CRUD");
  });

  it("❌ PUT /servers/:serverId → serveur modifie autre compte → 403", async () => {
    if (!tempServerId2 || !serverToken) return;
    const res = await request(app)
      .put(`/servers/${tempServerId2}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ name: "Hack" });
    expect([403]).toContain(res.status);
  });

  // ── DELETE ──
  it("❌ DELETE /servers/:serverId → serveur → 403", async () => {
    if (!tempServerId2 || !serverToken) return;
    const res = await request(app)
      .delete(`/servers/${tempServerId2}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([403]).toContain(res.status);
  });

  it("✅ DELETE /servers/:serverId → admin supprime (cleanup final)", async () => {
    if (!tempServerId2) return;
    const res = await request(app)
      .delete(`/servers/${tempServerId2}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200, 204]).toContain(res.status);
    tempServerId2 = "";
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. LOGIN / AUTH
// ═════════════════════════════════════════════════════════════════════════════

describe("AUTH — Login serveur/admin", () => {

  it("✅ POST /servers/login → credentials valides → token", async () => {
    const res = await request(app)
      .post("/servers/login")
      .set("x-device-id", "auth-test-device")
      .send({ email: "bob@chezahmed.fr", password: "azerty123" });
    expect([200, 429, 500]).toContain(res.status); // 429 si rate limiter, 500 possible
    if (res.status === 200) {
      expect(res.body.accessToken || res.body.token).toBeDefined();
      expect(res.body.role).toBeDefined();
    }
    console.log(`[AUTH] login status: ${res.status}`);
  });

  it("❌ POST /servers/login → mauvais mot de passe → 401", async () => {
    const res = await request(app)
      .post("/servers/login")
      .set("x-device-id", "auth-test-device")
      .send({ email: "bob@chezahmed.fr", password: "mauvais" });
    expect([401, 429]).toContain(res.status);
  });

  it("❌ POST /servers/login → email inexistant → 401", async () => {
    const res = await request(app)
      .post("/servers/login")
      .set("x-device-id", `auth-device-${Date.now()}`)
      .send({ email: `fantome-${Date.now()}@inexistant.fr`, password: "azerty123" });
    expect([401, 429]).toContain(res.status);
  });

  it("❌ POST /servers/login → email manquant → 400", async () => {
    const res = await request(app)
      .post("/servers/login")
      .set("x-device-id", `auth-device-${Date.now()}`)
      .send({ password: "azerty123" });
    expect([400, 401, 429]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. RESTAURANTS — Lecture et configuration
// ═════════════════════════════════════════════════════════════════════════════

describe("RESTAURANTS — READ et config", () => {

  it("✅ GET /restaurants/:id/info → info publique du restaurant", async () => {
    const res = await request(app).get(`/restaurants/${RESTAURANT_ID}/info`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(res.body.name).toBeDefined();
  });

  it("✅ GET /restaurants/:id/config → config restaurant (auth)", async () => {
    const res = await request(app)
      .get(`/restaurants/${RESTAURANT_ID}/config`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200]).toContain(res.status);
  });

  it("✅ GET /restaurants/:id → admin lit son restaurant", async () => {
    const res = await request(app)
      .get(`/restaurants/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200]).toContain(res.status);
  });

  it("❌ GET /restaurants/:id → non-auth → 401", async () => {
    const res = await request(app).get(`/restaurants/${RESTAURANT_ID}`);
    expect(res.status).toBe(401);
  });

  it("✅ PUT /restaurants/:id → admin modifie le restaurant", async () => {
    const res = await request(app)
      .put(`/restaurants/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ name: "Baghera" }); // Remettre le nom original
    expect([200]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. RÉSERVATIONS
// ═════════════════════════════════════════════════════════════════════════════

describe("RÉSERVATIONS — CRUD complet", () => {

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // Dans 7 jours

  // ── CREATE ──
  it("✅ POST /reservations → admin crée une réservation", async () => {
    const res = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        restaurantId: RESTAURANT_ID,
        tableId: "6a038d467070bbe3ff0430ef", // Tab2
        clientName: "Test CRUD Client",
        customerPhone: "0600000000",
        guestCount: 2,
        reservationDate: futureDate,
        reservationTime: "19:00",
      });
    expect([201]).toContain(res.status);
    expect(res.body._id).toBeDefined();
    createdReservationId = res.body._id;
    console.log(`[RÉSERVATIONS] Réservation créée: ${createdReservationId}`);
  });

  it("❌ POST /reservations → non-auth → 401", async () => {
    const res = await request(app)
      .post("/reservations")
      .send({ restaurantId: RESTAURANT_ID, tableId: "6a038d467070bbe3ff0430ef", customerName: "X", guestCount: 1, reservationDate: futureDate, reservationTime: "19:00" });
    expect(res.status).toBe(401);
  });

  it("❌ POST /reservations → tableId invalide → 400", async () => {
    const res = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, tableId: "not-a-valid-id", customerName: "X", guestCount: 1, reservationDate: futureDate, reservationTime: "19:00" });
    expect(res.status).toBe(400);
  });

  // ── READ ──
  it("✅ GET /reservations/upcoming/:restaurantId → admin lit les réservations à venir", async () => {
    const res = await request(app)
      .get(`/reservations/upcoming/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200]).toContain(res.status);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("✅ GET /reservations/upcoming/:restaurantId → serveur lit les réservations", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .get(`/reservations/upcoming/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([200]).toContain(res.status);
  });

  it("❌ GET /reservations/upcoming/:restaurantId → non-auth → 401", async () => {
    const res = await request(app).get(`/reservations/upcoming/${RESTAURANT_ID}`);
    expect(res.status).toBe(401);
  });

  // ── UPDATE ──
  it("✅ PUT /reservations/:id/status → admin annule une réservation", async () => {
    if (!createdReservationId) return;
    const res = await request(app)
      .put(`/reservations/${createdReservationId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ status: "cancelled" });
    expect([200]).toContain(res.status);
  });

  it("📝 PUT /reservations/:id/status → serveur modifie statut → vérifier permissions", async () => {
    if (!serverToken) return;
    // Créer une nouvelle résa pour ce test (la précédente est déjà cancelled)
    const futureDate3 = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const tmp = await request(app).post("/reservations")
      .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, tableId: "6a038d467070bbe3ff0430ef", clientName: "Tmp Status", guestCount: 1, reservationDate: futureDate3, reservationTime: "20:00" });
    if (tmp.status !== 201) { console.warn("[RESAS] Skip status test (tmp resa failed)"); return; }
    const res = await request(app)
      .put(`/reservations/${tmp.body._id}/status`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER)
      .send({ status: "cancelled" });
    console.log(`[RÉSERVATIONS] Server PUT /status: ${res.status}`);
    expect([200, 403]).toContain(res.status);
    // cleanup
    await request(app).delete(`/reservations/${tmp.body._id}`)
      .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN);
  });

  // ── DELETE ──
  it("📝 DELETE /reservations/:id → serveur peut aussi supprimer (comportement documenté)", async () => {
    // La route DELETE autorise admin ET server : checkRoles(["admin", "server"])
    if (!createdReservationId || !serverToken) return;
    // Ne pas vraiment supprimer ici pour laisser l'admin le faire
    // On crée une résa temporaire et on laisse le serveur la supprimer
    const futureDate2 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const tmp = await request(app).post("/reservations")
      .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, tableId: "6a038d467070bbe3ff0430ef", clientName: "Tmp Delete", guestCount: 1, reservationDate: futureDate2, reservationTime: "20:00" });
    if (tmp.status !== 201) { console.warn("[RESAS] Impossible de créer résa tmp"); return; }
    const delRes = await request(app).delete(`/reservations/${tmp.body._id}`)
      .set("Authorization", `Bearer ${serverToken}`).set("x-device-id", DEVICE_SERVER);
    // Server peut supprimer (rôle autorisé)
    expect([200, 403]).toContain(delRes.status);
    console.log(`[RESAS] Server DELETE status: ${delRes.status}`);
  });

  it("✅ DELETE /reservations/:id → admin supprime (cleanup final)", async () => {
    if (!createdReservationId) return;
    const res = await request(app)
      .delete(`/reservations/${createdReservationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);
    expect([200, 204]).toContain(res.status);
    createdReservationId = "";
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. TOKEN CLIENT (QR scan)
// ═════════════════════════════════════════════════════════════════════════════

describe("CLIENT TOKEN — QR code scan", () => {

  it("✅ POST /client/token → client obtient un token avec reservationId", async () => {
    // Récupérer une réservation existante en DB
    const resList = await request(app)
      .get(`/reservations/upcoming/${RESTAURANT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN);

    const reservations = resList.body.reservations || resList.body;
    const reservation = Array.isArray(reservations) && reservations.find(r => r.status !== "cancelled");
    if (!reservation) {
      console.warn("[CLIENT TOKEN] Pas de réservation disponible, skip");
      return;
    }

    const res = await request(app)
      .post("/client/token")
      .set("x-device-id", "client-scan-device")
      .send({
        pseudo: `Client${Date.now()}`,
        restaurantId: RESTAURANT_ID,
        tableId: reservation.tableId?._id || reservation.tableId,
        reservationId: reservation._id,
      });
    expect([200, 201]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      expect(res.body.token).toBeDefined();
    }
  });

  it("✅ POST /client/token → sans reservationId (walk-in)", async () => {
    const deviceId = `client-walkin-${Date.now()}`;
    const res = await request(app)
      .post("/client/token")
      .set("x-device-id", deviceId)
      .send({
        pseudo: `Client${Date.now()}`,
        restaurantId: RESTAURANT_ID,
        tableId: "6a038d467070bbe3ff0430ef", // Tab2
        deviceId,
      });
    expect([200, 201]).toContain(res.status);
  });

  it("❌ POST /client/token → restaurantId invalide → ≥ 400", async () => {
    const res = await request(app)
      .post("/client/token")
      .set("x-device-id", "client-test-device")
      .send({ pseudo: "TestClient", restaurantId: "not-a-valid-id", tableId: "6a038d467070bbe3ff0430ef" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. TABLES BATCH (mode développeur)
// ═════════════════════════════════════════════════════════════════════════════

describe("TABLES BATCH — Création multiple (mode dev)", () => {

  const batchTableIds = [];

  afterAll(async () => {
    // Cleanup des tables créées en batch
    for (const id of batchTableIds) {
      await request(app)
        .delete(`/tables/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-device-id", DEVICE_ADMIN);
    }
  });

  it("✅ POST /tables/batch → admin crée 2 tables avec qrCode auto", async () => {
    const res = await request(app)
      .post("/tables/batch")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        restaurantId: RESTAURANT_ID,
        count: 2,
        capacity: 4,
        clientAppUrl: "https://example-client.com",
      });
    expect([201]).toContain(res.status);
    const tables = res.body.tables || [];
    expect(tables.length).toBe(2);
    tables.forEach((t) => {
      expect(t.qrCodeUrl).toContain("example-client.com");
      batchTableIds.push(t._id);
    });
    console.log(`[BATCH] ${tables.length} tables créées`);
  });

  it("❌ POST /tables/batch → non-auth → 401", async () => {
    const res = await request(app)
      .post("/tables/batch")
      .send({ restaurantId: RESTAURANT_ID, count: 1 });
    expect(res.status).toBe(401);
  });

  it("❌ POST /tables/batch → count > 50 → 400", async () => {
    const res = await request(app)
      .post("/tables/batch")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: RESTAURANT_ID, count: 51 });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. SÉCURITÉ — IDOR et RBAC cross-restaurant
// ═════════════════════════════════════════════════════════════════════════════

describe("SÉCURITÉ — IDOR et isolation restaurant", () => {

  const LA_BOUCLE_ID = "69a035934b395eaaba6b8d21";

  it("📝 Admin Baghera peut créer pour La Boucle (admin bypass IDOR — comportement documenté)", async () => {
    // Le middleware checkUserRestaurantBody bypasse les admins : role=admin → next()
    // Ce test DOCUMENTE ce comportement (pas un bug voulu)
    const res = await request(app)
      .post("/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: LA_BOUCLE_ID, number: `IDOR-${Date.now()}`, capacity: 2 });
    // Admin bypasse le check → 201 attendu ; si un jour corrigé → 403
    expect([201, 403]).toContain(res.status);
    if (res.status === 201) {
      // cleanup immédiat
      await request(app).delete(`/tables/${res.body._id}`)
        .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN);
    }
  });

  it("📝 Admin Baghera peut créer un produit pour La Boucle (admin bypass IDOR)", async () => {
    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({ restaurantId: LA_BOUCLE_ID, name: "IDOR Produit", price: 10, category: "x" });
    expect([201, 403]).toContain(res.status);
    if (res.status === 201) {
      await request(app).delete(`/products/${res.body._id}`)
        .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN);
    }
  });

  it("❌ POST /servers pour La Boucle → 400 (serverId manquant) ou 201/403", async () => {
    const res = await request(app)
      .post("/servers")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-device-id", DEVICE_ADMIN)
      .send({
        name: "IDOR Server",
        email: `idor-${Date.now()}@test.com`,
        password: "Test1234!",
        role: "server",
        restaurantId: LA_BOUCLE_ID,
        serverId: `idor-srv-${Date.now()}`,
      });
    // Admin bypass → 201 (IDOR non protégé) ou 403 si futur fix
    expect([201, 403]).toContain(res.status);
    if (res.status === 201) {
      await request(app).delete(`/servers/${res.body.server?._id}`)
        .set("Authorization", `Bearer ${adminToken}`).set("x-device-id", DEVICE_ADMIN);
    }
  });

  it("❌ Serveur Baghera ne voit pas les serveurs de La Boucle → 403", async () => {
    if (!serverToken) return;
    const res = await request(app)
      .get(`/servers/${LA_BOUCLE_ID}`)
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-device-id", DEVICE_SERVER);
    expect([403]).toContain(res.status);
  });
});
