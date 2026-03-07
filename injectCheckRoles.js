const fs = require("fs");
const path = require("path");

// Définition des rôles par fichier + route
const rules = [
	// ORDERS
	{
		file: "orders.js",
		method: "post",
		route: "/",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "get",
		route: "/:restaurantId",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "get",
		route: "/details/:orderId",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "get",
		route: "/table/:tableId",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "get",
		route: "/server/:serverId",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "put",
		route: "/:id",
		roles: ["server", "admin"],
	},
	{
		file: "orders.js",
		method: "delete",
		route: "/:orderId",
		roles: ["server", "admin"],
	},

	// PRODUCTS
	{
		file: "products.js",
		method: "post",
		route: "/restaurants/:restaurantId/products",
		roles: ["admin", "restaurant"],
	},
	{
		file: "products.js",
		method: "get",
		route: "/restaurants/:restaurantId/products",
		roles: ["admin", "restaurant"],
	},
	{
		file: "products.js",
		method: "put",
		route: "/products/:productId",
		roles: ["admin", "restaurant"],
	},
	{
		file: "products.js",
		method: "delete",
		route: "/products/:productId",
		roles: ["admin", "restaurant"],
	},

	// RESTAURANTS
	{ file: "restaurants.js", method: "post", route: "/", roles: ["admin"] },
	{
		file: "restaurants.js",
		method: "post",
		route: "/:id/server",
		roles: ["admin"],
	},
	{ file: "restaurants.js", method: "get", route: "/", roles: ["admin"] },
	{
		file: "restaurants.js",
		method: "get",
		route: "/:id/servers",
		roles: ["admin", "restaurant"],
	},
	{
		file: "restaurants.js",
		method: "get",
		route: "/:id",
		roles: ["admin", "restaurant"],
	},
	{ file: "restaurants.js", method: "put", route: "/:id", roles: ["admin"] },
	{ file: "restaurants.js", method: "delete", route: "/:id", roles: ["admin"] },

	// SERVERS
	{ file: "servers.js", method: "post", route: "/", roles: ["admin"] },
	{
		file: "servers.js",
		method: "get",
		route: "/:restaurantId",
		roles: ["admin"],
	},
	{ file: "servers.js", method: "put", route: "/:serverId", roles: ["admin"] },
	{
		file: "servers.js",
		method: "delete",
		route: "/:serverId",
		roles: ["admin"],
	},

	// TABLES
	{
		file: "tables.js",
		method: "post",
		route: "/",
		roles: ["admin", "restaurant"],
	},
	{
		file: "tables.js",
		method: "get",
		route: "/restaurant/:restaurantId",
		roles: ["admin", "restaurant"],
	},
	{
		file: "tables.js",
		method: "put",
		route: "/:id",
		roles: ["admin", "restaurant"],
	},
	{
		file: "tables.js",
		method: "delete",
		route: "/:id",
		roles: ["admin", "restaurant"],
	},
];

function injectMiddlewareInFile(filePath, method, route, roles) {
	let content = fs.readFileSync(filePath, "utf-8");

	// Regex pour trouver la route
	// Ex: router.post("/", auth, async (req, res) => { ...
	const regex = new RegExp(
		`(router\\.${method}\\(['"\`]${route}['"\`],)([^)]*)\\)`,
		"g"
	);

	content = content.replace(regex, (match, p1, p2) => {
		// Si checkRoles déjà présent, on ne touche pas
		if (p2.includes("checkRoles")) {
			return match;
		}

		// Si auth présent, on ajoute après auth
		if (p2.includes("auth")) {
			const newMiddlewares = p2.replace(
				/auth/,
				`auth, checkRoles(${JSON.stringify(roles)})`
			);
			return `${p1}${newMiddlewares})`;
		} else {
			// Sinon, on insère auth + checkRoles
			return `${p1}auth, checkRoles(${JSON.stringify(roles)}), ${p2})`;
		}
	});

	fs.writeFileSync(filePath, content, "utf-8");
}

// Exemple d'exécution
for (const rule of rules) {
	const filePath = path.join(__dirname, "routes", rule.file);
	injectMiddlewareInFile(filePath, rule.method, rule.route, rule.roles);
}
