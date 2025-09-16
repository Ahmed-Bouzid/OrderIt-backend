const checkRoles = require("./checkRoles");

const checkAdmin = checkRoles(["admin"]);

module.exports = checkAdmin;
