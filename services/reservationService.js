const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const TableSession = require("../models/TableSession");
const Table = require("../models/Table");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const { emitEvent } = require("../utils/socketEmitter");
const { RESERVATION_STATUS, ACTIVE_STATUSES } = require("../constants/reservationStatus");

/**
 * RESERVATION SERVICE — Gestion cycle de vie Activity Mode
 * 
 * Activity Mode = Gestion complète des réservations planifiées
 * Workflow: Réservation → Arrivée → Service → Encaissement
 * 
 * Tracking complet:
 * - Wait time (arrivedAt → service open)
 * - Service time (service open → close)
 * - Quality metrics
 */

/**
 * Marquer un client comme présent (arrivé au restaurant)
 * 
 * @param {String} reservationId - ID de la réservation
 * @param {Object} [io] - Instance Socket.io pour WebSocket (optionnel)
 * @returns {Promise<Object>} Reservation mise à jour
 */
async function markPresent(reservationId, io = null) {
  const reservation = await Reservation.findById(reservationId);
  
  if (!reservation) {
    throw new Error("Reservation not found");
  }
  
  // Vérifier que la réservation est en attente
  // Note: accepter les statuts FR et EN pour compatibilité
  const isPending = reservation.status === "pending" || reservation.status === RESERVATION_STATUS.PENDING;
  
  if (!isPending) {
    throw new Error("Only pending reservations can be marked as present");
  }
  
  // Vérifier que le client n'est pas déjà marqué présent
  if (reservation.isPresent) {
    // Déjà présent → retourner sans erreur (idempotent)
    return reservation;
  }
  
  // Marquer présent avec timestamp
  reservation.isPresent = true;
  reservation.arrivedAt = new Date();
  
  // Conserver aussi arrivalTime pour compatibilité legacy
  reservation.arrivalTime = reservation.arrivedAt;
  
  await reservation.save({ validateModifiedOnly: true });
  
  // Émettre événement WebSocket
  if (io && reservation.restaurantId) {
    emitEvent(
      io,
      "reservation",
      "updated",
      reservation.toObject(),
      reservation.restaurantId.toString()
    );
  }
  
  // Log analytics
  console.log(`[ACTIVITY] Client marked present:`, {
    reservationId: reservation._id,
    guestName: reservation.clientName,
    arrivedAt: reservation.arrivedAt,
    scheduledTime: reservation.reservationDate
  });
  
  return reservation;
}

/**
 * Ouvrir le service (créer TableSession et passer résa à "confirmed")
 * 
 * @param {String} reservationId - ID de la réservation
 * @param {Object} [io] - Instance Socket.io pour WebSocket (optionnel)
 * @returns {Promise<Object>} { reservation, session, waitTime }
 */
