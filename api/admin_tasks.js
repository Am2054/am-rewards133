import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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

  const { action, password, filter, customStart, customEnd } = req.body;

  // 1. تسجيل الدخول
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD4) {
      const token = jwt.sign({ role: 'task_analyst' }, process.env.JWT_SECRET, { expiresIn: '8h' });
      res.setHeader('Set-Cookie', serialize('taskToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 28800 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. التحقق من التوكن
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.taskToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    jwt.verify(token, process.env.JWT_SECRET);

    if (action === 'get_analytics') {
      let query = db.collection('tasksCompleted');
      let start;
      const now = new Date();

      // تحديد المدى الزمني
      if (filter === 'today') start = new Date(now.setHours(0,0,0,0));
      else if (filter === '7days') start = new Date(now.getTime() - 7*24*60*60*1000);
      else if (filter === '30days') start = new Date(now.getTime() - 30*24*60*60*1000);
      else if (filter === 'custom' && customStart) start = new Date(customStart);

      if (start && filter !== 'all') {
        query = query.where('date', '>=', start);
      }

      const snap = await query.get();
      const taskCounts = {};
      let totalTasks = 0;
      let todayCount = 0;
      const todayStr = new Date().toDateString();

      snap.forEach(doc => {
        const d = doc.data();
        totalTasks++;
        const type = d.taskType || d.taskId || 'غير معروف';
        taskCounts[type] = (taskCounts[type] || 0) + 1;
        
        const dDate = d.date?.toDate ? d.date.toDate() : null;
        if (dDate && dDate.toDateString() === todayStr) todayCount++;
      });

      // ترتيب أعلى 10 مهام
      const topTasks = Object.entries(taskCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      return res.status(200).json({
        totalTasks,
        todayCount,
        uniqueTypes: Object.keys(taskCounts).length,
        topTasks
      });
    }

  } catch (e) { return res.status(401).json({ error: "Session Expired" }); }
}
