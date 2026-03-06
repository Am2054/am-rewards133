import jwt from "jsonwebtoken";
import { parse } from "cookie";

export default function handler(req, res) {
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  const clientFingerprint = req.headers['x-fingerprint'];

  if (!token) return res.status(401).json({ valid: false });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // التحقق من أن الجهاز الذي أرسل الطلب هو نفس الجهاز صاحب التوكن
    if (decoded.device !== clientFingerprint) {
      return res.status(401).json({ valid: false, message: "Security Breach: Device Mismatch" });
    }

    return res.status(200).json({ valid: true });
  } catch (error) {
    return res.status(401).json({ valid: false });
  }
}
