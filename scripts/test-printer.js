#!/usr/bin/env node
/**
 * test-printer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de test complet pour la NEPI IRT-280 (ESC/POS 80mm, réseau TCP:9100)
 *
 * USAGE :
 *   # Étape 1 — Trouver l'IP de l'imprimante
 *   node scripts/discover-zebra.js
 *
 *   # Étape 2 — Tester la connexion + imprimer un ticket de test
 *   node scripts/test-printer.js 192.168.1.42
 *
 *   # Avec port personnalisé (défaut 9100)
 *   node scripts/test-printer.js 192.168.1.42 9100
 *
 * Ce que le script fait (dans l'ordre) :
 *   1. Ping TCP → vérifie que le port 9100 répond
 *   2. Envoie ESC/POS INIT → vérifie que l'imprimante accepte les données
 *   3. Imprime un ticket de test avec tous les éléments visuels
 *   4. Affiche le diagnostic complet
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const net = require("net");
const path = require("path");

// ── Paramètres CLI ─────────────────────────────────────────────────────────────
const IP   = process.argv[2];
const PORT = parseInt(process.argv[3] || "9100", 10);

if (!IP) {
	console.error("\n  Usage : node scripts/test-printer.js <IP> [PORT]");
	console.error("  Ex    : node scripts/test-printer.js 192.168.1.42\n");
	console.error("  Si vous ne connaissez pas l'IP :");
	console.error("    node scripts/discover-zebra.js\n");
	process.exit(1);
}

// ── Commandes ESC/POS ──────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

const CMD = {
	INIT         : Buffer.from([ESC, 0x40]),
	ALIGN_LEFT   : Buffer.from([ESC, 0x61, 0x00]),
	ALIGN_CENTER : Buffer.from([ESC, 0x61, 0x01]),
	ALIGN_RIGHT  : Buffer.from([ESC, 0x61, 0x02]),
	BOLD_ON      : Buffer.from([ESC, 0x45, 0x01]),
	BOLD_OFF     : Buffer.from([ESC, 0x45, 0x00]),
	DOUBLE_WIDTH : Buffer.from([ESC, 0x21, 0x20]),  // Double largeur
	NORMAL_SIZE  : Buffer.from([ESC, 0x21, 0x00]),  // Taille normale
	FEED_3       : Buffer.from([ESC, 0x64, 0x03]),  // Avance 3 lignes
	CUT_PARTIAL  : Buffer.from([GS,  0x56, 0x01]),  // Coupe partielle
	CUT_FULL     : Buffer.from([GS,  0x56, 0x00]),  // Coupe complète
};

const WIDTH = 42; // 80mm ≈ 42 chars

function txt(str) {
	return Buffer.from(str + "\n", "utf8");
}

function divider(char = "-") {
	return txt(char.repeat(WIDTH));
}

function padLine(left, right) {
	const total = left.length + right.length;
	if (total >= WIDTH) {
		return left.substring(0, WIDTH - right.length - 1) + " " + right;
	}
	return left + " ".repeat(WIDTH - total) + right;
}

// ── Génération du ticket de test ───────────────────────────────────────────────

function buildTestTicket() {
	const now   = new Date();
	const time  = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	const date  = now.toLocaleDateString("fr-FR");

	const parts = [
		CMD.INIT,

		// ── En-tête ────────────────────────────────────────────────────────
		CMD.ALIGN_CENTER,
		CMD.BOLD_ON,
		CMD.DOUBLE_WIDTH,
		txt("  TEST IMPRESSION  "),
		CMD.NORMAL_SIZE,
		CMD.BOLD_OFF,
		divider("="),

		// ── Infos imprimante ───────────────────────────────────────────────
		txt("Modele : NEPI IRT-280"),
		txt("Papier : 80mm  |  Port : 9100"),
		txt(`IP     : ${IP}`),
		txt(`Date   : ${date}   ${time}`),
		divider(),

		// ── Articles de test ───────────────────────────────────────────────
		CMD.ALIGN_LEFT,
		CMD.BOLD_ON,
		txt("ARTICLES :"),
		CMD.BOLD_OFF,
		txt(padLine("1x Coca Cola (33cl)", "2.50 EUR")),
		txt(padLine("2x Eau plate", "3.00 EUR")),
		txt(padLine("1x Burger Classic (menu)", "12.90 EUR")),
		txt(padLine("1x Cafe expresso", "1.80 EUR")),
		divider(),

		// ── Total ──────────────────────────────────────────────────────────
		CMD.BOLD_ON,
		txt(padLine("TOTAL", "20.20 EUR")),
		CMD.BOLD_OFF,

		// ── Note ──────────────────────────────────────────────────────────
		txt("Note : Table de test — pas sans gluten"),
		divider("="),

		// ── Pied de page ───────────────────────────────────────────────────
		CMD.ALIGN_CENTER,
		txt(""),
		txt("Connexion reseau OK"),
		CMD.BOLD_ON,
		txt("IMPRESSION REUSSIE"),
		CMD.BOLD_OFF,
		txt(""),
		txt("OrderIt — orderit.fr"),
		txt(""),

		// ── Coupe ──────────────────────────────────────────────────────────
		CMD.FEED_3,
		CMD.CUT_PARTIAL,
	];

	return Buffer.concat(parts);
}

// ── Envoi TCP ─────────────────────────────────────────────────────────────────

function sendToprinter(buffer, ip, port) {
	return new Promise((resolve, reject) => {
		const socket  = new net.Socket();
		const timeout = 5000;

		socket.setTimeout(timeout);

		socket.connect(port, ip, () => {
			console.log(`  ✅ Connexion TCP établie → ${ip}:${port}`);
			socket.write(buffer, () => {
				console.log(`  ✅ Données envoyées (${buffer.length} bytes)`);
				// Attendre un peu avant de fermer pour que l'imprimante absorbe les données
				setTimeout(() => {
					socket.destroy();
					resolve({ success: true, bytes: buffer.length });
				}, 500);
			});
		});

		socket.on("timeout", () => {
			socket.destroy();
			reject(new Error(`Timeout (${timeout}ms) — imprimante ne répond pas`));
		});

		socket.on("error", (err) => {
			socket.destroy();
			reject(err);
		});
	});
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	console.log("\n╔══════════════════════════════════════════════════════╗");
	console.log("║         NEPI IRT-280 — TEST D'IMPRESSION             ║");
	console.log("╚══════════════════════════════════════════════════════╝\n");

	console.log(`  Cible  : ${IP}:${PORT}`);
	console.log(`  Proto  : ESC/POS raw TCP`);
	console.log(`  Papier : 80mm (42 chars)\n`);

	console.log("  [1/2] Connexion TCP...");

	try {
		const ticket = buildTestTicket();
		console.log(`  [2/2] Envoi du ticket (${ticket.length} bytes)...`);

		await sendToprinter(ticket, IP, PORT);

		console.log("\n──────────────────────────────────────────────────────");
		console.log("  ✅ TEST RÉUSSI — Le ticket doit être sorti\n");
		console.log("  Prochaine étape :");
		console.log("    Ajouter dans backend/.env :");
		console.log(`      PRINTER_IP=${IP}`);
		console.log(`      PRINTER_PORT=${PORT}`);
		console.log("      PRINTER_MODE=network");
		console.log("\n  Puis démarrer le daemon :");
		console.log("    node src/printDaemon.js\n");
		console.log("──────────────────────────────────────────────────────\n");

	} catch (err) {
		console.error("\n──────────────────────────────────────────────────────");
		console.error("  ❌ ÉCHEC\n");
		console.error(`  Erreur : ${err.message}\n`);
		console.error("  Vérifier :");
		console.error("    1. L'imprimante est allumée (LED verte stable)");
		console.error("    2. Le câble RJ45 est branché sur l'imprimante ET le routeur");
		console.error("    3. L'IP est correcte → relancer : node scripts/discover-zebra.js");
		console.error("    4. L'imprimante et le Mac sont sur le même réseau (192.168.1.x)");
		console.error("    5. Imprimer la config réseau : tenir le bouton FEED 3s au démarrage");
		console.error("──────────────────────────────────────────────────────\n");
		process.exit(1);
	}
}

main();
