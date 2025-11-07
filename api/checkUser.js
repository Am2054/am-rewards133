const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  try {
    const { email, deviceId, ip } = req.body;

    if (!email || !deviceId || !ip) {
      return res.status(400).json({ approved: false, reason: "بيانات ناقصة" });
    }

    // 🕵️‍♂️ البحث عن أي مستخدم بنفس IP أو الجهاز
    const dupQuery = await db.collection("userDevices")
      .where("ip", "==", ip)
      .get();

    const dupDeviceQuery = await db.collection("userDevices")
      .where("deviceId", "==", deviceId)
      .get();

    if (!dupQuery.empty || !dupDeviceQuery.empty) {
      return res.status(403).json({ approved: false, reason: "حساب مكرر محتمل" });
    }

    // ✅ تخزين بيانات الجهاز والإيميل
    await db.collection("userDevices").add({
      email,
      ip,
      deviceId,
      createdAt: new Date()
    });

    return res.status(200).json({ approved: true });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ approved: false, reason: "خطأ في السيرفر" });
  }
};
