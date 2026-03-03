import jwt from "jsonwebtoken";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  const { email, password } = req.body;

  // جلب المتغيرات
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // --- سطر الكشف السحري (بيظهر في الـ Logs فقط) ---
  console.log("--- DEBUG INFO ---");
  console.log("وصلني إيميل:", email);
  console.log("المسجل في Vercel:", ADMIN_EMAIL);
  console.log("هل الباسورد متطابق؟:", password === ADMIN_PASSWORD);
  console.log("هل JWT_SECRET موجود؟:", !!JWT_SECRET);
  console.log("------------------");

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email: ADMIN_EMAIL, role: "admin" }, JWT_SECRET, { expiresIn: "2h" });
    return res.status(200).json({ token });
  }

  // رد تفصيلي مؤقت عشان تعرف المشكلة فين
  return res.status(401).json({ 
    message: "بيانات خاطئة",
    debug: {
      emailReceived: email,
      isEmailMatch: email === ADMIN_EMAIL,
      isPassMatch: password === ADMIN_PASSWORD,
      envLoaded: !!ADMIN_EMAIL
    }
  });
}
