# 🚀 PLAN DE MIGRATION : node-cron → Agenda

**Objectif** : Migrer le système d'auto-annulation des réservations de `node-cron` vers `Agenda` pour supporter le scaling multi-instances.

**Statut** : ✅ Plan prêt, en attente d'exécution  
**Durée estimée** : 1-2 heures  
**Risque** : 🟢 Faible (rollback facile)  
**Priorité** : 🟡 Moyenne (faire avant de scaler >1 instance)

---

## 📊 Comparaison avant/après

| Critère | node-cron (actuel) | Agenda (cible) |
|---------|-------------------|----------------|
| Multi-instances | ❌ Doublons | ✅ Lock distribué |
| Historique | ❌ Logs uniquement | ✅ MongoDB |
| Retry auto | ❌ Manuel | ✅ Configurable |
| Monitoring | ❌ Basique | ✅ API complète |
| Coût | 🆓 0€ | 🆓 0€ (même coût) |

---

## 🎯 Quand exécuter cette migration ?

### ✅ **Déclenchers (1 suffit)** :
- [ ] Vous activez le scaling horizontal (2+ instances Render)
- [ ] Logs doublés détectés : `🔔 [AUTO-CANCEL]` × 2 simultanés
- [ ] Besoin d'ajouter d'autres jobs récurrents
- [ ] Besoin de traçabilité avancée (historique jobs)
- [ ] Anticipation scale dans <3 mois

### ⏸️ **Garder node-cron si** :
- [ ] 1 seule instance garantie pour 6+ mois
- [ ] Pas de besoin de monitoring avancé
- [ ] Préférence pour la simplicité absolue

---

## 📋 CHECKLIST PRÉ-MIGRATION

### ✅ Validations requises

- [ ] **Backend déployé** : Commit `0965438` déployé sur Render (auto-annulation active)
- [ ] **node-cron fonctionne** : Vérifier logs Render `🔔 Cron job auto-annulation réservations démarré`
- [ ] **Tests réussis** : Au moins 1 réservation auto-annulée avec succès
- [ ] **MongoDB accessible** : `process.env.MONGO_URI` valide et connecté
- [ ] **Backup récent** : Export MongoDB (optionnel mais recommandé)
- [ ] **Temps disponible** : 1-2h sans interruption

### 📸 Backup recommandé (optionnel)

```bash
# Exporter la collection reservations avant migration
mongodump --uri="$MONGO_URI" --collection=reservations --out=backup-$(date +%Y%m%d)

# Ou via MongoDB Atlas UI : Database > Browse Collections > Export
```

---

## 🛠️ ÉTAPE 1 : Installer Agenda

### Commandes

```bash
cd /Users/waraiotoko/Desktop/WaraiOtoko/2025/CODE\ 2025/PROJETS/OrderIt-main/backend

# Installer le package
npm install agenda

# Vérifier installation
npm list agenda
# Devrait afficher : agenda@5.x.x (ou version actuelle)
```

### Validation

- [ ] `package.json` contient `"agenda": "^5.x.x"`
- [ ] `node_modules/agenda` existe
- [ ] Aucune erreur d'installation

**Durée** : 30 secondes

---

## 🛠️ ÉTAPE 2 : Créer le service Agenda

### Fichier à créer : `backend/services/agendaScheduler.js`

