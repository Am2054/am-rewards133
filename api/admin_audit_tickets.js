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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, query, uid, amount, status, tId, reply, pts } = req.body;

  // --- [1] نظام تسجيل الدخول المنفصل ---
  if (action === 'admin_login') {
    let isValid = false;
    let tokenName = "";

    if (module === 'audit' && password === process.env.ADMIN_PASSWORD5) {
      isValid = true; tokenName = "auditToken";
    } else if (module === 'tickets' && password === process.env.ADMIN_PASSWORD6) {
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
    // --- [2] موديول المراجعة (Audit Module) ---
    if (module === 'audit') {
      if (!cookies.auditToken) return res.status(401).json({ error: "No Audit Token" });
      jwt.verify(cookies.auditToken, process.env.JWT_SECRET);

      if (action === 'fetch_user') {
        let userDoc = await db.collection("users").doc(query).get();
        if (!userDoc.exists) {
          const emailQuery = await db.collection("users").where("email", "==", query).limit(1).get();
          if (emailQuery.empty) return res.status(404).json({ error: "User not found" });
          userDoc = emailQuery.docs[0];
        }
        const targetUid = userDoc.id;
        const userData = userDoc.data();

        const [withdrawals, tasks, referrals, devices, tickets] = await Promise.all([
          db.collection("withdrawals").where("userId", "==", targetUid).get(),
          db.collection("tasksCompleted").where("userId", "==", targetUid).get(),
          db.collection("users").where("referredBy", "==", targetUid).get(),
          db.collection("userDevices").where("uid", "==", targetUid).limit(1).get(),
          db.collection("support_tickets").where("uid", "==", targetUid).get()
        ]);

        const tasksAnalysis = {};
        tasks.forEach(doc => {
          const d = doc.data();
          const type = d.taskType || "other";
          if (!tasksAnalysis[type]) tasksAnalysis[type] = { count: 0, points: 0, details: [] };
          tasksAnalysis[type].count++;
          tasksAnalysis[type].points += (Number(d.pointsEarned) || 0);
          tasksAnalysis[type].details.push({ ...d, id: doc.id, date: d.date?.toDate() || null });
        });

        return res.status(200).json({
          profile: { uid: targetUid, ...userData, deviceId: devices.docs[0]?.data()?.deviceId || "غير مسجل", lastLogin: userData.lastLogin?.toDate() || null },
          tasksGrouped: tasksAnalysis,
          withdrawals: withdrawals.docs.map(d => ({ ...d.data(), id: d.id, timestamp: d.date?.toDate() || null })),
          tickets: tickets.docs.map(d => ({ ...d.data(), id: d.id, timestamp: d.timestamp?.toDate() || null })),
          referralsCount: referrals.size
        });
      }

      if (action === 'updatePoints') {
        await db.collection("users").doc(uid).update({ points: Number(amount) });
        return res.status(200).json({ success: true });
      }
    }

    // --- [3] موديول التذاكر (Tickets Module) ---
    if (module === 'tickets') {
      if (!cookies.ticketToken) return res.status(401).json({ error: "No Ticket Token" });
      jwt.verify(cookies.ticketToken, process.env.JWT_SECRET);

      if (action === 'get_all_tickets') {
        const snap = await db.collection("support_tickets").orderBy("timestamp", "desc").get();
        return res.status(200).json(snap.docs.map(doc => ({ id: doc.id, ...doc.data(), timestamp: doc.data().timestamp?.toDate() })));
      }

      if (action === 'finalize_ticket') {
        const ticketRef = db.collection("support_tickets").doc(tId);
        await ticketRef.update({ 
          status, 
          adminReply: reply, 
          rewardPoints: Number(pts), 
          handledAt: FieldValue.serverTimestamp() 
        });

        if (status === 'approved' && Number(pts) > 0) {
          await db.collection("users").doc(uid).update({ points: FieldValue.increment(Number(pts)) });
          await db.collection("points_transactions").add({ 
            uid, amount: Number(pts), type: "reward", timestamp: FieldValue.serverTimestamp() 
          });
        }
        return res.status(200).json({ success: true });
      }
    }

  } catch (e) { return res.status(401).json({ error: "Session Expired" }); }
}
