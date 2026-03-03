import jwt from "jsonwebtoken";

export default function handler(req, res) {
  // السماح فقط بطلبات POST
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  // 1. قراءة البيانات المرسلة من الصفحة
  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { console.error("Parsing error"); }
  }

  const email = (data.email || "").trim();
  const password = (data.password || "").trim();

  // 2. البيانات الثابتة (Hardcoded) اللي أنت حددتها
  const FIXED_EMAIL = "amir992005@gmail.com";
  const FIXED_PASS = "01113538931992005";
  const JWT_SECRET = "AM_REWARDS_SUPER_SECRET_2026"; // سر لتشفير التوكن

  // 3. التحقق المباشر
  if (email === FIXED_EMAIL && password === FIXED_PASS) {
    // إنشاء التوكن
    const token = jwt.sign(
      { email: email, role: "admin" }, 
      JWT_SECRET, 
      { expiresIn: "2h" }
    );
    
    return res.status(200).json({ token });
  }

  // 4. في حالة الفشل
  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