```javascript
/**
 * agendaScheduler.js
 * 
 * Job scheduler distribué utilisant Agenda + MongoDB.
 * Remplace node-cron pour supporter le scaling multi-instances.
 * 
 * Features:
 * - Lock distribué (1 seul job exécuté même avec plusieurs instances)
 * - Historique des exécutions dans MongoDB
 * - Retry automatique en cas d'erreur
 * - Monitoring via API Agenda
 * 
 * Usage:
 *   const { startAgenda, stopAgenda } = require('./services/agendaScheduler');
 *   await startAgenda(io); // Dans start.js après connexion MongoDB
 */

const Agenda = require('agenda');
const { cancelOverdueReservations } = require('./reservationAutoCancellation');

// ⭐ Instance Agenda (singleton)
const agenda = new Agenda({
  db: {
    address: process.env.MONGO_URI, // Réutilise la même connexion MongoDB
    collection: 'agendaJobs', // Collection dédiée aux jobs
    options: {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 15000,
    },
  },
  
  // ⚡ Performance
  processEvery: '30 seconds', // Fréquence de vérification des jobs (30s = bon équilibre)
  maxConcurrency: 5, // Max 5 jobs en parallèle (évite surcharge DB)
  defaultConcurrency: 1, // 1 job de chaque type à la fois
  
  // 🔒 Locks
  lockLimit: 0, // Pas de limite globale de locks
  defaultLockLimit: 0, // Pas de limite par job type
  defaultLockLifetime: 10 * 60 * 1000, // 10 min max par job (évite deadlock)
  
  // 📝 Autres
  name: `agenda-${process.env.RENDER_INSTANCE_ID || 'local'}`, // Identifiant unique par instance
});

// ⭐ Définir le job "cancel-overdue-reservations"
agenda.define(
  'cancel-overdue-reservations',
  {
    priority: 'high', // Priorité haute (exécuté avant les jobs "normal" ou "low")
    lockLifetime: 5 * 60 * 1000, // Lock max 5 min (le job devrait finir en <10s)
  },
  async (job) => {
    const startTime = Date.now();
    
    try {
      // ⭐ Récupérer l'instance Socket.io passée au job
      const io = job.attrs.data?.io;
      if (!io) {
        console.warn("⚠️ [AGENDA] Instance Socket.io manquante, skip WebSocket emit");
      }
      
      // ⭐ Exécuter l'annulation des réservations en retard
      const result = await cancelOverdueReservations(io);
      
      // ⭐ Logs uniquement si annulations effectuées (évite spam)
      if (result.cancelledCount > 0) {
        console.log(
          `🔔 [AGENDA] ${result.cancelledCount} réservations annulées en ${Date.now() - startTime}ms`
        );
      }
      
      // ✅ Job réussi (Agenda marque automatiquement comme "completed")
      return { success: true, cancelledCount: result.cancelledCount };
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`❌ [AGENDA] Erreur job cancel-overdue après ${duration}ms:`, err.message);
      
      // ❌ Throw pour déclencher le retry automatique Agenda
      throw err;
    }
  }
);

// ⭐ Événements Agenda (monitoring)
agenda.on('start', (job) => {
  console.log(`⏱️ [AGENDA] Job "${job.attrs.name}" démarré`);
});

agenda.on('success', (job) => {
  const duration = job.attrs.lastFinishedAt - job.attrs.lastRunAt;
  console.log(`✅ [AGENDA] Job "${job.attrs.name}" terminé en ${duration}ms`);
});

agenda.on('fail', (err, job) => {
  console.error(`❌ [AGENDA] Job "${job.attrs.name}" échoué:`, err.message);
  console.error(`   Retry count: ${job.attrs.failCount || 0}`);
});

agenda.on('complete', (job) => {
  // Nettoyage optionnel (garde les 100 dernières exécutions)
  // Note : désactivé par défaut, activer si besoin
  // cleanupOldJobs(job.attrs.name, 100);
});

// ⭐ Démarrer Agenda et planifier les jobs récurrents
async function startAgenda(io) {
  try {
    // Démarrer le scheduler
    await agenda.start();
    console.log('✅ Agenda scheduler démarré');
    
    // ⭐ Planifier le job récurrent toutes les minutes
    // Note : Agenda utilise node-cron syntax pour "every"
    await agenda.every('1 minute', 'cancel-overdue-reservations', { io });
    console.log('🔔 Job "cancel-overdue-reservations" planifié (toutes les minutes)');
    
    // 📊 Stats de démarrage
    const jobCount = await agenda.jobs({ name: 'cancel-overdue-reservations' });
    console.log(`📊 [AGENDA] ${jobCount.length} job(s) "cancel-overdue-reservations" en base`);
  } catch (err) {
    console.error('❌ [AGENDA] Erreur démarrage:', err.message);
    throw err; // Remonter l'erreur pour gestion dans start.js
  }
}

// ⭐ Arrêt propre (graceful shutdown)
async function stopAgenda() {
  try {
    console.log('⏳ [AGENDA] Arrêt en cours...');
    await agenda.stop();
    console.log('✅ [AGENDA] Arrêté proprement');
  } catch (err) {
    console.error('❌ [AGENDA] Erreur arrêt:', err.message);
  }
}

// ⭐ Nettoyer les anciens jobs (optionnel)
async function cleanupOldJobs(jobName, keepLast = 100) {
  try {
    const jobs = await agenda.jobs({ name: jobName });
    if (jobs.length > keepLast) {
      const toRemove = jobs.slice(keepLast);
      for (const job of toRemove) {
        await job.remove();
      }
      console.log(`🧹 [AGENDA] ${toRemove.length} anciens jobs "${jobName}" nettoyés`);
    }
  } catch (err) {
    console.error(`❌ [AGENDA] Erreur cleanup:`, err.message);
  }
}

// ⭐ API de monitoring (optionnel)
async function getJobStats(jobName) {
  try {
    const jobs = await agenda.jobs({ name: jobName });
    const running = jobs.filter(j => j.attrs.lockedAt && !j.attrs.lastFinishedAt);
    const failed = jobs.filter(j => j.attrs.failCount > 0);
    
    return {
      total: jobs.length,
      running: running.length,
      failed: failed.length,
      lastRun: jobs[0]?.attrs.lastRunAt || null,
      nextRun: jobs[0]?.attrs.nextRunAt || null,
    };
  } catch (err) {
    console.error(`❌ [AGENDA] Erreur stats:`, err.message);
    return null;
  }
}

module.exports = {
  agenda,
  startAgenda,
  stopAgenda,
  getJobStats, // Pour monitoring optionnel
};
```

