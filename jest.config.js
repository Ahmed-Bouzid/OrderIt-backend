module.exports = {
	testEnvironment: "node",
	verbose: true,
	// Tests séquentiels : évite la contamination inter-tests sur la même DB
	// runInBand est une option CLI uniquement → utiliser maxWorkers: 1
	maxWorkers: 1,
};
