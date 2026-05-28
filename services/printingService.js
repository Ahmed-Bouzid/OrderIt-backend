/**
 * printingService.js
 * Génère un ticket ESC/POS et l'envoie à l'imprimante GEZHI_micro_printer via CUPS.
 * Uniquement utilisé pour le restaurant Chez Ahmed (686af511bb4cba684ff3b72e).
 *
 * Protocole : ESC/POS, papier 58mm (~32 caractères de large)
 * Commande CUPS : lp -d GEZHI_micro_printer -o raw ticket.bin
 *
 * ── Mode réseau (TCP/IP) ──────────────────────────────────────────────────────
 * Pour les imprimantes en réseau (mode Comptoir), utiliser printTicketOverNetwork().
 * Configurer l'IP dans la variable d'env PRINTER_IP (ex: PRINTER_IP=192.168.1.100)
 * Le port par défaut est 9100 (port ESC/POS standard).
 */

const fs = require("fs");
const path = require("path");
const net = require("net");
const { exec } = require("child_process");
const os = require("os");

// ── Commandes ESC/POS ──────────────────────────────────────────────────────────
const INIT = Buffer.from([0x1b, 0x40]); // Initialise l'imprimante
const ALIGN_LEFT = Buffer.from([0x1b, 0x61, 0x00]); // Aligné à gauche
const ALIGN_CENTER = Buffer.from([0x1b, 0x61, 0x01]); // Centré
const BOLD_ON = Buffer.from([0x1b, 0x45, 0x01]); // Gras activé
const BOLD_OFF = Buffer.from([0x1b, 0x45, 0x00]); // Gras désactivé
const FEED = Buffer.from([0x0a]); // Saut de ligne
const CUT = Buffer.from([0x1d, 0x56, 0x01]); // Coupe partielle

const WIDTH = 32; // Largeur maximale en caractères (58mm ≈ 32 chars)
const DIVIDER = "-".repeat(WIDTH);
const DOUBLE_DIVIDER = "=".repeat(WIDTH);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convertit une chaîne en Buffer avec retour à la ligne */
function txt(str) {
	return Buffer.from(str + "\n", "utf8");
}

/**
 * Construit une ligne "gauche … droite" sur WIDTH caractères.
 * Ex: padLine("2x Burger", "9.90 EUR", 32) → "2x Burger          9.90 EUR"
 */
function padLine(left, right, width) {
	const total = left.length + right.length;
	if (total >= width) {
		// Tronque le texte gauche si trop long
		const maxLeft = width - right.length - 1;
		return left.substring(0, maxLeft) + " " + right;
	}
	return left + " ".repeat(width - total) + right;
}

// ── Génération du ticket ───────────────────────────────────────────────────────

/**
 * Génère un Buffer ESC/POS complet pour la commande.
 * @param {object} params
 * @param {string|number} params.tableNumber   - Numéro de table
 * @param {Array}         params.items         - [{name, quantity, price}]
 * @param {number}        params.total         - Total de la commande
 * @param {string}        [params.note]        - Note optionnelle
 */
