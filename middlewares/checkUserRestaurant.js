// middlewares/checkUserRestaurant.js

function checkUserRestaurant(paramRestaurantId = "restaurantId") {
	return (req, res, next) => {
		const userRole = req.user.role;
		const userRestaurantId = req.user.restaurantId;
		const paramId =
			req.params[paramRestaurantId] || req.body[paramRestaurantId];

		// 🔐 Admins + Developers = ACCÈS COMPLET à tous les restaurants
		const isSuperUser = ["admin", "developer"].includes(userRole);

		if (!isSuperUser && paramId && userRestaurantId !== paramId) {
			return res
				.status(403)
				.json({ message: "Accès refusé : restaurant différent." });
		}
		next();
	};
}

module.exports = checkUserRestaurant;
