const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "routes"); // adapte le chemin

// Middleware à chercher
const mustHaveMiddlewares = ["checkRoles"];

fs.readdir(routesDir, (err, files) => {
	if (err) {
		return console.error("Erreur lecture dossier routes:", err);
	}

	files.forEach((file) => {
		if (file.endsWith(".js")) {
			const content = fs.readFileSync(path.join(routesDir, file), "utf-8");

			// Regex pour trouver toutes les définitions de routes GET (ou POST etc.)
			const routeRegex = /router\.(get|post|put|delete)\(([^)]*)\)/g;
			let match;
			console.log(`\nFichier: ${file}`);

			while ((match = routeRegex.exec(content)) !== null) {
				const fullParams = match[2]; // ce qui est entre les parenthèses
				const routeType = match[1];

				// Vérifier la présence des middlewares dans les paramètres
				const hasAllMiddlewares = mustHaveMiddlewares.every((mw) =>
					fullParams.includes(mw)
				);

				console.log(
					`  Route ${routeType.toUpperCase()}: ${fullParams
						.split(",")[0]
						.trim()}`
				);
				console.log(
					`    - Middlewares présents ? ${
						hasAllMiddlewares ? "✅ Oui" : "❌ Non"
					}`
				);
			}
		}
	});
});
