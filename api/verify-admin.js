import jwt from "jsonwebtoken";
import { parse } from "cookie";

export default function handler(req, res) {
  // 1. استخراج الكوكيز
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;

  // 2. التحقق من وجود التوكن فقط (حذفنا شرط الـ clientFingerprint)
  if (!token) {
    return res.status(401).json({ valid: false, message: "No token found" });
  }

  try {
    // 3. التحقق من صحة التوكن وتشفيره
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // تم حذف شرط مقارنة الـ device تماماً لفتح الدخول من أي جهاز
    
    return res.status(200).json({ 
      valid: true, 
      email: decoded.email 
    });
  } catch (error) {
    // في حال كان التوكن منتهي أو مزور
    return res.status(401).json({ valid: false, message: "Invalid Session" });
  }
}
