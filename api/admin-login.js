import jwt from "jsonwebtoken";

export default function handler(req, res) {
  // ط§ظ„ط³ظ…ط§ط­ ظپظ‚ط· ط¨ط·ظ„ط¨ط§طھ POST
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  // 1. ظ‚ط±ط§ط،ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط±ط³ظ„ط© ظ…ظ† ط§ظ„طµظپط­ط©
  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { console.error("Parsing error"); }
  }

  const email = (data.email || "").trim();
  const password = (data.password || "").trim();

  // 2. ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط«ط§ط¨طھط© (Hardcoded) ط§ظ„ظ„ظٹ ط£ظ†طھ ط­ط¯ط¯طھظ‡ط§
  const FIXED_EMAIL = "amir992005@gmail.com";
  const FIXED_PASS = "01113538931992005";
  const JWT_SECRET = "AM_REWARDS_SUPER_SECRET_2026"; // ط³ط± ظ„طھط´ظپظٹط± ط§ظ„طھظˆظƒظ†

  // 3. ط§ظ„طھط­ظ‚ظ‚ ط§ظ„ظ…ط¨ط§ط´ط±
  if (email === FIXED_EMAIL && password === FIXED_PASS) {
    // ط¥ظ†ط´ط§ط، ط§ظ„طھظˆظƒظ†
    const token = jwt.sign(
      { email: email, role: "admin" }, 
      JWT_SECRET, 
      { expiresIn: "2h" }
    );
    
    return res.status(200).json({ token });
  }

  // 4. ظپظٹ ط­ط§ظ„ط© ط§ظ„ظپط´ظ„
  return res.status(401).json({ message: "ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¯ط®ظˆظ„ ط؛ظٹط± طµط­ظٹط­ط©" });
}
