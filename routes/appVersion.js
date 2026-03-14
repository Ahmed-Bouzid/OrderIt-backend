const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

const APK_DIR = path.join(__dirname, "..", "public", "apk");

// GET /api/app/version
// Retourne la version courante + URL de téléchargement
router.get("/version", (req, res) => {
	const version = process.env.APP_VERSION || "1.0.0";
	const baseUrl = process.env.APP_BASE_URL || "https://orderit-backend-6y1m.onrender.com";

	res.json({
		version,
		apkUrl: `${baseUrl}/api/app/download`,
		releaseNotes: process.env.APP_RELEASE_NOTES || "",
		updatedAt: new Date().toISOString(),
	});
});

// GET /api/app/download
// Sert le fichier APK (aucune auth requise pour permettre l'installation)
router.get("/download", (req, res) => {
	const apkFilename = process.env.APK_FILENAME || "orderit-latest.apk";
	const apkPath = path.join(APK_DIR, apkFilename);

	if (!fs.existsSync(apkPath)) {
		return res.status(404).json({ message: "APK non disponible pour le moment." });
	}

	const stat = fs.statSync(apkPath);
	res.setHeader("Content-Type", "application/vnd.android.package-archive");
	res.setHeader("Content-Disposition", `attachment; filename="${apkFilename}"`);
	res.setHeader("Content-Length", stat.size);
	res.setHeader("Cache-Control", "no-cache");

	fs.createReadStream(apkPath).pipe(res);
});

module.exports = router;
