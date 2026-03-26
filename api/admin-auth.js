import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";

export default async function handler(req, res) {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // --- الحالة الأولى: التحقق من الجلسة (GET أو POST مع action: verify) ---
  // وضعناها في الأول لأنها بتشتغل أوتوماتيك مع فتح الصفحة
  if (req.method === "GET" || (req.body && req.body.action === "verify")) {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies.adminToken;

    if (!token) {
      return res.status(401).json({ valid: false, message: "No token found" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.status(200).json({ 
        valid: true, 
        email: decoded.email 
      });
    } catch (error) {
      return res.status(401).json({ valid: false, message: "Invalid Session" });
    }
  }

  // لعمليات تسجيل الدخول والخروج بنشترط POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { action, email, password } = req.body;

  // --- الحالة الثانية: تسجيل الدخول (Login) ---
  if (action === "login") {
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "2h" });

      res.setHeader("Set-Cookie", serialize("adminToken", token, {
        httpOnly: true,
        secure: true, 
        sameSite: "strict",
        path: "/",
        maxAge: 7200 
      }));

      return res.status(200).json({ success: true, message: "تم تسجيل الدخول بنجاح" });
    }
    return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
  }

  // --- الحالة الثالثة: تسجيل الخروج (Logout) ---
  if (action === "logout") {
    res.setHeader("Set-Cookie", serialize("adminToken", "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0 
    }));
    return res.status(200).json({ success: true, message: "تم تسجيل الخروج" });
  }

  return res.status(400).json({ message: "Invalid Action" });
}
