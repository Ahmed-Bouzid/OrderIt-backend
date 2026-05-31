require("dotenv").config();
const emailService = require("./services/emailService");

async function testEmail() {
	console.log("🧪 Test d'envoi d'email avec Brevo...\n");

	// Change cet email par un email différent de l'expéditeur
	const TEST_EMAIL = "waraibeatbox+test@gmail.com"; // Gmail alias (même boîte, email différent)

	console.log(`📧 Destinataire : ${TEST_EMAIL}\n`);

	// Test 1: Email de confirmation
	console.log("1️⃣ Test confirmation de réservation...");
	const confirmResult = await emailService.sendReservationConfirmation({
		email: TEST_EMAIL,
		nom: "Ahmed Test",
		date: "15 juin 2026",
		heure: "20h00",
		nombrePersonnes: 4,
		restaurantName: "Baghera",
		restaurantAddress: "123 Rue de la République, 13001 Marseille",
		restaurantPhone: "04 12 34 56 78",
	});

	if (confirmResult.success) {
		console.log(`   ✅ Email envoyé ! ID: ${confirmResult.messageId}`);
	} else {
		console.log(`   ❌ Erreur : ${confirmResult.error}`);
	}

	// Pause de 2s entre les emails
	await new Promise((resolve) => setTimeout(resolve, 2000));

	// Test 2: Email de rappel
	console.log("\n2️⃣ Test rappel de réservation...");
	const reminderResult = await emailService.sendReservationReminder({
		email: TEST_EMAIL,
		nom: "Ahmed Test",
		date: "16 juin 2026",
		heure: "12h30",
		nombrePersonnes: 2,
		restaurantName: "Baghera",
	});

	if (reminderResult.success) {
		console.log(`   ✅ Email envoyé ! ID: ${reminderResult.messageId}`);
	} else {
		console.log(`   ❌ Erreur : ${reminderResult.error}`);
	}

	// Pause de 2s
	await new Promise((resolve) => setTimeout(resolve, 2000));

	// Test 3: Email d'annulation
	console.log("\n3️⃣ Test annulation de réservation...");
	const cancelResult = await emailService.sendReservationCancellation({
		email: TEST_EMAIL,
		nom: "Ahmed Test",
		date: "20 juin 2026",
		heure: "19h00",
		restaurantName: "Baghera",
	});

	if (cancelResult.success) {
		console.log(`   ✅ Email envoyé ! ID: ${cancelResult.messageId}`);
	} else {
		console.log(`   ❌ Erreur : ${cancelResult.error}`);
	}

	console.log("\n✅ Tests terminés ! Vérifie ta boîte mail.");
	console.log("💡 Pense aussi à vérifier les spams si tu ne vois rien.\n");
}

testEmail().catch((error) => {
	console.error("❌ Erreur fatale :", error);
	process.exit(1);
});
