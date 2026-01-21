const checkRoles = require("./checkRoles");

const checkAdmin = checkRoles(["admin", "developer"]);

module.exports = checkAdmin;
