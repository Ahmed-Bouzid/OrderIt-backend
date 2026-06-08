require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Order = require("../src/models/Order");
const Restaurant = require("../src/models/Restaurant");

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const restaurants = await Restaurant.find({}, { name: 1, _id: 1 }).lean();
  for (const r of restaurants) {
    const total = await Order.countDocuments({ restaurantId: r._id });
    const y2026 = await Order.countDocuments({ restaurantId: r._id, createdAt: { $gte: new Date("2026-01-01") } });
    const y2025 = await Order.countDocuments({ restaurantId: r._id, createdAt: { $gte: new Date("2025-01-01"), $lt: new Date("2026-01-01") } });
    console.log(`[${r._id}] ${r.name} → total: ${total}, 2025: ${y2025}, 2026: ${y2026}`);
  }
  await mongoose.disconnect();
});
