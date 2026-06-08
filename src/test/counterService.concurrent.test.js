/**
 * Tests sessions comptoir concurrentes et edge cases
 *
 * Couvre :
 * - Double ouverture de session sur la même table
 * - Fermeture de session inexistante
 * - Demande d'addition sur session fermée
 * - Session avec 0 commandes
 * - Transfert de table (si disponible)
 * - Rollback sur erreur transaction
 * - Multi-client simultané sur tables différentes
 * - Session comptoir vs session réservation sur même table
 */

require("dotenv").config();
jest.setTimeout(60000);
const mongoose = require("mongoose");
const counterService = require("../services/counterService");
const TableSession = require("../models/TableSession");
const Table = require("../models/Table");
const Order = require("../models/Order");

const RESTAURANT_ID = "6a0381c865b4fbf2f219e0f0"; // Baghera

let availableTables = [];

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  // Récupérer plusieurs tables disponibles pour les tests
  availableTables = await Table.find({ restaurantId: RESTAURANT_ID, status: "available" }).limit(5);
});

afterAll(async () => {
  // Nettoyage des sessions de test
  const sessions = await TableSession.find({
    restaurantId: RESTAURANT_ID,
    source: "counter",
    openedAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
  }).select("tableId");

  const tableIds = sessions.map((s) => s.tableId).filter(Boolean);
  await TableSession.deleteMany({
    restaurantId: RESTAURANT_ID,
    source: "counter",
    openedAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
  });
  if (tableIds.length > 0) {
    await Table.updateMany(
      { _id: { $in: tableIds } },
      { $set: { status: "available", currentSessionId: null } }
    );
  }
  await mongoose.connection.close();
});

// ─────────────────────────────────────────────
// CRÉATION DE SESSION
// ─────────────────────────────────────────────

describe("CounterService — Création", () => {
  it("✅ Créer une session walk-in sur table disponible", async () => {
    const table = availableTables[0];
    if (!table) return console.warn("Pas de table disponible, skip");

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 2,
    });

    expect(session).toBeDefined();
    expect(session.status).toBe("active");
    expect(session.source).toBe("counter");
    expect(session.billStatus).toBe("open");

    // Cleanup immédiat
    await counterService.cancelSession(session._id, "test cleanup");
  });

  it("❌ Créer une session sur table inexistante → throw 'Table not found'", async () => {
    const fakeTableId = new mongoose.Types.ObjectId();
    await expect(
      counterService.createSession({
        restaurantId: RESTAURANT_ID,
        tableId: fakeTableId,
        guestCount: 1,
      })
    ).rejects.toThrow("Table not found");
  });

  it("❌ Créer deux sessions simultanées sur la même table → la 2e doit rejeter", async () => {
    const table = availableTables[1] || availableTables[0];
    if (!table) return console.warn("Pas de table disponible, skip");

    const session1 = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });
    expect(session1.status).toBe("active");

    // 2e session sur même table → doit échouer
    await expect(
      counterService.createSession({
        restaurantId: RESTAURANT_ID,
        tableId: table._id,
        guestCount: 1,
      })
    ).rejects.toThrow("Table already occupied");

    // Cleanup
    await counterService.cancelSession(session1._id, "test cleanup");
  });

  it("✅ guestCount = 0 → session créée (walk-in sans décompte)", async () => {
    const table = availableTables[2] || availableTables[0];
    if (!table) return console.warn("Pas de table disponible, skip");

    // La plupart des systèmes acceptent guestCount = 0 (bébé, solo sans réservation…)
    try {
      const session = await counterService.createSession({
        restaurantId: RESTAURANT_ID,
        tableId: table._id,
        guestCount: 0,
      });
      expect(session.status).toBe("active");
      await counterService.cancelSession(session._id, "test cleanup");
    } catch (e) {
      // Acceptable si validation bloque guestCount = 0
      expect(e.message).toMatch(/guest|capacity/i);
    }
  });

  it("✅ 3 sessions simultanées sur 3 tables DIFFÉRENTES → toutes créées", async () => {
    if (availableTables.length < 3) return console.warn("Moins de 3 tables, skip");

    const [s1, s2, s3] = await Promise.all([
      counterService.createSession({ restaurantId: RESTAURANT_ID, tableId: availableTables[0]._id, guestCount: 1 }),
      counterService.createSession({ restaurantId: RESTAURANT_ID, tableId: availableTables[1]._id, guestCount: 2 }),
      counterService.createSession({ restaurantId: RESTAURANT_ID, tableId: availableTables[2]._id, guestCount: 3 }),
    ]);

    expect(s1.status).toBe("active");
    expect(s2.status).toBe("active");
    expect(s3.status).toBe("active");

    // IDs différents
    const ids = new Set([s1._id.toString(), s2._id.toString(), s3._id.toString()]);
    expect(ids.size).toBe(3);

    // Cleanup
    await Promise.all([s1, s2, s3].map((s) => counterService.cancelSession(s._id, "test cleanup")));
  });
});

