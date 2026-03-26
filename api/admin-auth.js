import jwt from "jsonwebtoken";
import { serialize } from "cookie";

export default async function handler(req, res) {
  // السماح فقط بطلبات POST للأمان
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { action, email, password } = req.body;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // --- الحالة الأولى: تسجيل الدخول (Login) ---
  if (action === "login") {
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      // تشفير الإيميل داخل التوكن
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "2h" });

      // إرسال الكوكي بأمان
      res.setHeader("Set-Cookie", serialize("adminToken", token, {
        httpOnly: true,
        secure: true, 
        sameSite: "strict",
        path: "/",
        maxAge: 7200 // ساعتان
      }));

      return res.status(200).json({ success: true, message: "تم تسجيل الدخول بنجاح" });
    }
    return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
  }

  // --- الحالة الثانية: تسجيل الخروج (Logout) ---
  if (action === "logout") {
    res.setHeader("Set-Cookie", serialize("adminToken", "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0 // تدمير الكوكي فوراً
    }));
    return res.status(200).json({ success: true, message: "تم تسجيل الخروج" });
  }

  // في حال أرسل طلب بدون Action صحيح
  return res.status(400).json({ message: "Invalid Action" });
}
