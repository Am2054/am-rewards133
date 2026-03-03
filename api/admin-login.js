import jwt from "jsonwebtoken";

export default function handler(req, res) {
  // السماح بطلبات POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({ message: "الطريقة غير مسموحة" });
  }

  // ترجمة البيانات (Parsing)
  let data = req.body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ message: "تنسيق البيانات خاطئ" });
    }
  }

  const { email, password } = data;

  // جلب البيانات من Environment Variables
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // التحقق
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { email: ADMIN_EMAIL, role: "admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    return res.status(200).json({ token });
  }

  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
