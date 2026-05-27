const express    = require("express");
const router     = express.Router();
const auth       = require("../middlewares/auth");
const checkRoles = require("../middlewares/checkRoles");
const ZReport    = require("../models/ZReport");
const { computeZ, generateZ } = require("../services/zReportService");

// ═══════════════════════════════════════════════════════════════════════
// GET /z-reports/preview
// Calcule les chiffres du Z sans sauvegarder (prévisualisation manager)
// Role : admin uniquement
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/preview",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const { restaurantId, from, to } = req.query;

			if (!restaurantId || !from || !to) {
				return res.status(400).json({
					success: false,
					message: "restaurantId, from et to sont requis",
				});
			}

			const periodStart = new Date(from);
			const periodEnd   = new Date(to);

			if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
				return res.status(400).json({
					success: false,
					message: "Dates invalides (format ISO 8601 attendu)",
				});
			}

			if (periodStart >= periodEnd) {
				return res.status(400).json({
					success: false,
					message: "periodStart doit être antérieur à periodEnd",
				});
			}

			const data = await computeZ({ restaurantId, periodStart, periodEnd });
			return res.json({ success: true, data });
		} catch (err) {
			console.error("[ZReport] Erreur preview:", err);
			return res.status(500).json({ success: false, message: "Erreur serveur" });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════
// POST /z-reports/generate
// Génère et scelle le Z de caisse (irréversible)
// Role : admin uniquement
// Body : { restaurantId, periodStart, periodEnd, openingFloatCents, closingCountCents, notes? }
// ═══════════════════════════════════════════════════════════════════════
router.post(
	"/generate",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const {
				restaurantId,
				periodStart,
				periodEnd,
				openingFloatCents,
				closingCountCents,
				notes,
			} = req.body;

			// ── Validation des champs obligatoires ────────────────────────
			if (!restaurantId || !periodStart || !periodEnd) {
				return res.status(400).json({
					success: false,
					message: "restaurantId, periodStart et periodEnd sont requis",
				});
			}

			if (closingCountCents === undefined || closingCountCents === null) {
				return res.status(400).json({
					success: false,
					message: "closingCountCents est requis (espèces comptées en centimes)",
				});
			}

			if (typeof closingCountCents !== "number" || closingCountCents < 0) {
				return res.status(400).json({
					success: false,
					message: "closingCountCents doit être un entier positif ou nul",
				});
			}

			const generatedBy = req.user.id;

			const z = await generateZ({
				restaurantId,
				periodStart,
				periodEnd,
				openingFloatCents: openingFloatCents ?? 0,
				closingCountCents,
				generatedBy,
				notes: notes ?? "",
			});

			return res.status(201).json({ success: true, data: z });
		} catch (err) {
			console.error("[ZReport] Erreur génération:", err);
			return res.status(500).json({ success: false, message: "Erreur serveur" });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════
// GET /z-reports
// Liste des Z d'un restaurant, du plus récent au plus ancien
// Role : admin uniquement
// Query : ?restaurantId=xxx&page=1&limit=20
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const { restaurantId, page = 1, limit = 20 } = req.query;

			if (!restaurantId) {
				return res.status(400).json({
					success: false,
					message: "restaurantId est requis",
				});
			}

			const pageNum  = Math.max(1, parseInt(page, 10));
			const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
			const skip     = (pageNum - 1) * limitNum;

			const [reports, total] = await Promise.all([
				ZReport.find({ restaurantId })
					.sort({ sequenceNumber: -1 })
					.skip(skip)
					.limit(limitNum)
					.populate("generatedBy", "name email")
					.lean(),
				ZReport.countDocuments({ restaurantId }),
			]);

			return res.json({
				success: true,
				data: reports,
				meta: {
					total,
					page: pageNum,
					limit: limitNum,
					hasMore: skip + reports.length < total,
				},
			});
		} catch (err) {
			console.error("[ZReport] Erreur liste:", err);
			return res.status(500).json({ success: false, message: "Erreur serveur" });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════
// GET /z-reports/:id
// Détail complet d'un Z
// Role : admin uniquement
// ═══════════════════════════════════════════════════════════════════════
router.get(
	"/:id",
	auth,
	checkRoles(["admin"]),
	async (req, res) => {
		try {
			const z = await ZReport.findById(req.params.id)
				.populate("generatedBy", "name email")
				.lean();

			if (!z) {
				return res.status(404).json({
					success: false,
					message: "Z introuvable",
				});
			}

			// S'assurer que le Z appartient au bon restaurant
			if (String(z.restaurantId) !== String(req.query.restaurantId || z.restaurantId)) {
				return res.status(403).json({
					success: false,
					message: "Accès refusé",
				});
			}

			return res.json({ success: true, data: z });
		} catch (err) {
			console.error("[ZReport] Erreur détail:", err);
			return res.status(500).json({ success: false, message: "Erreur serveur" });
		}
	},
);

// ═══════════════════════════════════════════════════════════════════════
// Interdire DELETE et PATCH sur cette ressource (immuabilité)
// ═══════════════════════════════════════════════════════════════════════
router.delete("/:id", (_req, res) =>
	res.status(405).json({ success: false, message: "Suppression d'un Z interdite" }),
);
router.patch("/:id", (_req, res) =>
	res.status(405).json({ success: false, message: "Modification d'un Z interdite" }),
);
router.put("/:id", (_req, res) =>
	res.status(405).json({ success: false, message: "Modification d'un Z interdite" }),
);

module.exports = router;
