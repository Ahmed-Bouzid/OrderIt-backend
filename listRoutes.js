const fs = require("fs");
const path = require("path");

const ROUTES_DIR = path.join(__dirname, "routes");

const routeRegex =
	/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,([\s\S]*?)\)/g;
const middlewareRegex = /(auth|checkRoles\([^)]*\))/g;

async function listRoutes() {
	const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".js"));

	for (const file of files) {
		const content = fs.readFileSync(path.join(ROUTES_DIR, file), "utf-8");
		let match;
		console.log(`\nFichier: ${file}`);
		while ((match = routeRegex.exec(content)) !== null) {
			const method = match[1].toUpperCase();
			const routePath = match[2];
			const middlewaresRaw = match[3];
			const middlewares = middlewaresRaw.match(middlewareRegex) || [];
			const middlewaresClean =
				middlewares.map((mw) => mw.trim()).join(", ") || "Aucun";
			console.log(`  Route ${method}: "${routePath}"`);
			console.log(`    - Middlewares présents ? ${middlewaresClean}`);
		}
	}
}

listRoutes();
