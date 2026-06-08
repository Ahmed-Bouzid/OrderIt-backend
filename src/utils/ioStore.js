/**
 * ioStore.js — singleton Socket.io instance
 *
 * Découple l'instance `io` de start.js pour éviter que les modules
 * (Order.js, reservations.js, etc.) déclenchent require("../start")
 * et lancent accidentellement server.listen() en environnement de test.
 */

let _io = null;

module.exports = {
  /** Appelé une seule fois par start.js après server.listen() */
  setIO(io) {
    _io = io;
  },
  /** Retourne l'instance io, ou null si pas encore initialisée */
  getIO() {
    return _io;
  },
};
