/**
 * 🗄️ Backup Service — Export MongoDB → Cloudflare R2
 *
 * Collections sauvegardées (données critiques métier) :
 *   orders, payments, reservations, restaurants, tables, products, servers
 *
 * Rétention : 30 derniers jours (rotation automatique)
 * Déclenchement : cron 3h du matin (voir start.js)
 * Stockage : Cloudflare R2 (bucket orderit-backups, 10 GB gratuits)
 *
 * Variables d'environnement requises (à définir sur Render) :
 *   R2_ACCOUNT_ID     — Cloudflare Account ID
 *   R2_ACCESS_KEY_ID  — Access Key ID du token R2
 *   R2_SECRET_KEY     — Secret Access Key du token R2
 *   R2_BUCKET_NAME    — Nom du bucket (ex: orderit-backups)
 */

const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const mongoose = require("mongoose");

// Taille minimum d'une part multipart S3/R2 : 5 MB
const MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024;

// Collections critiques à sauvegarder
const COLLECTIONS = [
  "orders",
  "payments",
  "reservations",
  "restaurants",
  "tables",
  "products",
  "servers",
  "tablesessions",
  "zreports",
];

// Rétention : nombre de jours de backups à conserver
const RETENTION_DAYS = 30;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_KEY) {
    throw new Error("Variables R2 manquantes (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_KEY)");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_KEY,
    },
  });
}

/**
 * Exporte une collection MongoDB en streaming vers R2 via multipart upload.
 * Jamais plus d'un batch en mémoire à la fois → RAM constante quelle que soit la taille.
 */
async function exportCollection(client, bucketName, dateStr, collectionName) {
  const db = mongoose.connection.db;
  const key = `${dateStr}/${collectionName}.json`;

  // Démarrer le multipart upload
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: "application/json",
  }));

  const parts = [];
  let partNumber = 1;
  let buffer = "";
  let count = 0;

  const uploadPart = async (body) => {
    const result = await client.send(new UploadPartCommand({
      Bucket: bucketName,
      Key: key,
      UploadId,
      PartNumber: partNumber,
      Body: Buffer.from(body, "utf8"),
    }));
    parts.push({ PartNumber: partNumber, ETag: result.ETag });
    partNumber++;
  };

  try {
    const cursor = db.collection(collectionName).find({});

    buffer = "[";
    let first = true;

    for await (const doc of cursor) {
      const chunk = (first ? "" : ",") + JSON.stringify(doc);
      first = false;
      count++;
      buffer += chunk;

      // Flush dès que le buffer dépasse 5 MB (minimum part size S3/R2)
      if (Buffer.byteLength(buffer, "utf8") >= MULTIPART_MIN_PART_SIZE) {
        await uploadPart(buffer);
        buffer = "";
      }
    }

    // Dernière partie : fermer le tableau JSON
    buffer += "]";
    await uploadPart(buffer);

    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      UploadId,
      MultipartUpload: { Parts: parts },
    }));

    return { collection: collectionName, count, key };
  } catch (err) {
    // Annuler le multipart upload pour ne pas laisser de fragments orphelins sur R2
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      UploadId,
    })).catch(() => {});
    throw err;
  }
}

/**
 * Supprime les backups plus vieux que RETENTION_DAYS jours
 */
async function cleanOldBackups(client, bucketName) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucketName }));
  if (!listed.Contents) return 0;

  let deleted = 0;
  for (const obj of listed.Contents) {
    const datePrefix = obj.Key.slice(0, 10); // extrait "YYYY-MM-DD" du chemin
    if (datePrefix < cutoffStr) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
      deleted++;
    }
  }
  return deleted;
}

/**
 * Point d'entrée principal — appelé par le cron job
 */
async function runBackup() {
  const start = Date.now();
  const dateStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const bucketName = process.env.R2_BUCKET_NAME || "orderit-backups";

  if (!process.env.R2_ACCOUNT_ID) {
    console.warn("[BACKUP] Variables R2 non configurées — backup ignoré");
    return { skipped: true };
  }

  if (mongoose.connection.readyState !== 1) {
    console.error("[BACKUP] MongoDB non connecté — backup annulé");
    return { error: "MongoDB non connecté" };
  }

  console.log(`[BACKUP] Démarrage backup ${dateStr}...`);
  const client = getR2Client();
  const results = [];

  for (const col of COLLECTIONS) {
    try {
      const result = await exportCollection(client, bucketName, dateStr, col);
      results.push(result);
      console.log(`[BACKUP] ✅ ${col} — ${result.count} documents`);
    } catch (err) {
      console.error(`[BACKUP] ❌ ${col} — ${err.message}`);
      results.push({ collection: col, error: err.message });
    }
  }

  const deleted = await cleanOldBackups(client, bucketName).catch(() => 0);
  const duration = Date.now() - start;

  console.log(`[BACKUP] Terminé en ${duration}ms — ${results.filter(r => !r.error).length}/${COLLECTIONS.length} collections OK — ${deleted} anciens fichiers supprimés`);

  return { date: dateStr, results, deleted, durationMs: duration };
}

module.exports = { runBackup };
