/**
 * Tests unitaires pour counterService
 * Teste la logique métier du mode Comptoir (Counter)
 * 
 * Couvre :
 * - Création de session (avec/sans réservation)
 * - Demande d'addition
 * - Fermeture de session avec paiement
 * - Annulation de session
 * - Rollback sur erreur (intégrité transactions)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const counterService = require("../services/counterService");
const TableSession = require("../models/TableSession");
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Order = require("../models/Order");
const Payment = require("../models/Payment");

// Connexion DB avant tous les tests
beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI_TEST || process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
});

// Fermeture DB après tous les tests
afterAll(async () => {
  await mongoose.connection.close();
});

// Nettoyage après chaque test
afterEach(async () => {
  // Nettoyer les données de test créées
  const deletedSessions = await TableSession.find({ source: "counter", openedAt: { $gte: new Date(Date.now() - 60000) } }).select("tableId");
  const tableIds = deletedSessions.map(s => s.tableId).filter(Boolean);
  await TableSession.deleteMany({ source: "counter", openedAt: { $gte: new Date(Date.now() - 60000) } });
  // Remettre les tables à "available" pour éviter la pollution entre tests
  if (tableIds.length > 0) {
    await Table.updateMany(
      { _id: { $in: tableIds } },
      { $set: { status: "available", currentSessionId: null } }
    );
  }
  await Payment.deleteMany({ createdAt: { $gte: new Date(Date.now() - 60000) } });
});

describe("counterService.createSession", () => {
  it("✅ Devrait créer une session sans réservation (walk-in)", async () => {
    // Trouver une table disponible pour le test
    const availableTable = await Table.findOne({ status: "available" });
    
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible pour le test, skip");
      return;
    }
    
    const result = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 2,
    });
    
    expect(result).toBeDefined();
    expect(result.source).toBe("counter");
    expect(result.status).toBe("active");
    expect(result.billStatus).toBe("open");
    expect(result.reservationId).toBeNull();
    
    // Vérifier que la table est occupée
    const table = await Table.findById(availableTable._id);
    expect(table.status).toBe("occupied");
    expect(table.currentSessionId).toEqual(result._id);
  });
  
  it("✅ Devrait créer une session avec réservation existante", async () => {
    // Trouver une réservation en attente
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      tableId: { $ne: null }
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente pour le test, skip");
      return;
    }
    
    // Libérer la table si occupée (pour le test)
    await Table.updateOne(
      { _id: pendingReservation.tableId },
      { $set: { status: "available", currentSessionId: null } }
    );
    
    const result = await counterService.createSession({
      restaurantId: pendingReservation.restaurantId,
      tableId: pendingReservation.tableId,
      reservationId: pendingReservation._id,
    });
    
    expect(result).toBeDefined();
    expect(result.source).toBe("counter");
    expect(result.reservationId).toEqual(pendingReservation._id);
    
    // Vérifier que la réservation est confirmée
    const reservation = await Reservation.findById(pendingReservation._id);
    expect(reservation.status).toBe("confirmed");
    expect(reservation.isPresent).toBe(true);
    expect(reservation.arrivedAt).toBeDefined();
    expect(reservation.tableSessionId).toEqual(result._id);
  });
  
  it("❌ Devrait échouer si la table n'existe pas", async () => {
    const fakeTableId = new mongoose.Types.ObjectId();
    const fakeRestaurantId = new mongoose.Types.ObjectId();
    
    await expect(
      counterService.createSession({
        restaurantId: fakeRestaurantId,
        tableId: fakeTableId,
        guestCount: 1,
      })
    ).rejects.toThrow("Table not found");
  });
  
  it("❌ Devrait échouer si la table est déjà occupée", async () => {
    // Créer une table et l'occuper via createSession pour contrôler l'état
    const availableTable = await Table.findOne({ status: "available" });
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible pour le test, skip");
      return;
    }

    // Occuper la table avec une première session
    const session1 = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 1,
    });
    expect(session1.status).toBe("active");

    // Tenter d'ouvrir une deuxième session sur la même table → doit rejeter
    await expect(
      counterService.createSession({
        restaurantId: availableTable.restaurantId,
        tableId: availableTable._id,
        guestCount: 1,
      })
    ).rejects.toThrow("Table already occupied");

    // Cleanup : fermer la session pour que afterEach puisse reset la table
    await counterService.cancelSession(session1._id, "cleanup after test");
  });
  
  it("❌ Devrait rollback si erreur pendant la transaction", async () => {
    // Créer une table temporaire pour le test
    const testTable = await Table.create({
      restaurantId: new mongoose.Types.ObjectId(),
      name: "TEST-TABLE-ROLLBACK",
      number: `ROLLBACK-${Date.now()}`,
      capacity: 4,
      status: "available",
    });
    
    // Simuler une erreur en passant une réservation invalide
    const fakeReservationId = new mongoose.Types.ObjectId();
    
    await expect(
      counterService.createSession({
        restaurantId: testTable.restaurantId,
        tableId: testTable._id,
        reservationId: fakeReservationId,
        guestCount: 1,
      })
    ).rejects.toThrow("Reservation not found");
    
    // Vérifier que la table n'est PAS occupée (rollback)
    const table = await Table.findById(testTable._id);
    expect(table.status).toBe("available");
    expect(table.currentSessionId).toBeNull();
    
    // Cleanup
    await Table.deleteOne({ _id: testTable._id });
  });
});

describe("counterService.requestBill", () => {
  it("✅ Devrait marquer la session comme bill_requested", async () => {
    // Créer une session active
    const availableTable = await Table.findOne({ status: "available" });
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible, skip");
      return;
    }
    
    const session = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 1,
    });
    
    const result = await counterService.requestBill(session._id);
    
    expect(result.billStatus).toBe("bill_requested");
    
    // Vérifier que la table est marquée bill_requested
    const table = await Table.findById(availableTable._id);
    expect(table.status).toBe("bill_requested");
  });
  
  it("❌ Devrait échouer si la session n'existe pas", async () => {
    const fakeSessionId = new mongoose.Types.ObjectId();
    
    await expect(
      counterService.requestBill(fakeSessionId)
    ).rejects.toThrow("Session not found");
  });
  
  it("❌ Devrait échouer si la session est déjà fermée", async () => {
    // Créer une session fermée
    const closedSession = await TableSession.create({
      restaurantId: new mongoose.Types.ObjectId(),
      tableId: new mongoose.Types.ObjectId(),
      source: "counter",
      status: "closed",
      billStatus: "closed",
      openedAt: new Date(),
      closedAt: new Date(),
    });
    
    await expect(
      counterService.requestBill(closedSession._id)
    ).rejects.toThrow("Session is not active");
    
    // Cleanup
    await TableSession.deleteOne({ _id: closedSession._id });
  });
});

describe("counterService.closeSession", () => {
  it("✅ Devrait fermer la session et créer un paiement", async () => {
    // Créer une session avec commandes
    const availableTable = await Table.findOne({ status: "available" });
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible, skip");
      return;
    }
    
    const session = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 1,
    });
    
    // Créer des commandes test
    await Order.create({
      restaurantId: availableTable.restaurantId,
      tableSessionId: session._id,
      tableId: availableTable._id,
      items: [{ name: "Test Item", price: 10, quantity: 2 }],
      totalAmount: 20,
      source: "counter",
    });
    
    const result = await counterService.closeSession({
      sessionId: session._id,
      paymentMethod: "cash",
      amountPaid: 25, // 20 + 5 tip
      tip: 5,
    });
    
    expect(result.session.status).toBe("closed");
    expect(result.session.billStatus).toBe("closed");
    expect(result.session.totalAmount).toBe(20);
    expect(result.payment.amount).toBe(25);
    expect(result.payment.tip).toBe(5);
    
    // Vérifier que la table est libérée
    const table = await Table.findById(availableTable._id);
    expect(table.status).toBe("available");
    expect(table.currentSessionId).toBeNull();
  });
  
  it("❌ Devrait échouer si le montant payé est insuffisant", async () => {
    const availableTable = await Table.findOne({ status: "available" });
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible, skip");
      return;
    }
    
    const session = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 1,
    });
    
    await Order.create({
      restaurantId: availableTable.restaurantId,
      tableSessionId: session._id,
      tableId: availableTable._id,
      items: [{ name: "Test Item", price: 10, quantity: 2 }],
      totalAmount: 20,
      source: "counter",
    });
    
    await expect(
      counterService.closeSession({
        sessionId: session._id,
        paymentMethod: "cash",
        amountPaid: 15, // Insuffisant (< 20)
        tip: 0,
      })
    ).rejects.toThrow(/Insufficient payment/);
    
    // Vérifier que la session n'est PAS fermée (rollback)
    const sessionAfter = await TableSession.findById(session._id);
    expect(sessionAfter.status).toBe("active");
  });
});

describe("counterService.cancelSession", () => {
  it("✅ Devrait annuler la session et libérer la table", async () => {
    const availableTable = await Table.findOne({ status: "available" });
    if (!availableTable) {
      console.warn("⚠️  Pas de table disponible, skip");
      return;
    }
    
    const session = await counterService.createSession({
      restaurantId: availableTable.restaurantId,
      tableId: availableTable._id,
      guestCount: 1,
    });
    
    const result = await counterService.cancelSession(session._id, "Test cancellation");
    
    expect(result.status).toBe("closed");
    expect(result.billStatus).toBe("closed");
    expect(result.totalAmount).toBe(0);
    
    // Vérifier que la table est libérée
    const table = await Table.findById(availableTable._id);
    expect(table.status).toBe("available");
    expect(table.currentSessionId).toBeNull();
  });
});

describe("counterService.getActiveSessions", () => {
  it("✅ Devrait retourner toutes les sessions actives d'un restaurant", async () => {
    const restaurant = await Table.findOne().then(t => t?.restaurantId);
    if (!restaurant) {
      console.warn("⚠️  Pas de restaurant pour le test, skip");
      return;
    }
    
    const sessions = await counterService.getActiveSessions(restaurant);
    
    expect(Array.isArray(sessions)).toBe(true);
    sessions.forEach(session => {
      expect(session.source).toBe("counter");
      expect(session.status).toBe("active");
      expect(session.restaurantId).toEqual(restaurant);
    });
  });
});
