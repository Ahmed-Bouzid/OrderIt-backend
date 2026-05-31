/**
 * reservationAutoCancellation.js
 * 
 * Service pour annuler automatiquement les réservations en retard.
 * 
 * RÈGLE MÉTIER :
 * - Une réservation avec status="pending" dont l'heure de réservation est dépassée de plus de 10 minutes
 *   doit automatiquement passer en status="cancelled"
 * - Le système émet un événement WebSocket pour chaque réservation annulée
 * - Le cron job s'exécute toutes les minutes
 * 
 * Usage :
 *   const { cancelOverdueReservations } = require('./services/reservationAutoCancellation');
 *   
 *   // Dans start.js après connexion MongoDB :
 *   cron.schedule('* * * * *', () => {
 *     cancelOverdueReservations(io);
 *   });
 */

const Reservation = require("../models/Reservation");
const { emitReservationEvent } = require("../utils/socketEmitter");

/**
 * Annule automatiquement les réservations "pending" en retard de plus de 10 minutes
 * 
 * @param {Object} io - Instance Socket.io pour émettre des événements WebSocket
 * @returns {Promise<Object>} { cancelledCount, reservations }
 */
async function cancelOverdueReservations(io = null) {
  const startTime = Date.now();
  
  try {
    // ⭐ Date/heure actuelle moins 10 minutes (seuil de tolérance)
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    
    // ⭐ Trouver toutes les réservations "pending" avec une date/heure de réservation dépassée
    // On combine reservationDate (Date) + reservationTime (String "HH:MM") pour calculer l'heure exacte
    const overdueReservations = await Reservation.find({
      status: "pending",
      reservationDate: { $exists: true },
      reservationTime: { $exists: true },
    }).lean();
    
    // ⭐ Filtrer celles qui sont vraiment en retard (>10 min)
    const toCancel = [];
    
    for (const resa of overdueReservations) {
      // Construire la Date complète à partir de reservationDate + reservationTime
      const resaDateTime = new Date(resa.reservationDate);
      
      if (resa.reservationTime && /^\d{2}:\d{2}$/.test(resa.reservationTime)) {
        const [hours, minutes] = resa.reservationTime.split(":").map(Number);
        resaDateTime.setHours(hours, minutes, 0, 0);
      } else {
        // Si reservationTime invalide, utiliser 12:00 par défaut
        resaDateTime.setHours(12, 0, 0, 0);
      }
      
      // ⚡ Si la date/heure de réservation + 10 min < maintenant → annuler
      if (resaDateTime < tenMinutesAgo) {
        toCancel.push(resa);
      }
    }
    
    if (toCancel.length === 0) {
      return { cancelledCount: 0, reservations: [] };
    }
    
    // ⭐ Annuler les réservations en retard
    const cancelledReservations = [];
    
    for (const resa of toCancel) {
      try {
        const updated = await Reservation.findByIdAndUpdate(
          resa._id,
          {
            $set: {
              status: "cancelled",
              isPresent: false,
              canceled: true,
              canceledAt: new Date(),
            },
            $push: {
              auditLog: {
                timestamp: new Date(),
                action: "auto_cancelled",
                userType: "system",
                userName: "AutoCancellation",
                message: "Réservation annulée automatiquement (retard >10 min)",
              },
            },
          },
          { new: true }
        );
        
        if (updated) {
          cancelledReservations.push(updated);
          
          // ⭐ Émettre événement WebSocket pour notifier le frontend
          if (io && updated.restaurantId) {
            emitReservationEvent(
              io,
              updated.restaurantId.toString(),
              "statusUpdated",
              updated.toObject(),
            );
          }
        }
      } catch (err) {
        console.error(`❌ [AUTO-CANCEL] Erreur annulation ${resa._id}:`, err.message);
      }
    }
    
    const duration = Date.now() - startTime;
    
    if (cancelledReservations.length > 0) {
      console.log(
        `🔔 [AUTO-CANCEL] ${cancelledReservations.length} réservations annulées (retard >10 min) en ${duration}ms`
      );
    }
    
    return {
      cancelledCount: cancelledReservations.length,
      reservations: cancelledReservations,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ [AUTO-CANCEL] Erreur globale après ${duration}ms:`, err);
    return { cancelledCount: 0, reservations: [] };
  }
}

module.exports = {
  cancelOverdueReservations,
};