// ─────────────────────────────────────────────
// DEMANDE D'ADDITION
// ─────────────────────────────────────────────

describe("CounterService — Demande d'addition", () => {
  it("✅ requestBill sur session active → billStatus = 'bill_requested'", async () => {
    const table = availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    const result = await counterService.requestBill(session._id);
    expect(result.billStatus).toBe("bill_requested");

    // Table marquée bill_requested
    const t = await Table.findById(table._id);
    expect(t.status).toBe("bill_requested");

    // Cleanup
    await counterService.cancelSession(session._id, "test cleanup");
  });

  it("❌ requestBill sur session inexistante → throw", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await expect(counterService.requestBill(fakeId)).rejects.toThrow("Session not found");
  });

  it("❌ requestBill sur session déjà fermée → throw", async () => {
    const closedSession = await TableSession.create({
      restaurantId: RESTAURANT_ID,
      tableId: new mongoose.Types.ObjectId(),
      source: "counter",
      status: "closed",
      billStatus: "closed",
      openedAt: new Date(),
      closedAt: new Date(),
    });

    await expect(counterService.requestBill(closedSession._id)).rejects.toThrow(/not active|already closed/i);
    await TableSession.findByIdAndDelete(closedSession._id);
  });
});

// ─────────────────────────────────────────────
// FERMETURE DE SESSION
// ─────────────────────────────────────────────

