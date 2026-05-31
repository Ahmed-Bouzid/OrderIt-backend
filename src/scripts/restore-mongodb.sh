#!/bin/bash

###############################################################################
# 🔄 Script de restauration MongoDB depuis backup chiffré
# 
# Fonctionnalités:
# - Téléchargement depuis S3/GCS (optionnel)
# - Déchiffrement GPG
# - Décompression
# - Restauration MongoDB
# - Vérification intégrité
#
# Utilisation:
#   ./restore-mongodb.sh <backup_file.tar.gz.gpg>
#   ./restore-mongodb.sh s3://bucket/path/backup.tar.gz.gpg
#   ./restore-mongodb.sh gs://bucket/path/backup.tar.gz.gpg
###############################################################################

set -e # Arrêter si erreur

# === CONFIGURATION ===
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-orderit}"
TEMP_DIR="/tmp/mongodb-restore-$$"

# === VÉRIFICATION ARGUMENTS ===
if [ $# -eq 0 ]; then
  echo "❌ Erreur: Fichier backup requis"
  echo ""
  echo "Utilisation:"
  echo "  ./restore-mongodb.sh <backup_file.tar.gz.gpg>"
  echo "  ./restore-mongodb.sh s3://bucket/path/backup.tar.gz.gpg"
  echo "  ./restore-mongodb.sh gs://bucket/path/backup.tar.gz.gpg"
  echo ""
  echo "Exemples:"
  echo "  ./restore-mongodb.sh /var/backups/mongodb/mongodb_orderit_20260107_020000.tar.gz.gpg"
  echo "  ./restore-mongodb.sh s3://my-bucket/backups/mongodb/mongodb_orderit_20260107_020000.tar.gz.gpg"
  exit 1
fi

BACKUP_SOURCE="$1"

echo "=========================================="
echo "🔄 RESTAURATION MONGODB - $(date)"
echo "=========================================="
echo "Source: ${BACKUP_SOURCE}"
echo "Base cible: ${DB_NAME}"
echo ""

# === CRÉER DOSSIER TEMPORAIRE ===
mkdir -p "${TEMP_DIR}"
trap "rm -rf ${TEMP_DIR}" EXIT # Nettoyer à la sortie

# === 1. TÉLÉCHARGER LE BACKUP (si S3/GCS) ===
if [[ "${BACKUP_SOURCE}" == s3://* ]]; then
  echo "☁️  Téléchargement depuis S3..."
  BACKUP_FILE="${TEMP_DIR}/backup.tar.gz.gpg"
  
  if aws s3 cp "${BACKUP_SOURCE}" "${BACKUP_FILE}" --quiet; then
    echo "✅ Téléchargement S3 réussi"
  else
    echo "❌ Erreur téléchargement S3"
    exit 1
  fi
  
elif [[ "${BACKUP_SOURCE}" == gs://* ]]; then
  echo "☁️  Téléchargement depuis Google Cloud Storage..."
  BACKUP_FILE="${TEMP_DIR}/backup.tar.gz.gpg"
  
  if gsutil cp "${BACKUP_SOURCE}" "${BACKUP_FILE}" 2>/dev/null; then
    echo "✅ Téléchargement GCS réussi"
  else
    echo "❌ Erreur téléchargement GCS"
    exit 1
  fi
  
else
  # Fichier local
  BACKUP_FILE="${BACKUP_SOURCE}"
  
  if [ ! -f "${BACKUP_FILE}" ]; then
    echo "❌ Fichier introuvable: ${BACKUP_FILE}"
    exit 1
  fi
fi

# === 2. VÉRIFIER INTÉGRITÉ (si checksum disponible) ===
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "🔍 Vérification intégrité..."
  
  if sha256sum -c "${CHECKSUM_FILE}" --quiet; then
    echo "✅ Intégrité vérifiée (SHA256 OK)"
  else
    echo "❌ Erreur: Checksum invalide ! Fichier corrompu ?"
    exit 1
  fi
else
  echo "⚠️  Pas de checksum disponible (skip vérification)"
fi

# === 3. DÉCHIFFRER GPG ===
if [[ "${BACKUP_FILE}" == *.gpg ]]; then
  echo "🔐 Déchiffrement GPG en cours..."
  DECRYPTED_FILE="${TEMP_DIR}/backup.tar.gz"
  
  if gpg --yes --batch -d "${BACKUP_FILE}" > "${DECRYPTED_FILE}"; then
    echo "✅ Déchiffrement réussi"
    BACKUP_FILE="${DECRYPTED_FILE}"
  else
    echo "❌ Erreur déchiffrement GPG (clé privée absente?)"
    exit 1
  fi
fi

# === 4. DÉCOMPRESSER ===
echo "🗜️  Décompression en cours..."
EXTRACT_DIR="${TEMP_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"

if tar -xzf "${BACKUP_FILE}" -C "${EXTRACT_DIR}"; then
  echo "✅ Décompression réussie"
else
  echo "❌ Erreur décompression"
  exit 1
fi

# === 5. CONFIRMATION UTILISATEUR ===
echo ""
echo "⚠️  ATTENTION: Cette opération va ÉCRASER la base de données existante !"
echo "Base cible: ${DB_NAME}"
echo ""
read -p "Êtes-vous sûr de vouloir continuer ? (oui/non): " CONFIRM

if [ "${CONFIRM}" != "oui" ]; then
  echo "❌ Restauration annulée"
  exit 0
fi

# === 6. RESTAURER MONGODB ===
echo ""
echo "🔄 Restauration MongoDB en cours..."

# Trouver le dossier contenant la DB
DB_DIR=$(find "${EXTRACT_DIR}" -type d -name "${DB_NAME}" | head -n 1)

if [ -z "${DB_DIR}" ]; then
  echo "❌ Base de données '${DB_NAME}' introuvable dans le backup"
  echo "Contenu disponible:"
  find "${EXTRACT_DIR}" -type d -maxdepth 3
  exit 1
fi

# Restauration avec drop (écrase la DB existante)
if mongorestore --uri="${MONGODB_URI}" --db="${DB_NAME}" --drop "${DB_DIR}" --quiet; then
  echo "✅ Restauration MongoDB réussie"
else
  echo "❌ Erreur restauration MongoDB"
  exit 1
fi

# === RÉSUMÉ ===
echo ""
echo "=========================================="
echo "✅ RESTAURATION TERMINÉE"
echo "=========================================="
echo "Base restaurée: ${DB_NAME}"
echo "Date: $(date)"
echo ""

# === VÉRIFICATION POST-RESTAURATION ===
echo "🔍 Vérification post-restauration..."

# Compter les collections
COLLECTIONS_COUNT=$(mongosh "${MONGODB_URI}/${DB_NAME}" --quiet --eval "db.getCollectionNames().length")
echo "Collections restaurées: ${COLLECTIONS_COUNT}"

# Exemple: Compter les restaurants
RESTAURANTS_COUNT=$(mongosh "${MONGODB_URI}/${DB_NAME}" --quiet --eval "db.restaurants.countDocuments({})")
echo "Restaurants: ${RESTAURANTS_COUNT}"

echo ""
echo "🎉 Restauration MongoDB réussie !"
echo "=========================================="

exit 0