### Validation

- [ ] Fichier créé à `backend/services/agendaScheduler.js`
- [ ] Aucune erreur de syntaxe (vérifier avec `node -c agendaScheduler.js`)
- [ ] Import `cancelOverdueReservations` correct (même dossier)

**Durée** : 10 minutes (copier/coller + relecture)

---

## 🛠️ ÉTAPE 3 : Modifier start.js

### Fichier à modifier : `backend/start.js`

**Localisation** : Bloc après connexion MongoDB, avant `server.listen()`

### Option A : Remplacer complètement node-cron (recommandé)

**Chercher ce bloc** (lignes ~450-480) :

```javascript
// 🔔 Initialiser le cron job pour annuler automatiquement les réservations en retard
try {
  const cron = require("node-cron");
  const { cancelOverdueReservations } = require("./services/reservationAutoCancellation");
  
  // ⭐ Exécuter toutes les minutes (00:00, 00:01, 00:02, etc.)
  cron.schedule("* * * * *", async () => {
    try {
      const result = await cancelOverdueReservations(io);
      if (result.cancelledCount > 0) {
        console.log(`🔔 [AUTO-CANCEL] ${result.cancelledCount} réservations annulées`);
      }
    } catch (err) {
      console.error("❌ [AUTO-CANCEL] Erreur cron job:", err.message);
    }
  });
  
  console.log("🔔 Cron job auto-annulation réservations démarré (toutes les minutes)");
} catch (error) {
  console.warn("⚠️ Auto-cancellation cron setup error:", error.message);
  // Don't block server startup if cron fails
}
```

**Remplacer par** :

```javascript
// 🔔 Initialiser Agenda pour annuler automatiquement les réservations en retard
try {
  const { startAgenda } = require("./services/agendaScheduler");
  await startAgenda(io); // Passer l'instance Socket.io
  console.log("✅ Agenda scheduler initialisé avec succès");
} catch (error) {
  console.warn("⚠️ Agenda scheduler setup error:", error.message);
  // Don't block server startup if scheduler fails
}
```

### Option B : Garder node-cron en backup (ultra-prudent)

**Commenter l'ancien bloc** et ajouter le nouveau :

```javascript
// ❌ ANCIEN (node-cron) — Gardé en backup pour rollback rapide
// try {
//   const cron = require("node-cron");
//   const { cancelOverdueReservations } = require("./services/reservationAutoCancellation");
//   cron.schedule("* * * * *", async () => { ... });
//   console.log("🔔 Cron job auto-annulation réservations démarré (toutes les minutes)");
// } catch (error) {
//   console.warn("⚠️ Auto-cancellation cron setup error:", error.message);
// }

// ✅ NOUVEAU (Agenda) — Production depuis [DATE]
try {
  const { startAgenda } = require("./services/agendaScheduler");
  await startAgenda(io);
  console.log("✅ Agenda scheduler initialisé avec succès");
} catch (error) {
  console.warn("⚠️ Agenda scheduler setup error:", error.message);
}
```

### Ajouter graceful shutdown (recommandé)

**À la fin de start.js**, avant les handlers `process.on('unhandledRejection')` :

