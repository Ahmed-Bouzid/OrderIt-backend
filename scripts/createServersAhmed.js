/**
 * Script pour créer 5 serveurs pour "Chez Ahmed"
 * Usage: cd backend && node scripts/createServersAhmed.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Server = require("../models/Server");

const RESTAURANT_ID = "686af511bb4cba684ff3b72e";

const servers = [
	{
		serverId: "SRV-AH01",
		name: "Karim Bensaïd",
		email: "karim@chezahmed.com",
		password: "Karim2026!",
		role: "server",
	},
	{
		serverId: "SRV-AH02",
		name: "Yasmine Laroui",
		email: "yasmine@chezahmed.com",
		password: "Yasmine2026!",
		role: "server",
	},
	{
		serverId: "SRV-AH03",
		name: "Mehdi Ouali",
		email: "mehdi@chezahmed.com",
		password: "Mehdi2026!",
		role: "server",
	},
	{
		serverId: "SRV-AH04",
		name: "Sofia Amrani",
		email: "sofia@chezahmed.com",
		password: "Sofia2026!",
		role: "server",
	},
	{
		serverId: "SRV-AH05",
		name: "Nabil Khelif",
		email: "nabil@chezahmed.com",
		password: "Nabil2026!",
		role: "server",
	},
];

async function main() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		for (const srv of servers) {
			// Vérifier si l'email ou le serverId existe déjà
			const existing = await Server.findOne({
				$or: [{ email: srv.email }, { serverId: srv.serverId }],
			});
			if (existing) {
				console.log(`⚠️  ${srv.name} existe déjà (${srv.email}) — ignoré`);
				continue;
			}

			const salt = await bcrypt.genSalt(12);
			const passwordHash = await bcrypt.hash(srv.password, salt);

			const newServer = new Server({
				restaurantId: RESTAURANT_ID,
				serverId: srv.serverId,
				name: srv.name,
				email: srv.email,
				passwordHash,
				authProvider: "local",
				role: srv.role,
			});

			await newServer.save();
			console.log(`✅ Créé: ${srv.name} (${srv.email})`);
		}

		console.log("\n🎉 Terminé !");
	} catch (err) {
		console.error("❌ Erreur:", err.message);
	} finally {
		await mongoose.connection.close();
		process.exit(0);
	}
}

main();