function generateTicket({ tableNumber, items, total, note }) {
	const now = new Date();
	const time = now.toLocaleTimeString("fr-FR", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const date = now.toLocaleDateString("fr-FR");

	const parts = [
		INIT,

		// ── En-tête ───────────────────────────────────────────────────────────────
		ALIGN_CENTER,
		BOLD_ON,
		txt("  BON DE COMMANDE  "),
		BOLD_OFF,
		txt(DOUBLE_DIVIDER),

		// ── Infos table & heure ───────────────────────────────────────────────────
		ALIGN_LEFT,
		BOLD_ON,
		txt(`Table : ${tableNumber}`),
		BOLD_OFF,
		txt(`${date}   ${time}`),
	];

	// Note éventuelle
	if (note && note.trim()) {
		parts.push(txt(`Note : ${note.trim()}`));
	}

	parts.push(txt(DIVIDER));

	// ── Articles ───────────────────────────────────────────────────────────────
	for (const item of items) {
		const qty = `${item.quantity}x`;
		const name = (item.name || "Produit").substring(0, 20);
		const prix =
			item.price != null ? `${(item.price * item.quantity).toFixed(2)}EUR` : "";
		parts.push(txt(padLine(`${qty} ${name}`, prix, WIDTH)));
	}

	// ── Pied ───────────────────────────────────────────────────────────────────
	parts.push(
		txt(DIVIDER),
		BOLD_ON,
		txt(padLine("TOTAL", `${Number(total).toFixed(2)} EUR`, WIDTH)),
		BOLD_OFF,
		txt(DOUBLE_DIVIDER),
		FEED,
		FEED,
		FEED,
		CUT,
	);

	return Buffer.concat(parts);
}

// ── Impression ─────────────────────────────────────────────────────────────────

/**
 * Génère le ticket ESC/POS, l'écrit dans /tmp/ticket.bin,
 * puis envoie à l'imprimante via `lp -d GEZHI_micro_printer -o raw`.
 *
 * @param {object} params - Mêmes paramètres que generateTicket()
 * @returns {Promise<{success: boolean, stdout: string}>}
 */
async function printTicket({ tableNumber, items, total, note }) {
	const buffer = generateTicket({ tableNumber, items, total, note });
	const ticketPath = path.join(os.tmpdir(), "ticket.bin");

	await fs.promises.writeFile(ticketPath, buffer);
	console.log(`[PRINT] Ticket écrit : ${ticketPath} (${buffer.length} bytes)`);

	return new Promise((resolve, reject) => {
		exec(
			`lp -d GEZHI_micro_printer -o raw "${ticketPath}"`,
			(error, stdout, stderr) => {
				if (error) {
					console.error("[PRINT] Erreur impression :", error.message, stderr);
					return reject(new Error(stderr || error.message));
				}
				console.log("[PRINT] Ticket envoyé :", stdout.trim());
				resolve({ success: true, stdout: stdout.trim() });
			},
		);
	});
}

module.exports = { printTicket, generateTicket, printTicketOverNetwork, printCounterOrder };

// ── Configuration imprimante réseau ───────────────────────────────────────────
// IP à configurer dans les variables d'env : PRINTER_IP=192.168.x.x
// Port ESC/POS standard : 9100
const COUNTER_PRINTER_IP = process.env.PRINTER_IP || null;
const COUNTER_PRINTER_PORT = parseInt(process.env.PRINTER_PORT || "9100", 10);

/**
 * Envoie un ticket ESC/POS directement à une imprimante réseau via TCP (port 9100).
 * Protocole raw ESC/POS — pas besoin de CUPS ni de driver.
 *
 * @param {Buffer} ticketBuffer - Buffer ESC/POS généré par generateTicket()
 * @param {string} [printerIp]  - IP de l'imprimante (défaut : PRINTER_IP env)
 * @param {number} [printerPort] - Port TCP (défaut : 9100)
 * @returns {Promise<{success: boolean}>}
 */
function printTicketOverNetwork(ticketBuffer, printerIp, printerPort = 9100) {
	const ip = printerIp || COUNTER_PRINTER_IP;
	const port = printerPort || COUNTER_PRINTER_PORT;

	if (!ip) {
		console.warn("[PRINT] PRINTER_IP non configuré — impression réseau ignorée");
		return Promise.resolve({ success: false, reason: "no_ip" });
	}

	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		const timeout = 5000; // 5 secondes max

		socket.setTimeout(timeout);

		socket.connect(port, ip, () => {
			socket.write(ticketBuffer, () => {
				socket.destroy();
				console.log(`[PRINT] Ticket envoyé via TCP → ${ip}:${port}`);
				resolve({ success: true });
			});
		});

		socket.on("timeout", () => {
			socket.destroy();
			console.error(`[PRINT] Timeout connexion → ${ip}:${port}`);
			reject(new Error(`Printer timeout: ${ip}:${port}`));
		});

		socket.on("error", (err) => {
			socket.destroy();
			console.error(`[PRINT] Erreur TCP → ${ip}:${port} :`, err.message);
			reject(err);
		});
	});
}

/**
 * Point d'entrée principal pour le mode Comptoir.
 * Génère le ticket ESC/POS et l'envoie via TCP à l'imprimante réseau.
 *
 * @param {object} params - { tableNumber, items, total, note }
 * @param {string} [printerIp] - IP optionnelle (sinon utilise PRINTER_IP env)
 */
async function printCounterOrder(params, printerIp) {
	const buffer = generateTicket(params);
	return printTicketOverNetwork(buffer, printerIp);
}
