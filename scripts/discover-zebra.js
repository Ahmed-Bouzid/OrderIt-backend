#!/usr/bin/env node
/**
 * discover-zebra.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Scanne le réseau local pour trouver l'imprimante Zebra (port 9100).
 *
 * USAGE :
 *   node scripts/discover-zebra.js
 *   node scripts/discover-zebra.js 192.168.0.0/24   (subnet explicite)
 *   node scripts/discover-zebra.js 10.0.1.0/24
 *
 * Ce que le script fait :
 *   1. Détecte automatiquement le subnet local (interfaces réseau actives)
 *   2. Scanne toutes les IPs /24 en parallèle (timeout 500ms par IP)
 *   3. Sur connexion réussie au port 9100 : envoie une requête de statut Zebra
 *   4. Affiche les imprimantes trouvées avec leur réponse
 *
 * RÉSULTAT ATTENDU :
 *   ✅  192.168.1.42:9100  → ZEBRA ZD220 (ou réponse ESC/POS)
 *
 * Une fois l'IP trouvée, ajoute dans backend/.env :
 *   ZEBRA_IP=192.168.1.42
 *   ZEBRA_PORT=9100
 *   ZEBRA_MODE=zpl   (ou escpos)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const net = require("net");
const os = require("os");

// ── Configuration ──────────────────────────────────────────────────────────────
const TARGET_PORT = 9100;
const CONNECT_TIMEOUT_MS = 500;
const CONCURRENCY = 50; // Connexions parallèles max
const STATUS_QUERY_ZPL = Buffer.from("~HS\r\n"); // Host Status Tracking ZPL
const STATUS_QUERY_ESC = Buffer.from([0x10, 0x04, 0x01]); // DLE EOT 1 — ESC/POS status

// ── Détection automatique du subnet ───────────────────────────────────────────

function getLocalSubnets() {
	const subnets = new Set();
	const ifaces = os.networkInterfaces();

	for (const [name, addrs] of Object.entries(ifaces)) {
		for (const addr of addrs) {
			// IPv4 uniquement, pas loopback
			if (addr.family === "IPv4" && !addr.internal) {
				const parts = addr.address.split(".");
				const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
				subnets.add(subnet);
				console.log(`  Interface ${name} → ${addr.address} (subnet ${subnet}.0/24)`);
			}
		}
	}
	return [...subnets];
}

// ── Génération des IPs d'un /24 ───────────────────────────────────────────────

function generateIPs(subnet) {
	const ips = [];
	for (let i = 1; i <= 254; i++) {
		ips.push(`${subnet}.${i}`);
	}
	return ips;
}

// ── Test connexion TCP sur port 9100 ──────────────────────────────────────────

function probeIP(ip) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let responded = false;
		let responseData = "";

		socket.setTimeout(CONNECT_TIMEOUT_MS);

		socket.connect(TARGET_PORT, ip, () => {
			// Connexion réussie — envoyer la requête de statut ZPL
			socket.write(STATUS_QUERY_ZPL);
			socket.write(STATUS_QUERY_ESC);

			// Attendre un peu la réponse
			setTimeout(() => {
				socket.destroy();
				if (!responded) {
					responded = true;
					resolve({ ip, open: true, response: responseData || "(no response — raw mode)" });
				}
			}, 300);
		});

		socket.on("data", (data) => {
			responseData += data.toString("latin1").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "·");
		});

		socket.on("timeout", () => {
			socket.destroy();
			if (!responded) {
				responded = true;
				resolve({ ip, open: false });
			}
		});

		socket.on("error", () => {
			socket.destroy();
			if (!responded) {
				responded = true;
				resolve({ ip, open: false });
			}
		});
	});
}

// ── Scan en parallèle avec concurrence limitée ────────────────────────────────

async function scanChunk(ips) {
	return Promise.all(ips.map((ip) => probeIP(ip)));
}

async function scanSubnet(subnet) {
	const ips = generateIPs(subnet);
	const results = [];
	process.stdout.write(`  Scanning ${subnet}.1–254`);

	for (let i = 0; i < ips.length; i += CONCURRENCY) {
		const chunk = ips.slice(i, i + CONCURRENCY);
		const chunkResults = await scanChunk(chunk);
		results.push(...chunkResults);
		process.stdout.write(".");
	}

	console.log(" done.");
	return results.filter((r) => r.open);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	console.log("\n╔══════════════════════════════════════════════════╗");
	console.log("║         ZEBRA PRINTER DISCOVERY — port 9100      ║");
	console.log("╚══════════════════════════════════════════════════╝\n");

	// Subnet depuis argument CLI ou auto-détecté
	let subnets;
	if (process.argv[2]) {
		const cidr = process.argv[2];
		const subnet = cidr.replace(/\.0\/\d+$/, "").replace(/\/\d+$/, "");
		subnets = [subnet];
		console.log(`  Subnet fourni : ${cidr}\n`);
	} else {
		console.log("  Interfaces réseau actives :");
		subnets = getLocalSubnets();
		console.log();
	}

	if (subnets.length === 0) {
		console.error("  ❌ Aucune interface réseau IPv4 active trouvée.");
		process.exit(1);
	}

	const found = [];
	for (const subnet of subnets) {
		const results = await scanSubnet(subnet);
		found.push(...results);
	}

	console.log("\n──────────────────────────────────────────────────────");
	if (found.length === 0) {
		console.log("  ❌ Aucune imprimante trouvée sur port 9100.\n");
		console.log("  Vérifier :");
		console.log("    - L'imprimante est allumée et branchée en RJ45");
		console.log("    - Le câble réseau est bien connecté au switch/routeur");
		console.log("    - L'imprimante et le Mac sont sur le même réseau");
		console.log("    - Le port 9100 est actif (imprimer la config : tenir bouton feed)");
	} else {
		console.log(`  ✅ ${found.length} appareil(s) trouvé(s) sur port 9100 :\n`);
		for (const r of found) {
			console.log(`  ┌─ IP : ${r.ip}:${TARGET_PORT}`);
			console.log(`  │  Réponse : ${r.response}`);
			console.log(`  └─ → Ajouter dans backend/.env :`);
			console.log(`       ZEBRA_IP=${r.ip}`);
			console.log(`       ZEBRA_PORT=${TARGET_PORT}`);
			console.log(`       ZEBRA_MODE=zpl`);
			console.log();
		}
	}
	console.log("──────────────────────────────────────────────────────\n");
}

main().catch((err) => {
	console.error("Erreur fatale :", err);
	process.exit(1);
});