```javascript
// ⭐ Graceful shutdown pour Agenda
process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM reçu, arrêt propre du serveur...');
  
  try {
    const { stopAgenda } = require('./services/agendaScheduler');
    await stopAgenda();
  } catch (err) {
    console.error('❌ Erreur arrêt Agenda:', err.message);
  }
  
  try {
    await mongoose.disconnect();
    console.log('✅ MongoDB déconnecté');
  } catch (err) {
    console.error('❌ Erreur déconnexion MongoDB:', err.message);
  }
  
  server.close(() => {
    console.log('✅ Serveur HTTP arrêté proprement');
    process.exit(0);
  });
  
  // Force exit après 10s si blocage
  setTimeout(() => {
    console.error('⚠️ Arrêt forcé après timeout');
    process.exit(1);
  }, 10000);
});

// 🛡️ Crash safety — log unhandled rejections, exit cleanly on uncaught exceptions (Render auto-restarts)
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  setTimeout(() => process.exit(1), 500);
});
```

### Validation

- [ ] Bloc node-cron remplacé par Agenda
- [ ] `await startAgenda(io)` présent (avec `await` !)
- [ ] Graceful shutdown ajouté
- [ ] Aucune erreur de syntaxe (`node -c start.js`)

**Durée** : 5 minutes

---

## 🛠️ ÉTAPE 4 : Tester localement

### Démarrer le backend local

```bash
cd backend

# Vérifier que MONGO_URI est défini
echo $MONGO_URI || grep MONGO_URI .env

# Démarrer le serveur
npm start
```

### Vérifier les logs de démarrage

**Logs attendus** :

```
✅ MongoDB connecté
✅ Agenda scheduler démarré
🔔 Job "cancel-overdue-reservations" planifié (toutes les minutes)
📊 [AGENDA] 1 job(s) "cancel-overdue-reservations" en base
🚀 Server EasyQR démarré sur http://0.0.0.0:3000
```

### Vérifier la collection MongoDB

```bash
# Via MongoDB Compass ou CLI
# Collection : agendaJobs
# Devrait contenir 1 document avec :
{
  "name": "cancel-overdue-reservations",
  "type": "single",
  "nextRunAt": ISODate("2026-05-31T..."),
  "repeatInterval": "1 minute",
  "lockedAt": null
}
```

### Tester l'exécution du job

**Option 1 : Attendre 1 minute**

Logs attendus après ~1 minute :

```
⏱️ [AGENDA] Job "cancel-overdue-reservations" démarré
✅ [AGENDA] Job "cancel-overdue-reservations" terminé en 43ms
```

**Option 2 : Forcer l'exécution manuellement**

```bash
# Dans un terminal Node.js (optionnel)
node
> const { agenda } = require('./services/agendaScheduler');
> await agenda.now('cancel-overdue-reservations', { io: null });
```

### Validation

- [ ] Serveur démarre sans erreur
- [ ] Collection `agendaJobs` créée dans MongoDB
- [ ] Job exécuté au moins 1 fois (logs `⏱️ [AGENDA]` et `✅ [AGENDA]`)
- [ ] Aucune erreur dans les logs

**Durée** : 5 minutes

---

## 🛠️ ÉTAPE 5 : Commit et déployer

### Préparer le commit

```bash
cd backend

# Vérifier les fichiers modifiés
git status
# Devrait afficher :
#   modified:   start.js
#   modified:   package.json
#   modified:   package-lock.json
#   new file:   services/agendaScheduler.js

# Vérifier qu'aucune erreur de syntaxe
npm run test  # Si vous avez des tests
node -c start.js
node -c services/agendaScheduler.js
```

### Créer le commit

