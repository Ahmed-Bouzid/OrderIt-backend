#!/bin/bash

###############################################################################
# 🧪 Script de test de backup/restauration MongoDB
# 
# Fonctionnalités:
# - Création d'une base de test
# - Backup
# - Restauration
# - Vérification intégrité
# - Rapport de test
#
# Utilisation:
#   ./test-restore.sh
#
# À exécuter régulièrement (cron mensuel) pour valider les backups
###############################################################################

set -e

# === CONFIGURATION ===
TEST_DB="orderit_test_$(date +%s)"
TEST_BACKUP_DIR="/tmp/mongodb-test-backup"
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017}"

echo "=========================================="
echo "🧪 TEST BACKUP/RESTORE MONGODB"
echo "=========================================="
echo "Base de test: ${TEST_DB}"
echo "Date: $(date)"
echo ""

# === NETTOYAGE ===
rm -rf "${TEST_BACKUP_DIR}"
mkdir -p "${TEST_BACKUP_DIR}"

# === 1. CRÉER UNE BASE DE TEST ===
echo "📝 Création base de test..."

mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "
  db.test_collection.insertMany([
    { name: 'Restaurant A', type: 'italian', active: true },
    { name: 'Restaurant B', type: 'french', active: false },
    { name: 'Restaurant C', type: 'japanese', active: true }
  ]);
  
  db.test_orders.insertMany([
    { orderId: 'ORD001', amount: 50.5, status: 'completed' },
    { orderId: 'ORD002', amount: 120.0, status: 'pending' }
  ]);
" > /dev/null

INITIAL_COUNT=$(mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.test_collection.countDocuments({})")
echo "✅ Base créée: ${INITIAL_COUNT} documents"

# === 2. BACKUP ===
echo ""
echo "💾 Backup en cours..."

BACKUP_NAME="test_backup_$(date +%Y%m%d_%H%M%S)"
BACKUP_PATH="${TEST_BACKUP_DIR}/${BACKUP_NAME}"

if mongodump --uri="${MONGODB_URI}" --db="${TEST_DB}" --out="${BACKUP_PATH}" --quiet; then
  echo "✅ Backup réussi"
else
  echo "❌ Erreur backup"
  mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.dropDatabase()" > /dev/null
  exit 1
fi

# Compression
tar -czf "${BACKUP_PATH}.tar.gz" -C "${TEST_BACKUP_DIR}" "${BACKUP_NAME}" 2>/dev/null
rm -rf "${BACKUP_PATH}"
echo "✅ Compression réussie"

# === 3. SUPPRIMER LA BASE ===
echo ""
echo "🗑️  Suppression base de test..."
mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.dropDatabase()" > /dev/null
echo "✅ Base supprimée"

# === 4. VÉRIFIER QUE LA BASE N'EXISTE PLUS ===
AFTER_DROP=$(mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.test_collection.countDocuments({})")
if [ "${AFTER_DROP}" -eq 0 ]; then
  echo "✅ Vérification: Base bien supprimée"
else
  echo "❌ Erreur: Base toujours présente"
  exit 1
fi

# === 5. RESTAURER ===
echo ""
echo "🔄 Restauration en cours..."

# Décompresser
tar -xzf "${BACKUP_PATH}.tar.gz" -C "${TEST_BACKUP_DIR}" 2>/dev/null

# Restaurer
if mongorestore --uri="${MONGODB_URI}" --db="${TEST_DB}" "${TEST_BACKUP_DIR}/${BACKUP_NAME}/${TEST_DB}" --quiet; then
  echo "✅ Restauration réussie"
else
  echo "❌ Erreur restauration"
  exit 1
fi

# === 6. VÉRIFIER L'INTÉGRITÉ ===
echo ""
echo "🔍 Vérification intégrité..."

RESTORED_COUNT=$(mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.test_collection.countDocuments({})")

if [ "${RESTORED_COUNT}" -eq "${INITIAL_COUNT}" ]; then
  echo "✅ Intégrité OK: ${RESTORED_COUNT} documents restaurés"
else
  echo "❌ Erreur intégrité: ${INITIAL_COUNT} attendus, ${RESTORED_COUNT} restaurés"
  exit 1
fi

# Vérifier le contenu
RESTAURANT_A=$(mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.test_collection.findOne({name: 'Restaurant A'}) !== null")
RESTAURANT_B=$(mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.test_collection.findOne({name: 'Restaurant B'}) !== null")

if [ "${RESTAURANT_A}" == "true" ] && [ "${RESTAURANT_B}" == "true" ]; then
  echo "✅ Contenu vérifié: Données cohérentes"
else
  echo "❌ Erreur: Données incohérentes"
  exit 1
fi

# === 7. NETTOYAGE ===
echo ""
echo "🧹 Nettoyage..."

mongosh "${MONGODB_URI}/${TEST_DB}" --quiet --eval "db.dropDatabase()" > /dev/null
rm -rf "${TEST_BACKUP_DIR}"
echo "✅ Nettoyage terminé"

# === RÉSUMÉ ===
echo ""
echo "=========================================="
echo "✅ TEST RÉUSSI"
echo "=========================================="
echo "✓ Backup fonctionnel"
echo "✓ Compression OK"
echo "✓ Restauration OK"
echo "✓ Intégrité vérifiée"
echo ""
echo "🎉 Système de backup validé !"
echo "=========================================="

exit 0
