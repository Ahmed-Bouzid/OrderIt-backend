# 📅 Agenda — Documentation complète

**Guide de référence** : Job scheduler distribué pour SunnyGo backend

**Date** : 31 mai 2026  
**Status** : Documentation de référence  
**Migration** : Plan disponible dans [../MIGRATION_AGENDA.md](../MIGRATION_AGENDA.md)

---

## 📖 Table des matières

1. [Qu'est-ce qu'Agenda ?](#quest-ce-quagenda)
2. [Pourquoi Agenda vs node-cron ?](#pourquoi-agenda-vs-node-cron)
3. [Architecture et fonctionnement](#architecture-et-fonctionnement)
4. [Coût et dépendances](#coût-et-dépendances)
5. [Avantages et limitations](#avantages-et-limitations)
6. [Comparaison détaillée](#comparaison-détaillée)
7. [Quand migrer ?](#quand-migrer)
8. [Plan de migration](#plan-de-migration)
9. [Ressources et support](#ressources-et-support)

---

## 🎯 Qu'est-ce qu'Agenda ?

**Agenda** est un **job scheduler distribué** qui stocke ses jobs dans **MongoDB**.

### Principe de base

```
┌─────────────┐
│  Node.js    │
│  + Agenda   │───→ MongoDB
│             │     └─ Collection: agendaJobs
└─────────────┘        - Job definitions
                       - Execution history
                       - Locks (multi-instances)
```

### Fonctionnalités clés

- ✅ **Scheduling** : Exécution récurrente (cron syntax) ou one-time
- ✅ **Lock distribué** : 1 seul job exécuté même avec N instances
- ✅ **Persistance** : Jobs stockés en MongoDB (survit aux restarts)
- ✅ **Historique** : Toutes les exécutions tracées
- ✅ **Retry automatique** : Configurable avec backoff exponentiel
- ✅ **Priorités** : High/normal/low priority
- ✅ **Concurrence** : Max concurrent jobs configurables
- ✅ **Monitoring** : API pour stats (pending/running/completed)

### Package npm

```bash
npm install agenda

# Version actuelle : 5.x.x
# Popularité : ~400k downloads/semaine
# Maintenance : Active (dernière release récente)
# License : MIT (open-source, gratuit commercial)
```

---

## 🤔 Pourquoi Agenda vs node-cron ?

### Situation actuelle (node-cron)

**Ce qu'on a** :
```javascript
// backend/start.js
const cron = require("node-cron");
cron.schedule("* * * * *", async () => {
  await cancelOverdueReservations(io);
});
```

**Avantages** :
- ✅ Très simple (3 lignes de code)
- ✅ Zéro configuration
- ✅ Parfait pour 1 instance
- ✅ Déjà implémenté et fonctionnel

**Limitations** :
- ❌ Pas de support multi-instances (doublons garantis si scale)
- ❌ Pas d'historique (logs uniquement)
- ❌ Pas de retry automatique
- ❌ Jobs en RAM (perdus au restart)

### Problème concret : Scaling horizontal

**Scénario** : Vous activez 2 instances Render

```
┌──────────────┐
│  Instance 1  │
│  node-cron   │──→ Exécute le job à 14:42:00
└──────────────┘

┌──────────────┐
│  Instance 2  │
│  node-cron   │──→ Exécute le job à 14:42:00 aussi ❌
└──────────────┘

Résultat:
- 2 exécutions simultanées
- Logs doublés: 🔔 [AUTO-CANCEL] × 2
- Requêtes DB doublées
- Potentiel race condition
```

### Solution : Agenda avec lock distribué

```
┌──────────────┐
│  Instance 1  │
│  Agenda      │──→ Lock le job à 14:42:00 ✅
└──────────────┘     (lockedAt: instance1-socket-id)

┌──────────────┐
│  Instance 2  │
│  Agenda      │──→ Voit le lock → skip ✅
└──────────────┘

Résultat:
- 1 seule exécution
- Logs propres: 🔔 [AGENDA] × 1
- Pas de doublons
```

---

## 🏗️ Architecture et fonctionnement

### Single instance (comme maintenant)

```
┌─────────────────────────┐
│  Render Instance 1      │
│                         │
│  ┌──────────────────┐  │
│  │  Node.js         │  │
│  │  + Agenda        │──┼──→ MongoDB
│  │                  │  │    └─ agendaJobs
│  │  Job runner      │  │       - nextRunAt: 14:45:00
│  │  (processEvery)  │  │       - lockedAt: null
│  └──────────────────┘  │       - lastFinishedAt: 14:44:23
│                         │
└─────────────────────────┘

Flow:
1. Agenda poll MongoDB toutes les 30s
2. Job "cancel-overdue" détecté (nextRunAt < now)
3. Lock le job (lockedAt = instance1-id)
4. Exécute cancelOverdueReservations()
5. Release lock (lastFinishedAt = now)
6. Update nextRunAt (+1 minute)
```

### Multi-instances (après scale)

```
┌─────────────────────────┐
│  Instance 1             │
│  Agenda                 │──┐
└─────────────────────────┘  │
                             │
┌─────────────────────────┐  │    MongoDB (agendaJobs)
│  Instance 2             │  │    ┌────────────────────┐
│  Agenda                 │──┼───→│ Job: cancel-overdue│
└─────────────────────────┘  │    │ nextRunAt: 14:45   │
                             │    │ lockedAt: i1-sock  │ ← Lock distribué
┌─────────────────────────┐  │    │ lastRunAt: 14:44   │
│  Instance 3             │  │    └────────────────────┘
│  Agenda                 │──┘
└─────────────────────────┘

Flow avec 3 instances:
1. Instance 1,2,3 poll MongoDB toutes les 30s
2. Instance 2 détecte le job en premier (chance)
3. Instance 2 lock le job (atomic update MongoDB)
4. Instance 1,3 voient le lock → skip
5. Instance 2 exécute seule
6. Instance 2 release lock
7. Toutes les instances voient nextRunAt mis à jour
```

### Système de lock (atomic)

```javascript
// Lock MongoDB (atomic)
db.agendaJobs.findOneAndUpdate(
  {
    name: "cancel-overdue-reservations",
    lockedAt: null, // ← CRUCIAL : pas déjà locké
    nextRunAt: { $lte: new Date() }
  },
  {
    $set: {
      lockedAt: new Date(),
      lastModifiedBy: "instance1-socket-id"
    }
  }
);

// Résultat:
// - Instance 1 : update réussi → exécute
// - Instance 2,3 : update échoué (lockedAt ≠ null) → skip
```

---

## 💰 Coût et dépendances

### Package Agenda : 🆓 Gratuit

```bash
npm install agenda
# ✅ Open-source (MIT License)
# ✅ Gratuit pour usage commercial
# ✅ Pas de limite (instances, jobs, volume)
# ✅ Pas de service externe payant requis
```

### Storage MongoDB : 🆓 Déjà payé (0€ additionnel)

**Collection créée** : `agendaJobs`

**Coût storage** :
```
1 job = ~500 bytes à 1 KB
100 jobs = ~100 KB
1000 jobs = ~1 MB

Votre cas d'usage (1 job récurrent):
- 1 job "cancel-overdue-reservations"
- Historique optionnel (last 10 runs)
- Total: <10 KB (0.001% de 1 GB)
```

**Coût requêtes DB** :
```
Agenda poll MongoDB toutes les 30s par défaut
= 2 req/minute
= 120 req/heure
= 2,880 req/jour
= 86,400 req/mois

MongoDB Render gratuit: millions de req/jour
Impact: <0.1% de votre quota
```

### Compute : 🆓 Identique à node-cron

```
node-cron:
- CPU: check toutes les minutes (code JS)
- RAM: jobs en mémoire (négligeable)

Agenda:
- CPU: check toutes les 30s (code JS + 1 req MongoDB)
- RAM: connection MongoDB + cache jobs (négligeable)

Différence CPU: <0.001% (imperceptible)
Différence RAM: <1 MB (négligeable)
```

### Comparaison coûts alternatives

| Solution | Coût mensuel | Setup | Notes |
|----------|-------------|-------|-------|
| **node-cron** | 🆓 0€ | Inclus | 1 instance uniquement |
| **Agenda** | 🆓 0€ | MongoDB existant | Multi-instances OK |
| **Bull/BullMQ** | 💰 $5-15/mois | Redis requis | Redis Cloud ou Upstash |
| **AWS EventBridge** | 💰 $1-5/mois | AWS account | + CloudWatch logs |
| **Temporal** | 💰 $50+/mois | Cloud/self-hosted | Overkill pour ce cas |

### Verdict : 0€ de coût supplémentaire

**Pour SunnyGo** :
- ✅ Agenda = gratuit (package open-source)
- ✅ MongoDB = déjà payé (pas de coût additionnel)
- ✅ Render instances = déjà payées (pas de coût additionnel)
- ✅ Storage impact = <10 KB (négligeable)
- ✅ Requêtes DB impact = <0.1% quota

**C'est un upgrade gratuit de node-cron.** 🎁

---

## ⚖️ Avantages et limitations

### ✅ Avantages Agenda

#### 1. **Multi-instances production-ready**
```javascript
// Scenario: 3 instances Render
// node-cron: 3 exécutions simultanées ❌
// Agenda: 1 exécution avec lock distribué ✅
```

#### 2. **Historique complet**
```javascript
// Query MongoDB pour voir l'historique
db.agendaJobs.find({ name: "cancel-overdue-reservations" });

// Résultat:
{
  name: "cancel-overdue-reservations",
  lastRunAt: ISODate("2026-05-31T14:44:23Z"),
  lastFinishedAt: ISODate("2026-05-31T14:44:23.209Z"),
  nextRunAt: ISODate("2026-05-31T14:45:23Z"),
  failCount: 0,
  failReason: null,
  lockedAt: null
}

// → Debug facile : "Pourquoi Tom n'a pas été annulé ?"
// → Monitoring : "Le job tourne bien toutes les minutes ?"
```

#### 3. **Retry automatique**
```javascript
agenda.define('cancel-overdue', {
  attempts: 3, // Max 3 tentatives
  backoff: { type: 'exponential', delay: 60000 } // 1min, 2min, 4min
}, async (job) => {
  // Si throw → Agenda retry automatiquement
  await cancelOverdueReservations(io);
});

// Cas d'usage:
// - MongoDB timeout temporaire → retry auto
// - WebSocket erreur → retry auto
// - Logs détaillés: failCount, failReason
```

#### 4. **Monitoring API**
```javascript
const { getJobStats } = require('./services/agendaScheduler');

const stats = await getJobStats('cancel-overdue-reservations');
// {
//   total: 1,
//   running: 0,
//   failed: 0,
//   lastRun: "2026-05-31T14:44:23Z",
//   nextRun: "2026-05-31T14:45:23Z"
// }

// → Créer endpoint /admin/jobs/stats
// → Dashboard monitoring
// → Alerting si failed > 0
```

#### 5. **Priorités et concurrence**
```javascript
// Job haute priorité (exécuté en premier)
agenda.every('1 minute', 'cancel-overdue', { priority: 'high' });

// Job basse priorité (peut attendre)
agenda.every('1 hour', 'cleanup-old-sessions', { priority: 'low' });

// Max 5 jobs en parallèle (évite surcharge DB)
agenda.maxConcurrency(5);

// Cas d'usage:
// - Plusieurs jobs → ordre d'exécution garanti
// - Limiter charge DB (évite spike)
```

#### 6. **Graceful shutdown**
```javascript
process.on('SIGTERM', async () => {
  await agenda.stop(); // Attend que jobs en cours finissent
  await mongoose.disconnect();
  process.exit(0);
});

// node-cron: jobs coupés brutalement au restart
// Agenda: jobs finissent proprement avant arrêt
```

### ⚠️ Limitations Agenda

#### 1. **Complexité initiale**
```javascript
// node-cron (3 lignes)
const cron = require("node-cron");
cron.schedule("* * * * *", async () => { ... });

// Agenda (50+ lignes)
const agenda = new Agenda({ db: { ... } });
agenda.define('job', async (job) => { ... });
await agenda.start();
await agenda.every('1 minute', 'job');

// → Setup plus verbeux
// → Courbe d'apprentissage
```

#### 2. **Légère latence de démarrage**
```
node-cron:
- Exécution immédiate à la minute pile
- 00:00:00 → job exécuté instantanément

Agenda:
- Polling toutes les 30s par défaut
- 00:00:00 → détecté entre 00:00 et 00:30
- Latence max: 30 secondes

Impact pour SunnyGo: négligeable
- Tolérance: 10 minutes (annulation réservations)
- 30s de latence = <5% de la tolérance

Solution si besoin:
agenda.processEvery('10 seconds'); // Polling plus fréquent
```

#### 3. **Dépendance MongoDB**
```
node-cron: fonctionne même si MongoDB down
Agenda: ne peut pas exécuter jobs si MongoDB down

Impact pour SunnyGo: aucun
- App entière dépend de MongoDB
- Si MongoDB down → app down de toute façon
- Agenda n'ajoute pas de risque supplémentaire
```

#### 4. **Collection MongoDB supplémentaire**
```
Collection agendaJobs ajoutée à votre base
- Impact: <10 KB pour votre cas
- Nettoyage optionnel si >1000 jobs historique
- Pas de problème en pratique
```

---

## 📊 Comparaison détaillée

### Tableau complet

| Critère | node-cron | Agenda |
|---------|-----------|--------|
| **Setup** | ⭐⭐⭐⭐⭐ Très simple (3 lignes) | ⭐⭐⭐ Moyenne (50 lignes) |
| **Fiabilité 1 instance** | ⭐⭐⭐⭐⭐ Parfait | ⭐⭐⭐⭐⭐ Parfait |
| **Fiabilité multi-instances** | ⭐ Doublons garantis | ⭐⭐⭐⭐⭐ Lock distribué |
| **Historique** | ❌ Logs uniquement | ✅ MongoDB complet |
| **Retry automatique** | ❌ Manuel | ✅ Configurable |
| **Monitoring** | ⭐⭐ Logs basiques | ⭐⭐⭐⭐⭐ API avancée |
| **Priorités** | ❌ | ✅ High/normal/low |
| **Concurrence** | ❌ | ✅ Max jobs configurables |
| **Graceful shutdown** | ❌ | ✅ Jobs finissent proprement |
| **Persistance** | ❌ RAM (perdu restart) | ✅ MongoDB |
| **Latence exécution** | ⭐⭐⭐⭐⭐ Instantanée | ⭐⭐⭐⭐ ~30s max |
| **Coût** | 🆓 0€ | 🆓 0€ (même coût) |
| **Maintenance** | ⭐⭐⭐⭐⭐ Aucune | ⭐⭐⭐⭐ Nettoyage optionnel |
| **Courbe apprentissage** | ⭐⭐⭐⭐⭐ Immédiate | ⭐⭐⭐ Moyenne |

### Cas d'usage idéaux

#### node-cron (actuel)
✅ **Parfait si** :
- 1 seule instance garantie (6+ mois)
- Jobs simples, non-critiques
- Pas besoin d'historique
- Simplicité absolue prioritaire

#### Agenda (cible)
✅ **Parfait si** :
- Scaling horizontal (2+ instances)
- Besoin historique/monitoring
- Retry automatique requis
- Plusieurs jobs récurrents
- Production enterprise

---

## 🎯 Quand migrer ?

### ✅ Déclencheurs (1 suffit pour GO)

#### 1. **Scaling >1 instance**
```bash
# Si vous activez ça sur Render:
render.yaml:
  services:
    - type: web
      instances: 2  # ← Déclencheur immédiat

# → Migrer vers Agenda AVANT ou dès activation
```

#### 2. **Logs doublés détectés**
```
# Si vous voyez ça dans Render logs:
🔔 [AUTO-CANCEL] 1 réservations annulées  ← Instance 1
🔔 [AUTO-CANCEL] 1 réservations annulées  ← Instance 2 (DOUBLON!)

# → Migrer vers Agenda IMMÉDIATEMENT
```

#### 3. **Ajout autres jobs récurrents**
```javascript
// Si vous prévoyez d'ajouter:
- Rapports quotidiens (analytics)
- Cleanup sessions expirées
- Sync données externes
- Notifications programmées
- Export automatisé

// → Migrer vers Agenda pour base solide
```

#### 4. **Besoin monitoring avancé**
```
// Si vous voulez:
- Dashboard jobs (admin panel)
- Alerting si jobs échouent
- Historique exécutions (debug)
- Métriques performance

// → Migrer vers Agenda
```

### ⏸️ Reporter si

#### 1. **1 instance garantie longtemps**
```
✅ Garder node-cron si:
- 1 instance Render confirmée pour 6+ mois
- Pas de plan de scaling
- Traffic stable, pas de croissance prévue
```

#### 2. **node-cron fonctionne bien**
```
✅ Garder node-cron si:
- Aucun bug détecté
- Aucune plainte utilisateurs
- Logs propres
- Monitoring actuel suffisant
```

#### 3. **Pas le temps maintenant**
```
⏸️ Reporter migration si:
- Incident en cours (résoudre d'abord)
- Déploiement critique prévu (attendre après)
- Planning serré (pas de 1-2h dispo)
- Préférence pour tester tranquillement
```

### 🔔 Signaux d'alerte (migrer vite)

| Signal | Gravité | Action |
|--------|---------|--------|
| Logs doublés | 🔴 Critique | Migrer dans 24h |
| Scaling activé | 🟠 Urgent | Migrer cette semaine |
| Jobs manqués | 🟡 Moyen | Évaluer migration |
| Croissance traffic | 🟢 Faible | Planifier migration |

---

## 🚀 Plan de migration

### Résumé exécutif

**Durée** : ~40 minutes (avec tests)  
**Risque** : 🟢 Faible (rollback 5 min)  
**Coût** : 🆓 0€  
**Rollback** : `git revert HEAD && git push`

### Étapes condensées

1. ✅ **Install** : `npm install agenda` (30s)
2. ✅ **Code** : Créer `agendaScheduler.js` (10 min)
3. ✅ **Intégration** : Modifier `start.js` (5 min)
4. ✅ **Test local** : `npm start` (5 min)
5. ✅ **Commit** : Git commit + push (3 min)
6. ✅ **Vérifier** : Logs Render (5 min)
7. ✅ **Tests** : Validation fonctionnelle (10 min)

### Documents disponibles

📄 **Plan complet** : [../MIGRATION_AGENDA.md](../MIGRATION_AGENDA.md)
- 7 étapes détaillées
- Code prêt à copier/coller
- Checklist complète
- Tests validation
- Troubleshooting

⚡ **Quick Start** : [../MIGRATION_AGENDA_QUICKSTART.md](../MIGRATION_AGENDA_QUICKSTART.md)
- Version express 1h
- Commandes exactes
- Rollback rapide

### Lancer la migration

```bash
# Ouvrir le plan complet
cat backend/MIGRATION_AGENDA.md

# Suivre les 7 étapes une par une
# Ou demander à Copilot:
# "Lance la migration Agenda maintenant, suis le plan"
```

---

## 📚 Ressources et support

### Documentation officielle

- 📖 [Agenda GitHub](https://github.com/agenda/agenda)
- 📖 [Agenda API Reference](https://github.com/agenda/agenda#api-reference)
- 📖 [Agenda Examples](https://github.com/agenda/agenda/tree/master/examples)

### Commandes utiles MongoDB

```javascript
// Stats collection agendaJobs
db.agendaJobs.stats()

// Dernières exécutions
db.agendaJobs.find({}).sort({ lastRunAt: -1 }).limit(10)

// Jobs en cours (locked)
db.agendaJobs.find({ lockedAt: { $ne: null } })

// Jobs échoués
db.agendaJobs.find({ failCount: { $gt: 0 } })

// Nettoyer jobs anciens (>30 jours)
db.agendaJobs.deleteMany({
  lastFinishedAt: { $lt: new Date(Date.now() - 30*24*60*60*1000) }
})

// Forcer unlock si deadlock
db.agendaJobs.updateMany(
  { name: "cancel-overdue-reservations" },
  { $set: { lockedAt: null } }
)
```

### Monitoring production

```javascript
// Endpoint admin (optionnel)
router.get('/admin/jobs/stats', auth, checkRoles(['admin']), async (req, res) => {
  const { getJobStats } = require('../services/agendaScheduler');
  const stats = await getJobStats('cancel-overdue-reservations');
  res.json(stats);
});

// Réponse:
{
  total: 1,
  running: 0,
  failed: 0,
  lastRun: "2026-05-31T14:44:23Z",
  nextRun: "2026-05-31T14:45:23Z"
}
```

### Troubleshooting

#### Problème : Jobs ne s'exécutent pas

```bash
# Vérifier connexion MongoDB
db.agendaJobs.find({ name: "cancel-overdue-reservations" })

# Vérifier nextRunAt
# Si nextRunAt > now → pas encore l'heure
# Si nextRunAt < now et lockedAt=null → vérifier logs Agenda

# Vérifier processEvery
# Par défaut 30s → jobs détectés toutes les 30s max
```

#### Problème : Jobs bloqués (deadlock)

```bash
# Symptôme: lockedAt ≠ null depuis longtemps
db.agendaJobs.find({ 
  name: "cancel-overdue-reservations",
  lockedAt: { $ne: null }
})

# Solution: forcer unlock
db.agendaJobs.updateMany(
  { name: "cancel-overdue-reservations" },
  { $set: { lockedAt: null } }
)

# Prévention: configurer lockLifetime
agenda.defaultLockLifetime = 5 * 60 * 1000; // 5 min max
```

#### Problème : Collection agendaJobs trop grosse

```bash
# Si >1000 documents historique
db.agendaJobs.count() // Vérifier taille

# Solution: nettoyer anciens jobs
db.agendaJobs.deleteMany({
  lastFinishedAt: { $lt: new Date(Date.now() - 30*24*60*60*1000) }
})

# Automatiser nettoyage (optionnel)
agenda.define('cleanup-old-jobs', async () => {
  const jobs = await agenda.jobs({ name: 'cancel-overdue-reservations' });
  if (jobs.length > 100) {
    const toRemove = jobs.slice(100);
    for (const job of toRemove) await job.remove();
  }
});
agenda.every('1 week', 'cleanup-old-jobs');
```

### Support communauté

- 💬 [Agenda Issues GitHub](https://github.com/agenda/agenda/issues)
- 💬 [Stack Overflow tag:agenda](https://stackoverflow.com/questions/tagged/agenda)

---

## 🎯 Conclusion

### Recommandation SunnyGo

#### Court terme (maintenant - 3 mois)
✅ **Garder node-cron**
- Simple, fonctionne, 1 instance
- Pas d'urgence

#### Moyen terme (3-6 mois)
🟡 **Évaluer scaling**
- Si >1 instance prévu → migrer
- Si logs doublés → migrer immédiatement

#### Long terme (6-12 mois)
✅ **Migrer vers Agenda**
- Base solide pour croissance
- Monitoring avancé
- Multi-instances sans effort

### Checklist décision

- [ ] **Je scale >1 instance** → Migrer MAINTENANT
- [ ] **Logs doublés détectés** → Migrer IMMÉDIATEMENT
- [ ] **Besoin monitoring** → Migrer quand dispo
- [ ] **Ajout autres jobs** → Migrer avant ajout
- [ ] **1 instance, ça marche** → Garder node-cron

### Plan d'action

**Si GO migration** :
1. Lire [MIGRATION_AGENDA.md](../MIGRATION_AGENDA.md)
2. Bloquer 1-2h dans agenda
3. Suivre étapes une par une
4. Rollback facile si problème

**Si WAIT** :
1. Garder node-cron actuel
2. Surveiller logs (doublons ?)
3. Planifier migration si scale
4. Ce document reste référence

---

**Cette documentation compile toute la connaissance sur Agenda pour SunnyGo. Consultez-la à tout moment pour décider de migrer ou non.** 📖

**Dernière mise à jour** : 31 mai 2026  
**Version** : 1.0  
**Auteur** : Elite Feature Architect