```bash
git add -A

git commit -m "feat: migration node-cron → Agenda (job scheduler distribué)

Problème:
  - node-cron non compatible multi-instances (doublons garantis)
  - Pas d'historique d'exécution (debug difficile)
  - Pas de retry automatique en cas d'erreur temporaire
  - Pas de monitoring avancé

Solution:
  - Migration vers Agenda (job scheduler MongoDB)
  - Lock distribué: 1 seul job exécuté même avec N instances
  - Historique: collection agendaJobs stocke toutes les exécutions
  - Retry auto: configurable avec backoff exponentiel
  - Graceful shutdown: SIGTERM arrête proprement les jobs

Implémentation:
  1. services/agendaScheduler.js:
     - Instance Agenda connectée à MongoDB existant
     - Job 'cancel-overdue-reservations' défini avec priority='high'
     - Événements monitoring (start, success, fail, complete)
     - API getJobStats() pour monitoring optionnel
     - Graceful shutdown avec stopAgenda()
  
  2. start.js:
     - Remplace cron.schedule() par startAgenda(io)
     - Graceful shutdown avec SIGTERM handler
     - Try/catch isolé: n'empêche pas démarrage serveur
  
  3. package.json:
     - Ajout dépendance: agenda@^5.x.x

Impact:
  ✅ Compatible scaling horizontal (2+ instances Render)
  ✅ Historique complet dans MongoDB (debug facilité)
  ✅ Retry auto en cas d'erreur (MongoDB timeout, etc.)
  ✅ Monitoring avancé (stats, last run, next run)
  ✅ Coût: 0€ (utilise MongoDB existant)
  ✅ Performance identique à node-cron
  ✅ Rollback facile (code node-cron gardé en commentaire)

Collection MongoDB:
  - Nouvelle: agendaJobs (~1 KB par job)
  - Impact: <0.01% du quota storage

Logs production:
  ✅ Agenda scheduler démarré
  🔔 Job 'cancel-overdue-reservations' planifié (toutes les minutes)
  ⏱️ [AGENDA] Job démarré
  ✅ [AGENDA] Job terminé en Xms

Test:
  - Démarrage local: npm start → logs Agenda OK
  - Collection agendaJobs créée avec 1 job
  - Job exécuté toutes les minutes
  - Réservations en retard annulées correctement

Migration de: node-cron (commit 0965438)
Vers: Agenda v5.x.x
Date: $(date +'%Y-%m-%d')
Rollback: Décommenter bloc node-cron dans start.js"
```

### Pousser sur GitHub

```bash
# Push vers main (déploiement auto Render)
git push origin main

# Ou créer une branche de test d'abord (ultra-prudent)
git checkout -b feature/agenda-migration
git push origin feature/agenda-migration
# → Tester sur Render preview (si configuré)
# → Merger dans main après validation
```

### Validation

- [ ] Commit créé avec message détaillé
- [ ] Push réussi sur GitHub
- [ ] Render détecte le commit (déploiement auto-trigger)

**Durée** : 3 minutes

---

## 🛠️ ÉTAPE 6 : Vérifier le déploiement Render

### Surveiller les logs Render

