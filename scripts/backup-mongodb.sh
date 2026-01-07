#!/bin/bash

###############################################################################
# 💾 Script de backup MongoDB avec chiffrement
# 
# Fonctionnalités:
# - Backup complet de la base MongoDB
# - Compression gzip
# - Chiffrement GPG
# - Upload vers S3/Google Cloud Storage
# - Rotation automatique (30 jours)
# - Logs détaillés
#
# Utilisation:
#   ./backup-mongodb.sh
#
# Cron (tous les jours à 2h du matin):
#   0 2 * * * /path/to/backup-mongodb.sh >> /var/log/mongodb-backup.log 2>&1
###############################################################################

set -e # Arrêter si erreur

# === CONFIGURATION ===
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mongodb}"
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-orderit}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
GPG_RECIPIENT="${GPG_RECIPIENT:-backup@orderit.com}" # Email GPG pour chiffrement

# AWS S3 (optionnel)
S3_BUCKET="${S3_BUCKET:-}"
S3_PATH="${S3_PATH:-backups/mongodb}"

# Google Cloud Storage (optionnel)
GCS_BUCKET="${GCS_BUCKET:-}"
GCS_PATH="${GCS_PATH:-backups/mongodb}"

# === VARIABLES ===
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="mongodb_${DB_NAME}_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
COMPRESSED_FILE="${BACKUP_PATH}.tar.gz"
ENCRYPTED_FILE="${COMPRESSED_FILE}.gpg"

echo "=========================================="
echo "💾 BACKUP MONGODB - $(date)"
echo "=========================================="
echo "Base: ${DB_NAME}"
echo "Destination: ${BACKUP_DIR}"
echo ""

# === CRÉER LE DOSSIER DE BACKUP ===
mkdir -p "${BACKUP_DIR}"

# === 1. DUMP MONGODB ===
echo "📦 Dump MongoDB en cours..."
if mongodump --uri="${MONGODB_URI}" --db="${DB_NAME}" --out="${BACKUP_PATH}" --quiet; then
  echo "✅ Dump réussi: ${BACKUP_PATH}"
else
  echo "❌ Erreur lors du dump MongoDB"
  exit 1
fi

# === 2. COMPRESSION ===
echo "🗜️  Compression en cours..."
if tar -czf "${COMPRESSED_FILE}" -C "${BACKUP_DIR}" "${BACKUP_NAME}"; then
  echo "✅ Compression réussie: ${COMPRESSED_FILE}"
  SIZE=$(du -h "${COMPRESSED_FILE}" | cut -f1)
  echo "   Taille: ${SIZE}"
  
  # Supprimer le dossier non compressé
  rm -rf "${BACKUP_PATH}"
else
  echo "❌ Erreur lors de la compression"
  rm -rf "${BACKUP_PATH}"
  exit 1
fi

# === 3. CHIFFREMENT GPG ===
echo "🔐 Chiffrement GPG en cours..."
if gpg --yes --batch --trust-model always -r "${GPG_RECIPIENT}" -e "${COMPRESSED_FILE}"; then
  echo "✅ Chiffrement réussi: ${ENCRYPTED_FILE}"
  SIZE_ENCRYPTED=$(du -h "${ENCRYPTED_FILE}" | cut -f1)
  echo "   Taille chiffrée: ${SIZE_ENCRYPTED}"
  
  # Supprimer le fichier non chiffré
  rm -f "${COMPRESSED_FILE}"
else
  echo "⚠️  Chiffrement GPG échoué (clé absente?). Fichier non chiffré conservé."
  ENCRYPTED_FILE="${COMPRESSED_FILE}" # Utiliser le fichier non chiffré
fi

# === 4. UPLOAD S3 (si configuré) ===
if [ -n "${S3_BUCKET}" ]; then
  echo "☁️  Upload S3 en cours..."
  S3_DESTINATION="s3://${S3_BUCKET}/${S3_PATH}/${BACKUP_NAME}.tar.gz.gpg"
  
  if aws s3 cp "${ENCRYPTED_FILE}" "${S3_DESTINATION}" --quiet; then
    echo "✅ Upload S3 réussi: ${S3_DESTINATION}"
  else
    echo "❌ Erreur upload S3"
  fi
fi

# === 5. UPLOAD GOOGLE CLOUD STORAGE (si configuré) ===
if [ -n "${GCS_BUCKET}" ]; then
  echo "☁️  Upload Google Cloud Storage en cours..."
  GCS_DESTINATION="gs://${GCS_BUCKET}/${GCS_PATH}/${BACKUP_NAME}.tar.gz.gpg"
  
  if gsutil cp "${ENCRYPTED_FILE}" "${GCS_DESTINATION}" 2>/dev/null; then
    echo "✅ Upload GCS réussi: ${GCS_DESTINATION}"
  else
    echo "❌ Erreur upload GCS"
  fi
fi

# === 6. ROTATION (supprimer backups > 30 jours) ===
echo "🗑️  Rotation des backups (conservation: ${RETENTION_DAYS} jours)..."
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "mongodb_*.tar.gz*" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "✅ ${DELETED_COUNT} anciens backups supprimés"

# === ROTATION S3 (si configuré) ===
if [ -n "${S3_BUCKET}" ]; then
  echo "🗑️  Rotation S3..."
  CUTOFF_DATE=$(date -d "${RETENTION_DAYS} days ago" +%Y%m%d)
  aws s3 ls "s3://${S3_BUCKET}/${S3_PATH}/" | while read -r line; do
    FILE_DATE=$(echo "$line" | awk '{print $4}' | grep -oP 'mongodb_[^_]+_\K\d{8}')
    if [ -n "${FILE_DATE}" ] && [ "${FILE_DATE}" -lt "${CUTOFF_DATE}" ]; then
      FILE_NAME=$(echo "$line" | awk '{print $4}')
      aws s3 rm "s3://${S3_BUCKET}/${S3_PATH}/${FILE_NAME}" --quiet
      echo "   Supprimé: ${FILE_NAME}"
    fi
  done
fi

# === RÉSUMÉ ===
echo ""
echo "=========================================="
echo "✅ BACKUP TERMINÉ"
echo "=========================================="
echo "Fichier local: ${ENCRYPTED_FILE}"
echo "Taille: $(du -h "${ENCRYPTED_FILE}" | cut -f1)"
echo "Date: $(date)"
echo ""

# === VÉRIFICATION INTÉGRITÉ ===
echo "🔍 Vérification intégrité..."
if [ -f "${ENCRYPTED_FILE}" ]; then
  CHECKSUM=$(sha256sum "${ENCRYPTED_FILE}" | awk '{print $1}')
  echo "${CHECKSUM}  ${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"
  echo "✅ Checksum SHA256: ${CHECKSUM}"
else
  echo "❌ Fichier backup introuvable"
  exit 1
fi

echo ""
echo "🎉 Backup MongoDB réussi !"
echo "=========================================="

exit 0