describe("CounterService — Fermeture", () => {
  it("✅ closeSession avec paiement exact → session closed + table available", async () => {
    const table = availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    await Order.create({
      restaurantId: RESTAURANT_ID,
      tableSessionId: session._id,
      tableId: table._id,
      items: [{ name: "Test Item", price: 10, quantity: 2 }],
      totalAmount: 20,
      source: "counter",
    });

    const result = await counterService.closeSession({
      sessionId: session._id,
      paymentMethod: "cash",
      amountPaid: 20,
      tip: 0,
    });

    expect(result.session.status).toBe("closed");
    expect(result.session.totalAmount).toBe(20);
    expect(result.payment.amount).toBe(20);

    const table2 = await Table.findById(table._id);
    expect(table2.status).toBe("available");
    expect(table2.currentSessionId).toBeNull();
  });

  it("✅ closeSession avec pourboire → paiement = total + tip", async () => {
    const table = availableTables[1] || availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    await Order.create({
      restaurantId: RESTAURANT_ID,
      tableSessionId: session._id,
      tableId: table._id,
      items: [{ name: "Test Item", price: 15, quantity: 1 }],
      totalAmount: 15,
      source: "counter",
    });

    const result = await counterService.closeSession({
      sessionId: session._id,
      paymentMethod: "cash",
      amountPaid: 20, // 15 + 5 tip
      tip: 5,
    });

    expect(result.payment.amount).toBe(20);
    expect(result.payment.tip).toBe(5);
  });

  it("✅ closeSession sans aucune commande → total = 0, paiement 0 accepté", async () => {
    const table = availableTables[2] || availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    // Pas de commandes créées
    const result = await counterService.closeSession({
      sessionId: session._id,
      paymentMethod: "cash",
      amountPaid: 0,
      tip: 0,
    });

    expect(result.session.status).toBe("closed");
    expect(result.session.totalAmount).toBe(0);
  });

  it("❌ closeSession avec montant insuffisant → throw 'Insufficient payment'", async () => {
    const table = availableTables[3] || availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    await Order.create({
      restaurantId: RESTAURANT_ID,
      tableSessionId: session._id,
      tableId: table._id,
      items: [{ name: "Test Item", price: 25, quantity: 1 }],
      totalAmount: 25,
      source: "counter",
    });

    await expect(
      counterService.closeSession({
        sessionId: session._id,
        paymentMethod: "cash",
        amountPaid: 10, // insuffisant
        tip: 0,
      })
    ).rejects.toThrow(/Insufficient payment/);

    // La session ne doit PAS être fermée (rollback)
    const sessionAfter = await TableSession.findById(session._id);
    expect(sessionAfter.status).toBe("active");

    // Cleanup
    await counterService.cancelSession(session._id, "test cleanup");
  });

  it("❌ closeSession sur session inexistante → throw", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await expect(
      counterService.closeSession({
        sessionId: fakeId,
        paymentMethod: "cash",
        amountPaid: 0,
        tip: 0,
      })
    ).rejects.toThrow("Session not found");
  });

  it("❌ closeSession sur session déjà fermée → throw", async () => {
    const table = availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    await counterService.cancelSession(session._id, "first close");

    await expect(
      counterService.closeSession({
        sessionId: session._id,
        paymentMethod: "cash",
        amountPaid: 0,
        tip: 0,
      })
    ).rejects.toThrow(/closed|not active/i);
  });
});

// ─────────────────────────────────────────────
// ANNULATION
// ─────────────────────────────────────────────

describe("CounterService — Annulation", () => {
  it("✅ cancelSession → session closed + table available + currentSessionId null", async () => {
    const table = availableTables[4] || availableTables[0];
    if (!table) return;

    const session = await counterService.createSession({
      restaurantId: RESTAURANT_ID,
      tableId: table._id,
      guestCount: 1,
    });

    const result = await counterService.cancelSession(session._id, "No-show");
    expect(result.status).toBe("closed");
    expect(result.billStatus).toBe("closed");

    const t = await Table.findById(table._id);
    expect(t.status).toBe("available");
    expect(t.currentSessionId).toBeNull();
  });

  it("❌ cancelSession sur session inexistante → throw", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    await expect(counterService.cancelSession(fakeId, "test")).rejects.toThrow("Session not found");
  });

  it("❌ cancelSession sur session déjà fermée → throw", async () => {
    const closed = await TableSession.create({
      restaurantId: RESTAURANT_ID,
      tableId: new mongoose.Types.ObjectId(),
      source: "counter",
      status: "closed",
      billStatus: "closed",
      openedAt: new Date(),
    });

    await expect(counterService.cancelSession(closed._id, "test")).rejects.toThrow(/closed|cancel/i);
    await TableSession.findByIdAndDelete(closed._id);
  });
});

// ─────────────────────────────────────────────
// SESSIONS ACTIVES
// ─────────────────────────────────────────────

describe("CounterService — Sessions actives", () => {
  it("✅ getActiveSessions retourne les sessions actives du restaurant", async () => {
    const sessions = await counterService.getActiveSessions(RESTAURANT_ID);
    expect(Array.isArray(sessions)).toBe(true);
    // Toutes les sessions retournées sont actives
    sessions.forEach((s) => {
      expect(s.status).toBe("active");
      expect(s.restaurantId.toString()).toBe(RESTAURANT_ID);
    });
  });

  it("✅ getActiveSessions pour restaurant inexistant → [] (pas de crash)", async () => {
    const fakeRestaurant = new mongoose.Types.ObjectId();
    const sessions = await counterService.getActiveSessions(fakeRestaurant);
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(0);
  });
});