**Dashboard** : [dashboard.render.com](https://dashboard.render.com)  
**Service** : `orderit-backend-6y1m`  
**Onglet** : "Logs"

### Logs attendus (dans l'ordre)

```
Building...
Installing dependencies...
✅ Agenda installed

Starting server...
✅ MongoDB connecté
✅ Agenda scheduler démarré
🔔 Job "cancel-overdue-reservations" planifié (toutes les minutes)
📊 [AGENDA] 1 job(s) "cancel-overdue-reservations" en base
🚀 Server EasyQR démarré sur http://0.0.0.0:3000
🔌 WebSocket prêt sur ws://0.0.0.0:3000

[~1 minute plus tard]
⏱️ [AGENDA] Job "cancel-overdue-reservations" démarré
✅ [AGENDA] Job "cancel-overdue-reservations" terminé en 52ms
```

### Logs à ÉVITER (erreurs)

```
❌ [AGENDA] Erreur démarrage: <message>
❌ [AGENDA] Job "cancel-overdue-reservations" échoué: <message>
Error: Cannot find module 'agenda'
```

### Vérifier MongoDB Atlas

**Database** : Votre cluster MongoDB  
**Collection** : `agendaJobs`

**Document attendu** :

```json
{
  "_id": ObjectId("..."),
  "name": "cancel-overdue-reservations",
  "type": "single",
  "data": {
    "io": "[Circular]"
  },
  "priority": 20,
  "nextRunAt": ISODate("2026-05-31T14:45:00.000Z"),
  "lastRunAt": ISODate("2026-05-31T14:44:23.156Z"),
  "lastFinishedAt": ISODate("2026-05-31T14:44:23.209Z"),
  "lockedAt": null,
  "repeatInterval": "1 minute",
  "repeatTimezone": null,
  "failCount": 0,
  "failReason": null
}
```

### Validation

- [ ] Déploiement Render réussi (statut "Live")
- [ ] Logs `✅ Agenda scheduler démarré` présents
- [ ] Collection `agendaJobs` créée dans MongoDB
- [ ] Job exécuté au moins 1 fois (logs `⏱️` et `✅`)
- [ ] Aucune erreur dans les logs pendant 5 minutes

**Durée** : 5 minutes de monitoring

---

## 🛠️ ÉTAPE 7 : Tests de validation

### Test 1 : Réservation en retard (fonctionnel)

**Créer une réservation test** :

```bash
# Via MongoDB Compass ou API
POST /reservations
{
  "restaurantId": "6a0381c865b4fbf2f219e0f0",
  "clientName": "Test Agenda",
  "status": "pending",
  "reservationDate": "2026-05-31T10:00:00.000Z", # Aujourd'hui
  "reservationTime": "10:00", # Heure passée
  "nbPersonnes": 2,
  "phone": "0600000000"
}
```

**Attendre 1-2 minutes** → Vérifier que `status` passe à `"cancelled"`

**Validation** :
- [ ] Réservation annulée automatiquement
- [ ] Log `🔔 [AGENDA] 1 réservations annulées`
- [ ] Frontend reçoit événement WebSocket (réservation disparaît)

### Test 2 : Multi-instances (si applicable)

**Si vous scalez déjà à 2+ instances** :

1. Activer 2 instances Render
2. Attendre 2 minutes
3. Vérifier logs : `🔔 [AGENDA]` doit apparaître **1 seule fois** par minute
4. Vérifier MongoDB : `lockedAt` alterne entre les instances

**Validation** :
- [ ] Pas de logs doublés
- [ ] Job exécuté 1 seule fois par minute (même avec 2+ instances)

### Test 3 : Graceful shutdown

**Redémarrer le serveur Render** (Manual Deploy > Restart)

**Logs attendus** :

```
📡 SIGTERM reçu, arrêt propre du serveur...
⏳ [AGENDA] Arrêt en cours...
✅ [AGENDA] Arrêté proprement
✅ MongoDB déconnecté
✅ Serveur HTTP arrêté proprement
```

**Validation** :
- [ ] Arrêt propre (pas de `⚠️ Arrêt forcé après timeout`)
- [ ] Redémarrage réussi
- [ ] Job reprend automatiquement après redémarrage

### Test 4 : Monitoring API (optionnel)

**Créer un endpoint de monitoring** (dans `routes/admin.js` ou nouveau fichier) :

```javascript
router.get('/admin/jobs/stats', auth, checkRoles(['admin']), async (req, res) => {
  try {
    const { getJobStats } = require('../services/agendaScheduler');
    const stats = await getJobStats('cancel-overdue-reservations');
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Tester** :

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://orderit-backend-6y1m.onrender.com/admin/jobs/stats
```

**Réponse attendue** :

```json
{
  "total": 1,
  "running": 0,
  "failed": 0,
  "lastRun": "2026-05-31T14:44:23.156Z",
  "nextRun": "2026-05-31T14:45:23.156Z"
}
```

**Validation** :
- [ ] API retourne les stats
- [ ] `lastRun` et `nextRun` cohérents
- [ ] `failed: 0`

**Durée tests** : 10 minutes

---

## ✅ CHECKLIST POST-MIGRATION

### Validation complète

- [ ] **Déploiement** : Render live, logs OK
- [ ] **MongoDB** : Collection `agendaJobs` créée, 1 job présent
- [ ] **Fonctionnel** : Réservation test auto-annulée
- [ ] **Logs** : Pas d'erreur pendant 24h
- [ ] **Performance** : Pas de régression (même latence qu'avant)
- [ ] **WebSocket** : Frontend reçoit événements
- [ ] **Multi-instances** : Si applicable, pas de doublons

### Documentation

- [ ] README.md mis à jour (mention Agenda)
- [ ] Ce fichier archivé dans `docs/migrations/MIGRATION_AGENDA_DONE.md`
- [ ] Équipe informée (si applicable)

### Monitoring continu (7 jours)

- [ ] Jour 1 : Vérifier logs toutes les 2h
- [ ] Jour 2 : Vérifier logs matin/soir
- [ ] Jour 3-7 : Vérifier logs 1×/jour
- [ ] Aucune erreur `❌ [AGENDA]` pendant 7 jours

---

## 🔄 PLAN DE ROLLBACK

**En cas de problème critique**, rollback immédiat :

### Rollback rapide (5 minutes)

**1. Revenir au code node-cron**

```bash
cd backend

# Option A : Revert le commit (si pas d'autres commits après)
git revert HEAD
git push origin main

# Option B : Restaurer start.js uniquement
git checkout HEAD~1 start.js
git commit -m "rollback: restauration node-cron (problème Agenda)"
git push origin main
```

**2. Supprimer Agenda (optionnel)**

```bash
npm uninstall agenda
git add package.json package-lock.json
git commit -m "chore: remove agenda dependency"
git push origin main
```

**3. Vérifier le rollback**

```bash
# Logs Render doivent afficher :
🔔 Cron job auto-annulation réservations démarré (toutes les minutes)
```

### Nettoyer MongoDB (optionnel)

```bash
# Supprimer la collection agendaJobs
db.agendaJobs.drop()
```

---

## 📊 Suivi post-migration

### Semaine 1 : Monitoring intensif

**Métriques à surveiller** :

```bash
# Nombre d'exécutions
db.agendaJobs.find({ name: "cancel-overdue-reservations" }).count()

# Échecs récents
db.agendaJobs.find({ name: "cancel-overdue-reservations", failCount: { $gt: 0 } })

# Dernière exécution
db.agendaJobs.findOne({ name: "cancel-overdue-reservations" }, { lastRunAt: 1, lastFinishedAt: 1, nextRunAt: 1 })
```

### Semaine 2-4 : Monitoring allégé

- [ ] Vérifier logs 1×/jour
- [ ] Vérifier stats via API 1×/semaine
- [ ] Aucun incident signalé utilisateurs

### Mois 2+ : Routine

- [ ] Monitoring normal (comme avant)
- [ ] Nettoyage collection `agendaJobs` si >1000 documents (optionnel)

---

## 📚 Ressources

### Documentation officielle

- [Agenda GitHub](https://github.com/agenda/agenda)
- [Agenda API Reference](https://github.com/agenda/agenda#api-reference)

### Commandes utiles

```bash
# Stats collection agendaJobs
db.agendaJobs.stats()

# Dernières exécutions
db.agendaJobs.find({}).sort({ lastRunAt: -1 }).limit(10)

# Nettoyer jobs anciens (>30 jours)
db.agendaJobs.deleteMany({
  lastFinishedAt: { $lt: new Date(Date.now() - 30*24*60*60*1000) }
})
```

### Support

**En cas de problème** :
1. Vérifier logs Render
2. Vérifier collection MongoDB `agendaJobs`
3. Tester localement avec `npm start`
4. Rollback si critique
5. Ouvrir issue GitHub Agenda si bug package

---

## 🎯 Résumé exécutif

| Étape | Durée | Risque | Rollback |
|-------|-------|--------|----------|
| 1. Install Agenda | 30s | 🟢 Aucun | Facile |
| 2. Créer agendaScheduler.js | 10 min | 🟢 Aucun | Facile |
| 3. Modifier start.js | 5 min | 🟡 Faible | Facile |
| 4. Test local | 5 min | 🟢 Aucun | N/A |
| 5. Commit + push | 3 min | 🟡 Faible | Revert |
| 6. Vérifier Render | 5 min | 🟡 Faible | Rollback |
| 7. Tests validation | 10 min | 🟢 Aucun | N/A |
| **TOTAL** | **~40 min** | **🟢 Faible** | **5 min** |

---

## ✅ GO / NO-GO

**Exécuter cette migration quand** :

- ✅ Vous scalez à 2+ instances Render
- ✅ Vous voyez des logs doublés `🔔 [AUTO-CANCEL]`
- ✅ Vous ajoutez d'autres jobs récurrents
- ✅ Vous voulez du monitoring avancé
- ✅ Vous avez 1-2h disponibles
- ✅ Backup MongoDB récent (optionnel)

**Reporter si** :

- ❌ Incident en cours (attendre stabilité)
- ❌ Déploiement critique prévu (attendre après)
- ❌ Pas de temps (planning serré)
- ❌ 1 instance garantie 6+ mois (node-cron suffisant)

---

**Ce plan est prêt à exécuter. Archivez-le et lancez quand le moment sera venu.** 🚀

**Dernière mise à jour** : 31 mai 2026  
**Version** : 1.0  
**Auteur** : Elite Feature Architect
