# 🚀 MIGRATION AGENDA — QUICK START

**Document complet** : [MIGRATION_AGENDA.md](./MIGRATION_AGENDA.md)

---

## ⚡ Version Express (1h)

```bash
# 1️⃣ Installer (30s)
npm install agenda

# 2️⃣ Créer agendaScheduler.js (copier depuis MIGRATION_AGENDA.md)
# → backend/services/agendaScheduler.js

# 3️⃣ Modifier start.js
# Remplacer le bloc cron.schedule() par :
const { startAgenda } = require("./services/agendaScheduler");
await startAgenda(io);

# 4️⃣ Tester local
npm start
# → Vérifier logs: ✅ Agenda scheduler démarré

# 5️⃣ Commit + déployer
git add -A
git commit -m "feat: migration node-cron → Agenda"
git push origin main

# 6️⃣ Vérifier Render
# Logs → ✅ Agenda scheduler démarré
# MongoDB → Collection agendaJobs créée
```

---

## 🎯 Quand lancer ?

### ✅ GO si :
- Scaling >1 instance Render
- Logs doublés détectés
- Besoin monitoring avancé

### ⏸️ ATTENDRE si :
- 1 instance garantie 6+ mois
- node-cron fonctionne bien
- Pas le temps maintenant

---

## 🔄 Rollback (5 min)

```bash
git revert HEAD
git push origin main
```

---

**Tout est prêt. Exécutez quand vous voulez.** 🎯
