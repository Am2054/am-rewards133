// /api/admin_audit_tickets.js - إدارة ومعالجة تذاكر الدعم والاتصال العقاري بالخلفية
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, status, tId, reply } = req.body;

  // --- [1] نظام تسجيل الدخول المنفصل للتذاكر ---
  if (action === 'admin_login') {
    let isValid = false;
    let tokenName = "";

    if (module === 'tickets' && password === process.env.ADMIN_PASSWORD6) {
      isValid = true; tokenName = "ticketToken";
    }

    if (isValid) {
      const token = jwt.sign({ role: 'admin', module }, process.env.JWT_SECRET, { expiresIn: '8h' });
      res.setHeader('Set-Cookie', serialize(tokenName, token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 28800 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // التحقق من الكوكيز
  const cookies = parse(req.headers.cookie || "");

  try {
    // --- [2] موديول التذاكر والاتصال العقاري (Tickets Module) ---
    if (module === 'tickets') {
      if (!cookies.ticketToken) return res.status(401).json({ error: "No Ticket Token" });
      jwt.verify(cookies.ticketToken, process.env.JWT_SECRET);

      if (action === 'get_all_tickets') {
        const snap = await db.collection("support_tickets").orderBy("timestamp", "desc").get();
        return res.status(200).json(snap.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(), 
          timestamp: doc.data().timestamp?.toDate() 
        })));
      }

      if (action === 'finalize_ticket') {
        const ticketRef = db.collection("support_tickets").doc(tId);
        
        // تحديث التذكرة بنجاح مع إلغاء حقل النقاط ومكافآت السحب تماماً (Pruned Points Metadata)
        await ticketRef.update({ 
          status, 
          adminReply: reply, 
          handledAt: FieldValue.serverTimestamp() 
        });

        return res.status(200).json({ success: true });
      }
    }

  } catch (e) { 
    console.error("Session Error:", e.message);
    return res.status(401).json({ error: "Session Expired" }); 
  }
                                                          }
