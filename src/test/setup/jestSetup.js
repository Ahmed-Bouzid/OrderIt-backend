// Prevents individual test files from closing the shared Mongoose connection.
// The connection is closed once by globalTeardown after all tests complete.
const mongoose = require("mongoose");

// Disable rate limiting in tests to prevent 429s across suites
process.env.DISABLE_RATE_LIMIT = "true";

const _originalClose = mongoose.connection.close.bind(mongoose.connection);

// Stub close() so individual afterAll hooks don't disconnect mid-suite.
// The real close is handled by globalTeardown.
mongoose.connection.close = async () => {
	// no-op stub: DB connection managed globally
	console.log("[jestSetup] mongoose.connection.close() called — no-op (managed by globalTeardown)");
};

// Re-expose original for globalTeardown
global.__mongooseRealClose = _originalClose;
