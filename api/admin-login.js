// api/admin-login.js
import jwt from "jsonwebtoken";

export default function handler(req, res) {
  // 1. السماح فقط بطلبات POST
  if (req.method !== "POST") {
    return res.status(405).json({ message: "الطريقة غير مسموحة" });
  }

  const { email, password } = req.body;

  // 2. جلب البيانات من البيئة المؤمنة (Environment Variables)
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // 3. التحقق من صحة البيانات
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    // إنشاء توكن مشفر يدوم لمدة ساعتين
    const token = jwt.sign(
      { email: ADMIN_EMAIL, role: "admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(200).json({ token });
  }

  // 4. في حالة البيانات خطأ
  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
