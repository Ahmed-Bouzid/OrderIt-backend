const mongoose = require("mongoose");

function validateObjectIds(ids = []) {
	return (req, res, next) => {
		for (const idParam of ids) {
			if (!mongoose.Types.ObjectId.isValid(req.params[idParam])) {
				return res.status(400).json({ message: `ID invalide : ${idParam}` });
			}
		}
		next();
	};
}

module.exports = validateObjectIds;
