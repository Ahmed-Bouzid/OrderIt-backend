// middlewares/checkUserRestaurantBody.js

function checkUserRestaurantBody(fieldName = "restaurantId") {
	return (req, res, next) => {
		const userRole = req.user.role;
		const userRestaurantId = req.user.restaurantId;
		const bodyRestaurantId = req.body[fieldName];

		if (
			userRole !== "admin" &&
			bodyRestaurantId &&
			userRestaurantId !== bodyRestaurantId
		) {
			return res
				.status(403)
				.json({ message: "Accès refusé : restaurant différent." });
		}
		next();
	};
}

module.exports = checkUserRestaurantBody;
