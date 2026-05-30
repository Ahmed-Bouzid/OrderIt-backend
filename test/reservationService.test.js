/**
 * Tests unitaires pour reservationService
 * Teste la logique métier du mode Activity (réservations planifiées)
 * 
 * Couvre :
 * - Marquer client présent
 * - Ouvrir service (créer TableSession + calcul wait time)
 * - Fermer service avec paiement (calcul service time)
 * - Annuler réservation
 * - Marquer no-show
 * - Rollback sur erreur (intégrité transactions)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const reservationService = require("../services/reservationService");
const Reservation = require("../models/Reservation");
const TableSession = require("../models/TableSession");
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
  // Nettoyer les données de test créées récemment
  await TableSession.deleteMany({ createdAt: { $gte: new Date(Date.now() - 60000) } });
  await Payment.deleteMany({ createdAt: { $gte: new Date(Date.now() - 60000) } });
});

describe("reservationService.markPresent", () => {
  it("✅ Devrait marquer un client comme présent", async () => {
    // Trouver une réservation en attente
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      isPresent: false 
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente pour le test, skip");
      return;
    }
    
    const result = await reservationService.markPresent(pendingReservation._id);
    
    expect(result.isPresent).toBe(true);
    expect(result.arrivedAt).toBeDefined();
    expect(result.arrivedAt).toBeInstanceOf(Date);
    expect(result.arrivalTime).toBeDefined(); // Legacy compat
  });
  
  it("✅ Devrait être idempotent (déjà présent → pas d'erreur)", async () => {
    const presentReservation = await Reservation.findOne({ 
      status: "pending",
      isPresent: true 
    });
    
    if (!presentReservation) {
      console.warn("⚠️  Pas de réservation présente pour le test, skip");
      return;
    }
    
    const result = await reservationService.markPresent(presentReservation._id);
    
    expect(result.isPresent).toBe(true);
    expect(result._id).toEqual(presentReservation._id);
  });
  
  it("❌ Devrait échouer si la réservation n'existe pas", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    
    await expect(
      reservationService.markPresent(fakeId)
    ).rejects.toThrow("Reservation not found");
  });
  
  it("❌ Devrait échouer si la réservation n'est pas en attente", async () => {
    const confirmedReservation = await Reservation.findOne({ 
      status: "confirmed" 
    });
    
    if (!confirmedReservation) {
      console.warn("⚠️  Pas de réservation confirmée pour le test, skip");
      return;
    }
    
    await expect(
      reservationService.markPresent(confirmedReservation._id)
    ).rejects.toThrow("Only pending reservations can be marked as present");
  });
});

describe("reservationService.openService", () => {
  it("✅ Devrait ouvrir le service et créer une TableSession", async () => {
    // Trouver une réservation en attente avec table assignée
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      tableId: { $ne: null }
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente avec table pour le test, skip");
      return;
    }
    
    // Libérer la table pour le test
    await Table.updateOne(
      { _id: pendingReservation.tableId },
      { $set: { status: "available", currentSessionId: null } }
    );
    
    // Marquer présent d'abord
    await reservationService.markPresent(pendingReservation._id);
    
    const result = await reservationService.openService(pendingReservation._id);
    
    expect(result.reservation).toBeDefined();
    expect(result.session).toBeDefined();
    expect(result.waitTime).toBeDefined();
    
    expect(result.reservation.status).toBe("confirmed");
    expect(result.reservation.tableSessionId).toEqual(result.session._id);
    
    expect(result.session.status).toBe("active");
    expect(result.session.source).toBe("reservation");
    expect(result.session.reservationId).toEqual(pendingReservation._id);
    
    // Vérifier que la table est occupée
    const table = await Table.findById(pendingReservation.tableId);
    expect(table.status).toBe("occupied");
    expect(table.currentSessionId).toEqual(result.session._id);
  });
  
  it("✅ Devrait calculer le wait time correctement", async () => {
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      tableId: { $ne: null }
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente avec table pour le test, skip");
      return;
    }
    
    // Libérer la table
    await Table.updateOne(
      { _id: pendingReservation.tableId },
      { $set: { status: "available", currentSessionId: null } }
    );
    
    // Marquer présent avec un timestamp passé (simuler 5 min d'attente)
    await Reservation.updateOne(
      { _id: pendingReservation._id },
      { 
        $set: { 
          isPresent: true,
          arrivedAt: new Date(Date.now() - 5 * 60 * 1000) // 5 min ago
        }
      }
    );
    
    const result = await reservationService.openService(pendingReservation._id);
    
    expect(result.waitTime).toBeGreaterThanOrEqual(4); // Au moins 4 min
    expect(result.waitTime).toBeLessThanOrEqual(6); // Max 6 min (tolérance)
  });
  
  it("❌ Devrait échouer si pas de table assignée", async () => {
    const reservationWithoutTable = await Reservation.findOne({ 
      status: "pending",
      tableId: null
    });
    
    if (!reservationWithoutTable) {
      console.warn("⚠️  Pas de réservation sans table pour le test, skip");
      return;
    }
    
    await expect(
      reservationService.openService(reservationWithoutTable._id)
    ).rejects.toThrow("No table assigned to this reservation");
  });
  
  it("❌ Devrait échouer si table déjà occupée", async () => {
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      tableId: { $ne: null }
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente avec table pour le test, skip");
      return;
    }
    
    // Occuper la table
    await Table.updateOne(
      { _id: pendingReservation.tableId },
      { $set: { status: "occupied", currentSessionId: new mongoose.Types.ObjectId() } }
    );
    
    await expect(
      reservationService.openService(pendingReservation._id)
    ).rejects.toThrow("Table is already occupied");
  });
  
  it("❌ Devrait rollback si erreur pendant la transaction", async () => {
    // Simuler une erreur en modifiant temporairement la table
    const pendingReservation = await Reservation.findOne({ 
      status: "pending",
      tableId: { $ne: null }
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation pour le test, skip");
      return;
    }
    
    // Supprimer temporairement la table pour forcer une erreur
    const originalTable = await Table.findByIdAndDelete(pendingReservation.tableId);
    
    await expect(
      reservationService.openService(pendingReservation._id)
    ).rejects.toThrow("Table not found");
    
    // Vérifier qu'aucune session n'a été créée (rollback)
    const session = await TableSession.findOne({ reservationId: pendingReservation._id });
    expect(session).toBeNull();
    
    // Restaurer la table
    if (originalTable) {
      await Table.create(originalTable.toObject());
    }
  });
});

describe("reservationService.closeService", () => {
  it("✅ Devrait fermer le service et créer un paiement", async () => {
    // Trouver une réservation confirmée (en service)
    const confirmedReservation = await Reservation.findOne({ 
      status: "confirmed",
      tableSessionId: { $ne: null }
    });
    
    if (!confirmedReservation) {
      console.warn("⚠️  Pas de réservation en service pour le test, skip");
      return;
    }
    
    // Créer des commandes test
    const session = await TableSession.findById(confirmedReservation.tableSessionId);
    if (!session) {
      console.warn("⚠️  Session introuvable, skip");
      return;
    }
    
    await Order.create({
      restaurantId: confirmedReservation.restaurantId,
      tableSessionId: session._id,
      tableId: confirmedReservation.tableId,
      items: [{ name: "Test Item", price: 15, quantity: 2 }],
      totalAmount: 30,
    });
    
    const result = await reservationService.closeService(
      confirmedReservation._id,
      {
        paymentMethod: "card",
        amountPaid: 35,
        tip: 5,
      }
    );
    
    expect(result.reservation.status).toBe("completed");
    expect(result.reservation.totalAmount).toBe(30);
    expect(result.reservation.completedAt).toBeDefined();
    
    expect(result.session.status).toBe("closed");
    expect(result.session.billStatus).toBe("closed");
    
    expect(result.payment.amount).toBe(35);
    expect(result.payment.tip).toBe(5);
    
    expect(result.serviceTime).toBeGreaterThanOrEqual(0);
    
    // Vérifier que la table est libérée
    const table = await Table.findById(confirmedReservation.tableId);
    expect(table.status).toBe("available");
    expect(table.currentSessionId).toBeNull();
  });
  
  it("❌ Devrait échouer si montant insuffisant", async () => {
    const confirmedReservation = await Reservation.findOne({ 
      status: "confirmed",
      tableSessionId: { $ne: null }
    });
    
    if (!confirmedReservation) {
      console.warn("⚠️  Pas de réservation en service, skip");
      return;
    }
    
    const session = await TableSession.findById(confirmedReservation.tableSessionId);
    if (!session) {
      console.warn("⚠️  Session introuvable, skip");
      return;
    }
    
    await Order.create({
      restaurantId: confirmedReservation.restaurantId,
      tableSessionId: session._id,
      tableId: confirmedReservation.tableId,
      items: [{ name: "Test Item", price: 20, quantity: 2 }],
      totalAmount: 40,
    });
    
    await expect(
      reservationService.closeService(
        confirmedReservation._id,
        {
          paymentMethod: "cash",
          amountPaid: 30, // Insuffisant (< 40)
          tip: 0,
        }
      )
    ).rejects.toThrow(/Insufficient payment/);
    
    // Vérifier qu'aucun paiement n'a été créé (rollback)
    const payment = await Payment.findOne({ reservationId: confirmedReservation._id });
    expect(payment).toBeNull();
  });
});

describe("reservationService.cancelReservation", () => {
  it("✅ Devrait annuler une réservation en attente", async () => {
    const pendingReservation = await Reservation.findOne({ 
      status: "pending"
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente, skip");
      return;
    }
    
    const result = await reservationService.cancelReservation(
      pendingReservation._id,
      "Client cancelled"
    );
    
    expect(result.status).toBe("cancelled");
    expect(result.canceled).toBe(true);
    expect(result.canceledAt).toBeDefined();
    
    // Vérifier que la table est libérée si elle était assignée
    if (pendingReservation.tableId) {
      const table = await Table.findById(pendingReservation.tableId);
      expect(table.status).toBe("available");
    }
  });
  
  it("❌ Devrait échouer si la réservation est déjà terminée", async () => {
    const completedReservation = await Reservation.findOne({ 
      status: "completed" 
    });
    
    if (!completedReservation) {
      console.warn("⚠️  Pas de réservation terminée, skip");
      return;
    }
    
    await expect(
      reservationService.cancelReservation(completedReservation._id, "Test")
    ).rejects.toThrow("Cannot cancel a completed reservation");
  });
});

describe("reservationService.markNoShow", () => {
  it("✅ Devrait marquer une réservation comme no-show", async () => {
    const pendingReservation = await Reservation.findOne({ 
      status: "pending"
    });
    
    if (!pendingReservation) {
      console.warn("⚠️  Pas de réservation en attente, skip");
      return;
    }
    
    const result = await reservationService.markNoShow(pendingReservation._id);
    
    expect(result.status).toBe("no_show");
    expect(result.canceled).toBe(true);
    expect(result.canceledAt).toBeDefined();
    
    // Vérifier que la table est libérée
    if (pendingReservation.tableId) {
      const table = await Table.findById(pendingReservation.tableId);
      expect(table.status).toBe("available");
    }
  });
  
  it("❌ Devrait échouer si la réservation n'est pas en attente", async () => {
    const confirmedReservation = await Reservation.findOne({ 
      status: "confirmed" 
    });
    
    if (!confirmedReservation) {
      console.warn("⚠️  Pas de réservation confirmée, skip");
      return;
    }
    
    await expect(
      reservationService.markNoShow(confirmedReservation._id)
    ).rejects.toThrow("Only pending reservations can be marked as no-show");
  });
});
