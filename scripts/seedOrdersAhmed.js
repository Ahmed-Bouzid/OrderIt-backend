/**
 * Script pour créer 2 commandes par réservation pour "Chez Ahmed"
 * Commande 1 = Entrées + Boissons, Commande 2 = Plats + Desserts
 * Usage: cd backend && node scripts/seedOrdersAhmed.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");

const RESTAURANT_ID = "686af511bb4cba684ff3b72e";

// Produits
const P = {
	// Boissons
	eauPet:    { id: "68c9d81189ee999ff0ac4435", name: "Eau pétillante", price: 2, category: "boisson" },
	jus:       { id: "68c9d81189ee999ff0ac4436", name: "Jus d'orange frais", price: 3, category: "boisson" },
	cafe:      { id: "68c9d81189ee999ff0ac4437", name: "Café expresso", price: 2.5, category: "boisson" },
	the:       { id: "68c9d81189ee999ff0ac4438", name: "Thé Earl Grey", price: 2.5, category: "boisson" },
	cappuccino:{ id: "68c9d81189ee999ff0ac4439", name: "Cappuccino", price: 3.5, category: "boisson" },
	limonade:  { id: "68c9d81189ee999ff0ac443a", name: "Limonade maison", price: 3, category: "boisson" },
	vinRouge:  { id: "68c9d81189ee999ff0ac443d", name: "Vin rouge maison", price: 5, category: "boisson" },
	vinBlanc:  { id: "68c9d81189ee999ff0ac443e", name: "Vin blanc sec", price: 5, category: "boisson" },
	smoothie:  { id: "68c9d81189ee999ff0ac443c", name: "Smoothie fraise-banane", price: 4, category: "boisson" },
	chocolat:  { id: "68c9d81189ee999ff0ac443b", name: "Chocolat chaud", price: 3, category: "boisson" },
	// Entrées
	chevre:    { id: "68c9d81189ee999ff0ac443f", name: "Salade de chèvre chaud", price: 7.5, category: "entrée" },
	soupe:     { id: "68c9d81189ee999ff0ac4440", name: "Soupe à l'oignon", price: 6, category: "entrée" },
	foieGras:  { id: "68c9d81189ee999ff0ac4441", name: "Terrine de foie gras", price: 12, category: "entrée" },
	charcut:   { id: "68c9d81189ee999ff0ac4442", name: "Assiette de charcuterie", price: 8, category: "entrée" },
	nicoise:   { id: "68c9d81189ee999ff0ac4443", name: "Salade Niçoise", price: 9, category: "entrée" },
	// Plats
	boeuf:     { id: "68c9d81189ee999ff0ac4444", name: "Boeuf Bourguignon", price: 18, category: "plat" },
	coq:       { id: "68c9d81189ee999ff0ac4445", name: "Coq au Vin", price: 17, category: "plat" },
	gratin:    { id: "68c9d81189ee999ff0ac4446", name: "Gratin Dauphinois", price: 12, category: "plat" },
	saumon:    { id: "68c9d81189ee999ff0ac4447", name: "Filet de Saumon à l'Aneth", price: 16, category: "plat" },
	ratatouille:{ id: "68c9d81189ee999ff0ac4448", name: "Ratatouille", price: 13, category: "plat" },
	canard:    { id: "68c9d81189ee999ff0ac4449", name: "Confit de Canard", price: 20, category: "plat" },
	quiche:    { id: "68c9d81189ee999ff0ac444a", name: "Quiche Lorraine", price: 11, category: "plat" },
	steak:     { id: "68c9d81189ee999ff0ac444b", name: "Steak Frites", price: 15, category: "plat" },
	poulet:    { id: "68c9d81189ee999ff0ac444c", name: "Poulet Rôti", price: 14, category: "plat" },
	cassoulet: { id: "68c9d81189ee999ff0ac444d", name: "Cassoulet", price: 19, category: "plat" },
	// Desserts
	creme:     { id: "68c9d81189ee999ff0ac444e", name: "Crème Brûlée", price: 6.5, category: "dessert" },
	tatin:     { id: "68c9d81189ee999ff0ac444f", name: "Tarte Tatin", price: 6, category: "dessert" },
	profiteroles:{ id: "68c9d81189ee999ff0ac4450", name: "Profiteroles", price: 7, category: "dessert" },
	mousse:    { id: "68c9d81189ee999ff0ac4451", name: "Mousse au Chocolat", price: 6, category: "dessert" },
	ileFlot:   { id: "68c9d81189ee999ff0ac4452", name: "Île Flottante", price: 6.5, category: "dessert" },
	fraises:   { id: "68c9d81189ee999ff0ac4453", name: "Tarte aux Fraises", price: 6.5, category: "dessert" },
	fondant:   { id: "68c9d81189ee999ff0ac4456", name: "Fondant au Chocolat", price: 6.5, category: "dessert" },
	crepes:    { id: "68c9d81189ee999ff0ac4457", name: "Crêpes Suzette", price: 7, category: "dessert" },
};

function item(p, qty, notes = "") {
	return {
		productId: p.id,
		name: p.name,
		price: p.price,
		quantity: qty,
		category: p.category,
		notes,
		itemStatus: "confirmed",
	};
}

// Réservations d'aujourd'hui (IDs récupérés de la BDD)
const RESAS = [
	{ _id: "69ab7f648db81c4433873916", tableId: "686af692bb4cba684ff3b757", serverId: "69ab70afb5a0383625c3b77a", client: "Famille Benali" },
	{ _id: "69ab7f648db81c443387391b", tableId: "686af69cbb4cba684ff3b760", serverId: "69ab70afb5a0383625c3b77d", client: "Rachid Mezouar" },
	{ _id: "69ab7f648db81c443387391e", tableId: "686af69ebb4cba684ff3b762", serverId: "69ab70afb5a0383625c3b780", client: "Aïcha & Youssef" },
	{ _id: "69ab7f648db81c4433873920", tableId: "69a98a5986311811f8f6c258", serverId: "69ab70afb5a0383625c3b783", client: "Groupe Nassim" },
	{ _id: "69ab7f648db81c4433873923", tableId: "686af69fbb4cba684ff3b763", serverId: "69ab70b0b5a0383625c3b786", client: "Leïla Boudjemaa" },
	{ _id: "69ab7f648db81c4433873925", tableId: "686af6a0bb4cba684ff3b764", serverId: "69ab70afb5a0383625c3b77a", client: "Samir Kaci" },
	{ _id: "69ab7f648db81c4433873928", tableId: "686af6a1bb4cba684ff3b765", serverId: "69ab70afb5a0383625c3b77d", client: "Fatima Zeroual" },
	{ _id: "69ab7f648db81c443387392a", tableId: "695a3d0b2295faf8ca9f3012", serverId: "69ab70afb5a0383625c3b780", client: "Omar Hadj" },
	{ _id: "69ab7f648db81c443387392d", tableId: "686af6a3bb4cba684ff3b767", serverId: "69ab70afb5a0383625c3b783", client: "Les Belkacem" },
	{ _id: "69ab7f648db81c443387392f", tableId: "686af6a5bb4cba684ff3b769", serverId: "69ab70b0b5a0383625c3b786", client: "Mina Ait-Ahmed" },
	{ _id: "69ab7f648db81c4433873932", tableId: "69a9225133d1af5404a8f2a3", serverId: "69ab70afb5a0383625c3b77a", client: "Djamel Rahmani" },
	{ _id: "69ab7f648db81c4433873934", tableId: "69a9225233d1af5404a8f2a7", serverId: "69ab70afb5a0383625c3b77d", client: "Couple Meziane" },
	{ _id: "69ab7f648db81c4433873936", tableId: "69a9225333d1af5404a8f2a9", serverId: "69ab70afb5a0383625c3b780", client: "Nadia Ferhat" },
	{ _id: "69ab7f648db81c4433873938", tableId: "69a9169133d1af5404a8e774", serverId: "69ab70afb5a0383625c3b783", client: "Hicham Talbi" },
	{ _id: "69ab7f648db81c443387393a", tableId: "69a92c3686311811f8f676fb", serverId: "69ab70b0b5a0383625c3b786", client: "Famille Slimani" },
];

// 2 commandes par réservation : Cmd1 = entrées+boissons, Cmd2 = plats+desserts
const ordersData = [
	// 1. Famille Benali (5 pers) — fête
	{ items1: [item(P.chevre,2), item(P.foieGras,1), item(P.nicoise,2), item(P.vinRouge,3), item(P.limonade,2)],
	  items2: [item(P.boeuf,2), item(P.canard,2), item(P.saumon,1), item(P.creme,3), item(P.fondant,2)] },
	// 2. Rachid Mezouar (2 pers) — allergie fruits de mer
	{ items1: [item(P.soupe,1), item(P.charcut,1), item(P.vinRouge,1), item(P.eauPet,1)],
	  items2: [item(P.steak,1), item(P.poulet,1), item(P.mousse,1), item(P.tatin,1)] },
	// 3. Aïcha & Youssef (2 pers)
	{ items1: [item(P.chevre,1), item(P.nicoise,1), item(P.limonade,2)],
	  items2: [item(P.coq,1), item(P.saumon,1), item(P.creme,2)] },
	// 4. Groupe Nassim (6 pers) — végétarien
	{ items1: [item(P.chevre,3), item(P.soupe,3), item(P.jus,4), item(P.eauPet,2)],
	  items2: [item(P.ratatouille,4), item(P.gratin,2), item(P.profiteroles,3), item(P.fraises,3)] },
	// 5. Leïla Boudjemaa (3 pers) — allergie gluten
	{ items1: [item(P.nicoise,2), item(P.chevre,1), item(P.smoothie,2), item(P.eauPet,1)],
	  items2: [item(P.poulet,2), item(P.saumon,1), item(P.ileFlot,2), item(P.mousse,1)] },
	// 6. Samir Kaci (2 pers)
	{ items1: [item(P.charcut,1), item(P.soupe,1), item(P.vinBlanc,2)],
	  items2: [item(P.canard,1), item(P.steak,1), item(P.crepes,1), item(P.fondant,1)] },
	// 7. Fatima Zeroual (4 pers) — enfant, arachides
	{ items1: [item(P.soupe,2), item(P.chevre,2), item(P.jus,2), item(P.chocolat,1), item(P.eauPet,1)],
	  items2: [item(P.poulet,2), item(P.coq,1), item(P.quiche,1), item(P.mousse,2), item(P.tatin,2)] },
	// 8. Omar Hadj (2 pers)
	{ items1: [item(P.charcut,1), item(P.foieGras,1), item(P.vinRouge,2)],
	  items2: [item(P.boeuf,1), item(P.cassoulet,1), item(P.profiteroles,2)] },
	// 9. Les Belkacem (4 pers) — client régulier
	{ items1: [item(P.nicoise,2), item(P.foieGras,2), item(P.vinBlanc,2), item(P.jus,2)],
	  items2: [item(P.canard,2), item(P.saumon,2), item(P.creme,2), item(P.crepes,2)] },
	// 10. Mina Ait-Ahmed (2 pers) — lactose
	{ items1: [item(P.nicoise,1), item(P.soupe,1), item(P.limonade,1), item(P.the,1)],
	  items2: [item(P.steak,1), item(P.ratatouille,1), item(P.tatin,1), item(P.mousse,1, "Sans crème")] },
	// 11. Djamel Rahmani (3 pers) — halal
	{ items1: [item(P.chevre,2), item(P.charcut,1), item(P.eauPet,2), item(P.jus,1)],
	  items2: [item(P.poulet,2), item(P.gratin,1), item(P.fondant,2), item(P.creme,1)] },
	// 12. Couple Meziane (2 pers) — demande en mariage
	{ items1: [item(P.foieGras,2), item(P.vinBlanc,2, "Champagne si dispo")],
	  items2: [item(P.canard,1), item(P.saumon,1), item(P.profiteroles,1, "Écrire 'Veux-tu m'épouser ?' au chocolat"), item(P.crepes,1)] },
	// 13. Nadia Ferhat (1 pers) — végan
	{ items1: [item(P.soupe,1), item(P.the,1)],
	  items2: [item(P.ratatouille,1), item(P.tatin,1, "Sans beurre si possible")] },
	// 14. Hicham Talbi (4 pers) — noix, sésame
	{ items1: [item(P.nicoise,2), item(P.soupe,2), item(P.vinRouge,2), item(P.limonade,2)],
	  items2: [item(P.boeuf,2), item(P.coq,2), item(P.mousse,2, "Sans noisettes"), item(P.ileFlot,2)] },
	// 15. Famille Slimani (5 pers) — fête fin d'études
	{ items1: [item(P.chevre,3), item(P.charcut,2), item(P.vinRouge,3), item(P.smoothie,2)],
	  items2: [item(P.cassoulet,2), item(P.steak,2), item(P.canard,1), item(P.fondant,3), item(P.profiteroles,2)] },
];

function calcTotal(items) {
	return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

async function main() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

		let totalOrders = 0;
		for (let i = 0; i < RESAS.length; i++) {
			const resa = RESAS[i];
			const data = ordersData[i];

			// Commande 1 : Entrées + Boissons
			const order1 = new Order({
				reservationId: resa._id,
				restaurantId: RESTAURANT_ID,
				tableId: resa.tableId,
				serverId: resa.serverId,
				items: data.items1,
				totalAmount: calcTotal(data.items1),
				orderStatus: "confirmed",
				origin: "server",
				notes: "",
			});
			await order1.save();

			// Commande 2 : Plats + Desserts
			const order2 = new Order({
				reservationId: resa._id,
				restaurantId: RESTAURANT_ID,
				tableId: resa.tableId,
				serverId: resa.serverId,
				items: data.items2,
				totalAmount: calcTotal(data.items2),
				orderStatus: "confirmed",
				origin: "server",
				notes: "",
			});
			await order2.save();

			// Lien bidirectionnel : ajouter les orderIds à la réservation
			await Reservation.findByIdAndUpdate(resa._id, {
				$push: { orderIds: { $each: [order1._id, order2._id] } },
				$set: { totalAmount: calcTotal(data.items1) + calcTotal(data.items2) },
			});

			const total = calcTotal(data.items1) + calcTotal(data.items2);
			console.log(`✅ ${resa.client} — 2 commandes (${total.toFixed(2)}€)`);
			totalOrders += 2;
		}

		console.log(`\n🎉 ${totalOrders} commandes créées pour ${RESAS.length} réservations !`);
	} catch (err) {
		console.error("❌ Erreur:", err.message);
	} finally {
		await mongoose.connection.close();
		process.exit(0);
	}
}

main();