async function openService(reservationId, io = null) {
  const mongoSession = await mongoose.connection.startSession();
  mongoSession.startTransaction();

  try {
    // 1. Récupérer la réservation
    const reservation = await Reservation.findById(reservationId)
      .session(mongoSession);
    
    if (!reservation) {
      throw new Error("Reservation not found");
    }
    
    // Vérifier que la réservation est en attente (FR ou EN)
    const isPending = reservation.status === "pending" || reservation.status === RESERVATION_STATUS.PENDING;
    
    if (!isPending) {
      throw new Error("Reservation already opened or completed");
    }
    
    // Vérifier qu'une table est assignée
    if (!reservation.tableId) {
      throw new Error("No table assigned to this reservation");
    }
    
    // 2. Vérifier que la table est disponible
    const table = await Table.findById(reservation.tableId)
      .session(mongoSession);
    
    if (!table) {
      throw new Error("Table not found");
    }
    
    if (table.status === "occupied") {
      throw new Error("Table is already occupied");
    }
    
    // 3. Créer la TableSession
    const [session] = await TableSession.create(
      [{
        restaurantId: reservation.restaurantId,
        reservationId: reservation._id,
        tableId: reservation.tableId,
        status: "active",
        billStatus: "open",
        source: "reservation",
        openedAt: new Date(),
      }],
      { session: mongoSession }
    );
    
    // 4. Mettre à jour la Reservation
    // Si pas encore marqué présent → le marquer maintenant
    if (!reservation.isPresent) {
      reservation.isPresent = true;
      reservation.arrivedAt = new Date();
      reservation.arrivalTime = reservation.arrivedAt; // Legacy compat
    }
    
    reservation.status = "confirmed"; // EN
    reservation.tableSessionId = session._id;
    
    await reservation.save({ 
      session: mongoSession, 
      validateModifiedOnly: true 
    });
    
    // 5. Occuper la table
    table.status = "occupied";
    table.currentSessionId = session._id;
    await table.save({ session: mongoSession });
    
    // 6. Calculer le temps d'attente
    let waitTime = null;
    if (reservation.arrivedAt) {
      waitTime = session.openedAt - reservation.arrivedAt; // ms
    }
    
    await mongoSession.commitTransaction();
    
    // 7. Log analytics
    console.log(`[ACTIVITY] Service opened:`, {
      reservationId: reservation._id,
      sessionId: session._id,
      guestName: reservation.clientName,
      tableId: table._id,
      tableName: table.name,
      arrivedAt: reservation.arrivedAt,
      openedAt: session.openedAt,
      waitTimeMs: waitTime,
      waitTimeMin: waitTime ? Math.round(waitTime / 60000) : null
    });
    
    // Alerte si wait time > 10min
    if (waitTime && waitTime > 10 * 60 * 1000) {
      console.warn(`[ACTIVITY] ⚠️  LONG WAIT TIME: ${Math.round(waitTime / 60000)}min for ${reservation.clientName}`);
    }
    
    // 8. Émettre événements WebSocket
    if (io && reservation.restaurantId) {
      const restaurantId = reservation.restaurantId.toString();
      
      emitEvent(io, "reservation", "opened", reservation.toObject(), restaurantId);
      emitEvent(io, "table-session", "created", session.toObject(), restaurantId);
      emitEvent(io, "table", "occupied", table.toObject(), restaurantId);
    }
    
    return {
      reservation,
      session,
      waitTime: waitTime ? Math.round(waitTime / 60000) : null // minutes
    };
    
  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
}

/**
 * Fermer le service et encaisser
 * 
 * @param {String} reservationId - ID de la réservation
 * @param {Object} paymentData - Données de paiement
 * @param {String} paymentData.paymentMethod - "cash" | "card" | "other"
 * @param {Number} paymentData.amountPaid - Montant payé
 * @param {Number} [paymentData.tip] - Pourboire (optionnel)
 * @param {Object} [io] - Instance Socket.io pour WebSocket (optionnel)
 * @returns {Promise<Object>} { reservation, session, payment, serviceTime }
 */
async function closeService(reservationId, paymentData, io = null) {
  const { paymentMethod, amountPaid, tip = 0 } = paymentData;
  
  const mongoSession = await mongoose.connection.startSession();
  mongoSession.startTransaction();

  try {
    // 1. Récupérer la réservation
    const reservation = await Reservation.findById(reservationId)
      .session(mongoSession);
    
    if (!reservation) {
      throw new Error("Reservation not found");
    }
    
    // Vérifier que la réservation est confirmée (FR ou EN)
    const isConfirmed = reservation.status === "confirmed" || reservation.status === RESERVATION_STATUS.CONFIRMED;
    
    if (!isConfirmed) {
      throw new Error("Reservation is not in service");
    }
    
    // 2. Récupérer la TableSession
    const session = await TableSession.findById(reservation.tableSessionId)
      .session(mongoSession);
    
    if (!session) {
      throw new Error("Table session not found");
    }
    
    if (session.status === "closed") {
      throw new Error("Session already closed");
    }
    
    // 3. Calculer le total depuis les commandes
    const orders = await Order.find({ tableSessionId: session._id })
      .session(mongoSession);
    
    const calculatedTotal = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    
    // Validation: montant payé >= total (avec tolérance 0.01€)
    if (amountPaid < calculatedTotal - 0.01) {
      throw new Error(`Insufficient payment: ${amountPaid}€ paid but ${calculatedTotal}€ required`);
    }
    
    // 4. Créer le Payment
    const [payment] = await Payment.create(
      [{
        restaurantId: reservation.restaurantId,
        tableSessionId: session._id,
        reservationId: reservation._id,
        amount: amountPaid,
        tip: tip || 0,
        method: paymentMethod,
        status: "completed",
        paidAt: new Date(),
      }],
      { session: mongoSession }
    );
    
    // 5. Fermer la TableSession
    session.status = "closed";
    session.billStatus = "closed";
    session.closedAt = new Date();
    session.totalAmount = calculatedTotal;
    session.paymentMethod = paymentMethod;
    await session.save({ 
      session: mongoSession, 
      validateModifiedOnly: true 
    });
    
    // 6. Terminer la Reservation
    reservation.status = RESERVATION_STATUS.COMPLETED; // EN (ou "terminée" pour compat FR)
    reservation.totalAmount = calculatedTotal;
    reservation.completedAt = new Date(); // ✅ Utiliser completedAt
    await reservation.save({ 
      session: mongoSession, 
      validateModifiedOnly: true 
    });
    
    // 7. Libérer la table
    const table = await Table.findById(reservation.tableId)
      .session(mongoSession);
    
    if (table) {
      table.status = "available";
      table.currentSessionId = null;
      await table.save({ session: mongoSession });
    }
    
    // 8. Marquer toutes les commandes comme terminées
    await Order.updateMany(
      { tableSessionId: session._id },
      { 
        $set: { 
          status: "completed",
          completedAt: new Date()
        }
      },
      { session: mongoSession }
    );
    
    // 9. Calculer service time
    const serviceTime = session.closedAt - session.openedAt; // ms
    
    await mongoSession.commitTransaction();
    
    // 10. Log analytics
    console.log(`[ACTIVITY] Service closed:`, {
      reservationId: reservation._id,
      sessionId: session._id,
      guestName: reservation.clientName,
      guestCount: reservation.nbPersonnes,
      revenue: amountPaid,
      tip: tip || 0,
      totalRevenue: amountPaid + (tip || 0),
      serviceTimeMs: serviceTime,
      serviceTimeMin: Math.round(serviceTime / 60000),
      paymentMethod
    });
    
    // 11. Émettre événements WebSocket
    if (io && reservation.restaurantId) {
      const restaurantId = reservation.restaurantId.toString();
      
      emitEvent(io, "reservation", "completed", reservation.toObject(), restaurantId);
      emitEvent(io, "table-session", "closed", session.toObject(), restaurantId);
      emitEvent(io, "table", "available", table.toObject(), restaurantId);
    }
    
    return {
      reservation,
      session,
      payment,
      serviceTime: Math.round(serviceTime / 60000) // minutes
    };
    
  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
}

/**
 * Annuler une réservation
 * 
 * @param {String} reservationId - ID de la réservation
 * @param {String} reason - Raison de l'annulation
 * @param {Object} [io] - Instance Socket.io pour WebSocket (optionnel)
 * @returns {Promise<Object>} Reservation annulée
 */
async function cancelReservation(reservationId, reason = "Cancelled by client or staff", io = null) {
  const reservation = await Reservation.findById(reservationId);
  
  if (!reservation) {
    throw new Error("Reservation not found");
  }
  
  // Vérifier qu'elle n'est pas déjà terminée
  const isCompleted = reservation.status === "completed" || reservation.status === RESERVATION_STATUS.COMPLETED;
  
  if (isCompleted) {
    throw new Error("Cannot cancel a completed reservation");
  }
  
  // Annuler
  reservation.status = RESERVATION_STATUS.CANCELLED; // EN
  reservation.canceled = true;
  reservation.canceledAt = new Date();
  
  // Si une table était assignée → la libérer
  if (reservation.tableId) {
    const table = await Table.findById(reservation.tableId);
    if (table && table.currentSessionId?.equals(reservation.tableSessionId)) {
      table.status = "available";
      table.currentSessionId = null;
      await table.save();
    }
  }
  
  await reservation.save({ validateModifiedOnly: true });
  
  // Log
  console.log(`[ACTIVITY] Reservation cancelled:`, {
    reservationId: reservation._id,
    guestName: reservation.clientName,
    reason
  });
  
  // WebSocket
  if (io && reservation.restaurantId) {
    emitEvent(
      io,
      "reservation",
      "cancelled",
      reservation.toObject(),
      reservation.restaurantId.toString()
    );
  }
  
  return reservation;
}

/**
 * Marquer une réservation comme no-show (client pas venu)
 * 
 * @param {String} reservationId - ID de la réservation
 * @param {Object} [io] - Instance Socket.io pour WebSocket (optionnel)
 * @returns {Promise<Object>} Reservation marquée no-show
 */
async function markNoShow(reservationId, io = null) {
  const reservation = await Reservation.findById(reservationId);
  
  if (!reservation) {
    throw new Error("Reservation not found");
  }
  
  // Vérifier qu'elle était en attente
  const isPending = reservation.status === "pending" || reservation.status === RESERVATION_STATUS.PENDING;
  
  if (!isPending) {
    throw new Error("Only pending reservations can be marked as no-show");
  }
  
  // Marquer no-show
  reservation.status = RESERVATION_STATUS.NO_SHOW;
  reservation.canceled = true;
  reservation.canceledAt = new Date();
  
  // Libérer la table si assignée
  if (reservation.tableId) {
    const table = await Table.findById(reservation.tableId);
    if (table) {
      table.status = "available";
      table.currentSessionId = null;
      await table.save();
    }
  }
  
  await reservation.save({ validateModifiedOnly: true });
  
  // Log
  console.log(`[ACTIVITY] Reservation marked no-show:`, {
    reservationId: reservation._id,
    guestName: reservation.clientName,
    scheduledTime: reservation.reservationDate
  });
  
  // WebSocket
  if (io && reservation.restaurantId) {
    emitEvent(
      io,
      "reservation",
      "no_show",
      reservation.toObject(),
      reservation.restaurantId.toString()
    );
  }
  
  return reservation;
}

module.exports = {
  markPresent,
  openService,
  closeService,
  cancelReservation,
  markNoShow,
};
