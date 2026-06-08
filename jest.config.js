module.exports = {
	testEnvironment: "node",
	verbose: true,
	// Tests séquentiels : évite la contamination inter-tests sur la même DB
	// runInBand est une option CLI uniquement → utiliser maxWorkers: 1
	maxWorkers: 1,
	retryTimes: 2, // Retry flaky tests (réseau Render, timing DB)
	globalSetup: "<rootDir>/src/test/setup/globalSetup.js",
	setupFilesAfterEnv: ["<rootDir>/src/test/setup/jestSetup.js"],
	globalTeardown: "<rootDir>/src/test/setup/globalTeardown.js",
};
