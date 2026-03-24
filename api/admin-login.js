import jwt from "jsonwebtoken";
import { serialize } from "cookie";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  // 1. حذفنا الـ fingerprint من استقبال البيانات
  const { email, password } = req.body;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    // 2. تشفير الإيميل فقط داخل التوكن (إلغاء قيد الجهاز)
    const token = jwt.sign(
      { email }, 
      JWT_SECRET, 
      { expiresIn: "2h" }
    );

    // 3. إرسال الكوكي بأمان (مع الحفاظ على الإعدادات الأمنية)
    res.setHeader("Set-Cookie", serialize("adminToken", token, {
      httpOnly: true,
      secure: true, // تأكد أن موقعك يعمل بـ HTTPS
      sameSite: "strict",
      path: "/",
      maxAge: 7200 // ساعتان
    }));

    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
