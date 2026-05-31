/**
 * ⭐ BLOC4 — Structured Logger Middleware
 * Logs critiques : qui, quand, table, résultat, durée
 * Couvre : POST /orders, POST /reservations/client/*, PATCH /orders/:id/cancel,
 *           POST /tables/:id/reset, POST /client/token
 */

const CRITICAL_PATTERNS = [
	{ method: "POST",  path: /^\/orders$/ },
	{ method: "POST",  path: /^\/reservations\/client\/reservations/ },
	{ method: "POST",  path: /^\/reservations\/client\/reservations\/resume$/ },
	{ method: "PATCH", path: /^\/orders\/[^/]+\/cancel$/ },
	{ method: "PATCH", path: /^\/orders\/[^/]+\/mark-as-paid$/ },
	{ method: "POST",  path: /^\/tables\/[^/]+\/reset$/ },
	{ method: "POST",  path: /^\/client\/token$/ },
	{ method: "PUT",   path: /^\/reservations\/[^/]+\/payment$/ },
];

function matches(method, path) {
	return CRITICAL_PATTERNS.some(
		(p) => p.method === method && p.path.test(path),
	);
}

function structuredLogger(req, res, next) {
	if (!matches(req.method, req.path)) return next();

	const startAt = Date.now();
	const originalJson = res.json.bind(res);

	res.json = function (body) {
		const ms = Date.now() - startAt;
		const user = req.user || {};
		const entry = {
			ts: new Date().toISOString(),
			method: req.method,
			path: req.path,
			status: res.statusCode,
			ms,
			role: user.role || "anon",
			userId: user.userId || user.serverId || user.clientId || null,
			restaurantId: user.restaurantId || req.body?.restaurantId || null,
			tableId: user.tableId || req.body?.tableId || null,
			ip: req.ip,
		};

		if (res.statusCode >= 500) {
			console.error("[CRITICAL]", JSON.stringify(entry));
		} else if (res.statusCode >= 400) {
			console.warn("[WARN]", JSON.stringify(entry));
		} else {
			console.log("[LOG]", JSON.stringify(entry));
		}

		return originalJson(body);
	};

	next();
}

module.exports = structuredLogger;
