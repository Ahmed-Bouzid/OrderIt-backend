const mongoose = require("mongoose");
const TableSession = require("../models/TableSession");
const Reservation = require("../models/Reservation");
const Table = require("../models/Table");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const { RESERVATION_STATUS, ACTIVE_STATUSES } = require("../constants/reservationStatus");

/**
 * COUNTER SERVICE — Gestion des sessions comptoir
 * 
 * Mode Comptoir = Service rapide sans réservation préalable obligatoire
 * - Walk-in (sans réservation)
 * - Avec réservation existante
 * 
 * Workflow: Session → Commande → Addition → Encaissement
 */

/**
 * Créer une session comptoir
 * 
 * @param {Object} params
 * @param {String} params.restaurantId - ID du restaurant
 * @param {String} params.tableId - ID de la table comptoir
 * @param {String} [params.reservationId] - ID réservation (optionnel pour walk-in)
 * @param {Number} [params.guestCount] - Nombre de couverts (si pas de résa)
 * @param {String} [params.serverId] - ID du serveur qui crée la session
 * @returns {Promise<Object>} TableSession créée
 */
async function createSession({ 
  restaurantId, 
  tableId, 
  reservationId = null, 
  guestCount = 1,
  serverId = null 
}) {
  const session = await mongoose.connection.startSession();
  session.startTransaction();

  try {
    // 1. Vérifier que la table existe et est disponible
    const table = await Table.findById(tableId).session(session);
    
    if (!table) {
      throw new Error("Table not found");
    }
    
    if (table.status === "occupied") {
      // ✅ Vérifier s'il y a vraiment une session active pour cette table
      // ⚠️ FIX CRITIQUE : Filtrer par restaurantId ET source pour éviter conflits inter-restaurants
      const existingSession = await TableSession.findOne({
        tableId,
        restaurantId,
        source: "counter",
        billStatus: { $ne: "closed" },
      }).session(session);
      
      if (!existingSession) {
        // ⚠️ Incohérence BDD : table marquée occupée mais pas de session active pour CE restaurant en mode counter
        // → Auto-correction : libérer la table
        console.warn(`[counterService] Incohérence détectée: table ${tableId} occupée sans session counter active pour restaurant ${restaurantId} → libération automatique`);
        table.status = "available";
        table.currentSessionId = null;
        await table.save({ session });
      } else {
        // ✅ Session active trouvée pour CE restaurant en mode counter → vraie erreur 409
        console.log(`[counterService] Table ${tableId} déjà occupée par session ${existingSession._id} (restaurant=${restaurantId} source=counter)`);
        throw new Error("Table already occupied");
      }
    }

    // 2. ⚠️ VÉRIFICATION CRITIQUE : Bloquer si réservation présente existe pour cette table
    // Scénario à éviter : client réservé arrive → marqué présent → serveur ouvre en mode comptoir
    // → Réservation jamais ouverte, commandes pas liées, stats faussées
    if (!reservationId) {
      const pendingReservation = await Reservation.findOne({
        tableId,
        status: RESERVATION_STATUS.PENDING,
        isPresent: true,
      }).session(session);
      
      if (pendingReservation) {
        throw new Error(
          `TABLE_HAS_PENDING_RESERVATION:${pendingReservation._id}:${pendingReservation.clientName}`
        );
      }
    }

    // 3. Si réservation fournie → vérifier et mettre à jour
    let reservation = null;
    let finalGuestCount = guestCount;

    if (reservationId) {
      reservation = await Reservation.findById(reservationId).session(session);
      
      if (!reservation) {
        throw new Error("Reservation not found");
      }
      
      // Vérifier que la réservation n'est pas déjà active
      if (reservation.status === "confirmed" || reservation.status === "completed") {
        throw new Error("Reservation already opened or completed");
      }
      
      // Vérifier que la réservation n'est pas annulée
      if (reservation.status === "cancelled" || reservation.status === "no_show") {
        throw new Error("Cannot open a cancelled or no-show reservation");
      }
      
      // Mettre à jour la réservation
      reservation.status = "confirmed";
      reservation.isPresent = true;
      reservation.arrivedAt = new Date();
      reservation.tableId = tableId;
      
      finalGuestCount = reservation.nbPersonnes || guestCount;
      
      await reservation.save({ session, validateModifiedOnly: true });
    }

    // 4. Créer la TableSession
    const [tableSession] = await TableSession.create(
      [{
        restaurantId,
        tableId,
        reservationId: reservationId || null,
        serverId: serverId || null,
        status: "active",
        billStatus: "open",
        source: "counter",
        totalAmount: 0,
        openedAt: new Date(),
      }],
      { session }
    );

    // 4. Mettre à jour la table
    table.status = "occupied";
    table.currentSessionId = tableSession._id;
    await table.save({ session });

    // 5. Si réservation → lier la session
    if (reservation) {
      reservation.tableSessionId = tableSession._id;
      await reservation.save({ session, validateModifiedOnly: true });
    }

    await session.commitTransaction();

    // 6. Populate et retourner (utiliser l'objet créé au lieu de refaire un findById)
    // ✅ Plus rapide : populate directement sur l'objet existant
    await tableSession.populate("tableId");
    if (reservationId) {
      await tableSession.populate("reservationId");
    }
    
    return tableSession;
      
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Demander l'addition pour une session comptoir
 * 
 * @param {String} sessionId - ID de la session
 * @returns {Promise<Object>} TableSession mise à jour
 */
async function requestBill(sessionId) {
  const tableSession = await TableSession.findById(sessionId);
  
  if (!tableSession) {
    throw new Error("Session not found");
  }
  
  if (tableSession.status !== "active") {
    throw new Error("Session is not active");
  }
  
  if (tableSession.billStatus === "closed") {
    throw new Error("Bill already closed");
  }
  
  // Mettre à jour le billStatus
  tableSession.billStatus = "bill_requested";
  await tableSession.save({ validateModifiedOnly: true });
  
  // ✅ Table reste "occupied" (pas de changement de status)
  // Seule la TableSession.billStatus change à "bill_requested"
  
  return await TableSession.findById(sessionId)
    .populate("tableId")
    .populate("reservationId");
}

/**
 * Fermer session + encaisser
 * 
 * @param {Object} params
 * @param {String} params.sessionId - ID de la session
 * @param {String} params.paymentMethod - "cash" | "card" | "other"
 * @param {Number} params.amountPaid - Montant payé
 * @param {Number} [params.tip] - Pourboire (optionnel)
 * @param {String} [params.serverId] - ID du serveur qui encaisse
 * @returns {Promise<Object>} { session, payment }
 */
async function closeSession({ 
  sessionId, 
  paymentMethod, 
  amountPaid, 
  tip = 0,
  serverId = null 
}) {
  const mongoSession = await mongoose.connection.startSession();
  mongoSession.startTransaction();

  try {
    // 1. Récupérer la session
    const tableSession = await TableSession.findById(sessionId)
      .populate("reservationId")
      .session(mongoSession);
    
    if (!tableSession) {
      throw new Error("Session not found");
    }
    
    if (tableSession.status === "closed") {
      throw new Error("Session already closed");
    }
    
    // 2. Calculer le total réel depuis les commandes
    const orders = await Order.find({ tableSessionId: sessionId }).session(mongoSession);
    const calculatedTotal = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    
    // Validation: le montant payé doit être >= total (avec tolérance de 0.01€)
    if (amountPaid < calculatedTotal - 0.01) {
      throw new Error(`Insufficient payment: ${amountPaid}€ paid but ${calculatedTotal}€ required`);
    }
    
    // 3. Créer le Payment
    const [payment] = await Payment.create(
      [{
        restaurantId: tableSession.restaurantId,
        tableSessionId: sessionId,
        reservationId: tableSession.reservationId?._id || null,
        amount: amountPaid,
        tip: tip || 0,
        method: paymentMethod,
        status: "completed",
        paidAt: new Date(),
      }],
      { session: mongoSession }
    );
    
    // 4. Fermer la TableSession
    tableSession.status = "closed";
    tableSession.billStatus = "closed";
    tableSession.closedAt = new Date();
    tableSession.totalAmount = calculatedTotal;
    tableSession.paymentMethod = paymentMethod;
    await tableSession.save({ session: mongoSession, validateModifiedOnly: true });
    
    // 5. Libérer la table
    const table = await Table.findById(tableSession.tableId).session(mongoSession);
    if (table) {
      table.status = "available";
      table.currentSessionId = null;
      await table.save({ session: mongoSession });
    }
    
    // 6. Terminer la réservation (si existe)
    if (tableSession.reservationId) {
      const reservation = tableSession.reservationId;
      reservation.status = RESERVATION_STATUS.COMPLETED;
      reservation.totalAmount = calculatedTotal;
      reservation.completedAt = new Date(); // ✅ Utiliser completedAt
      
      await reservation.save({ session: mongoSession, validateModifiedOnly: true });
    }
    
    // 7. Marquer toutes les commandes comme terminées
    await Order.updateMany(
      { tableSessionId: sessionId },
      { 
        $set: { 
          status: "completed",
          completedAt: new Date()
        }
      },
      { session: mongoSession }
    );
    
    await mongoSession.commitTransaction();
    
    return { 
      session: tableSession, 
      payment 
    };
    
  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
}

/**
 * Annuler une session comptoir (avant paiement)
 * 
 * @param {String} sessionId - ID de la session
 * @param {String} reason - Raison de l'annulation
 * @returns {Promise<Object>} TableSession annulée
 */
async function cancelSession(sessionId, reason = "Cancelled by staff") {
  const mongoSession = await mongoose.connection.startSession();
  mongoSession.startTransaction();

  try {
    // 1. Récupérer la session
    const tableSession = await TableSession.findById(sessionId)
      .populate("reservationId")
      .session(mongoSession);
    
    if (!tableSession) {
      throw new Error("Session not found");
    }
    
    if (tableSession.status === "closed") {
      throw new Error("Cannot cancel a closed session");
    }
    
    // 2. Fermer la session sans paiement
    tableSession.status = "closed";
    tableSession.billStatus = "closed";
    tableSession.closedAt = new Date();
    tableSession.totalAmount = 0;
    await tableSession.save({ session: mongoSession, validateModifiedOnly: true });
    
    // 3. Libérer la table
    const table = await Table.findById(tableSession.tableId).session(mongoSession);
    if (table) {
      table.status = "available";
      table.currentSessionId = null;
      await table.save({ session: mongoSession });
    }
    
    // 4. Annuler la réservation (si existe)
    if (tableSession.reservationId) {
      const reservation = tableSession.reservationId;
      reservation.status = RESERVATION_STATUS.CANCELLED;
      reservation.canceled = true;
      reservation.canceledAt = new Date();
      await reservation.save({ session: mongoSession, validateModifiedOnly: true });
    }
    
    // 5. Annuler toutes les commandes
    await Order.updateMany(
      { tableSessionId: sessionId },
      { 
        $set: { 
          status: "cancelled",
          cancelledAt: new Date()
        }
      },
      { session: mongoSession }
    );
    
    await mongoSession.commitTransaction();
    
    return tableSession;
    
  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
}

/**
 * Récupérer toutes les sessions actives pour un restaurant
 * 
 * @param {String} restaurantId - ID du restaurant
 * @returns {Promise<Array>} Liste des sessions actives
 */
async function getActiveSessions(restaurantId) {
  return await TableSession.find({
    restaurantId,
    status: "active",
    source: "counter"
  })
  .populate("tableId")
  .populate("reservationId")
  .sort({ openedAt: -1 });
}

/**
 * Récupérer une session par ID avec tous les détails
 * 
 * @param {String} sessionId - ID de la session
 * @returns {Promise<Object>} Session complète avec commandes
 */
async function getSessionWithOrders(sessionId) {
  const session = await TableSession.findById(sessionId)
    .populate("tableId")
    .populate("reservationId");
  
  if (!session) {
    throw new Error("Session not found");
  }
  
  // Charger les commandes
  const orders = await Order.find({ tableSessionId: sessionId })
    .sort({ createdAt: 1 });
  
  return {
    ...session.toObject(),
    orders
  };
}

module.exports = {
  createSession,
  requestBill,
  closeSession,
  cancelSession,
  getActiveSessions,
  getSessionWithOrders,
};
