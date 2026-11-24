// /api/admin.js — واجهة الإدارة الموحدة (تدمج admin-auth و admin-stats وإدارة العقارات)
//   GET  /api/admin?action=session  → هل الجلسة سارية؟
//   GET  /api/admin?action=stats    → الإحصائيات
//   POST {action:"login", idToken}  → دخول الأدمن (يتحقق من توكن Firebase، لا كلمة مرور في السيرفر)
//   POST {action:"logout"}          → خروج
//   POST {action: getPending | approve | reject | edit | delete | approveEdit | rejectEdit, propertyId, ...} → مراجعة العقارات
import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";
import { getAuth } from "firebase-admin/auth";
import { getApp } from "firebase-admin/app";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminRtdb } from "../lib/verifyUser.js"; // يهيّئ Firebase Admin
import { v2 as cloudinary } from "cloudinary";
import { notify } from "../lib/notifications.js";

const JWT_SECRET = process.env.JWT_SECRET; // إجباري: بدون قيمة افتراضية
const ADMINS = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const SESSION_SECONDS = 2 * 60 * 60;
const DB_URL = process.env.FIREBASE_DATABASE_URL || "https://am--rewards-default-rtdb.firebaseio.com";
const COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" };

function getSession(req) {
  try {
    const token = parse(req.headers.cookie || "").adminToken;
    return token ? jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) : null;
  } catch {
    return null;
  }
}

async function logAdmin(action, email, details = {}) {
  try {
    await adminDb().collection("adminLogs").add({ action, email, details, ip: details.ip || "unknown", timestamp: FieldValue.serverTimestamp() });
  } catch (e) { console.error("adminLogs write failed:", e.message); }
}
async function alertAdmin(status, email, ip) {
  try { await notify.adminLogin({ admin: email, ip, status }); }
  catch (e) { console.error("admin telegram alert failed:", e.message); }
}

// عدّ بدل تحميل كل الوثائق (أرخص بكثير في فواتير Firestore)
async function count(q) {
  try { return (await q.count().get()).data().count; }
  catch { return (await q.select().get()).size; }
}
// عدد غرف المحادثة بدون تحميل بياناتها (shallow)
async function countRooms() {
  try {
    const { access_token } = await getApp().options.credential.getAccessToken();
    const r = await fetch(`${DB_URL}/chatRooms.json?shallow=true`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (r.ok) { const v = await r.json(); return v ? Object.keys(v).length : 0; }
  } catch (e) { console.warn("shallow count failed:", e.message); }
  const snap = await adminRtdb().ref("chatRooms").get();
  return snap.exists() ? snap.numChildren() : 0;
}

let cache = { t: 0, data: null };
async function getStats() {
  if (cache.data && Date.now() - cache.t < 20000) return cache.data;
  const db = adminDb(), P = db.collection("properties");
  const [totalUsers, totalProperties, pendingProperties, approvedProperties, rejectedProperties, pendingEdits, activeRooms] = await Promise.all([
    count(db.collection("users")),
    count(P),
    count(P.where("status", "==", "pending")),
    count(P.where("status", "==", "approved")),
    count(P.where("status", "==", "rejected")),
    count(db.collection("property_edit_requests").where("status", "==", "pending")),
    countRooms(),
  ]);
  cache = { t: Date.now(), data: { totalUsers, totalProperties, pendingProperties, approvedProperties, rejectedProperties, pendingEdits, activeRooms, timestamp: new Date().toISOString() } };
  return cache.data;
}


/* ================= مراجعة العقارات ================= */
const PROP_ACTIONS = new Set(["getPending", "approve", "reject", "edit", "delete", "approveEdit", "rejectEdit"]);
// الحقول المسموح بتعديلها (لا يمكن تغيير المالك أو الحالة أو تاريخ الإنشاء من هنا)
const BASE_FIELDS = ["title", "description", "price", "area", "governorate", "city", "district", "propertyType", "purpose", "rooms", "bathrooms", "floor", "buildingFloors", "constructionYear", "finishing", "electricityCard", "waterCard", "landType", "paymentMethod", "downPayment", "installmentYears", "leaseDuration", "rentCycle", "furnishing", "isHidden", "availability"];
const RICH_FIELDS = ["images", "coverImage", "video", "location", "hasCoordinates", "features"];
const APT_ONLY = ["rooms", "bathrooms", "floor", "buildingFloors", "constructionYear", "finishing", "electricityCard", "waterCard", "features", "furnishing"];

const str = (v, n = 500) => String(v ?? "").trim().slice(0, n);
const millis = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : 0);

// من هو الأدمن: كوكي الجلسة، أو توكن Firebase عليه علامة admin (للتوافق مع الصفحة القديمة)
async function adminFrom(req, body) {
  const s = getSession(req);
  if (s) return { uid: s.uid, email: s.email };
  if (typeof body.idToken === "string") {
    try {
      const d = await getAuth().verifyIdToken(body.idToken);
      if (d.admin === true && ADMINS.includes((d.email || "").toLowerCase())) return { uid: d.uid, email: d.email };
    } catch { /* تجاهل */ }
  }
  return null;
}

// حذف الصور من Cloudinary (الصور القديمة على Vercel Blob لا تُمسح من هنا)
function publicId(url) {
  const m = String(url || "").match(/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
  return m ? m[1] : null;
}
async function deleteImages(urls) {
  const ids = [...new Set((urls || []).map(publicId).filter(Boolean))];
  if (!ids.length) return;
  try { await cloudinary.api.delete_resources(ids, { resource_type: "image" }); }
  catch (e) { console.warn("cloudinary cleanup failed:", e.message); }
}

function contentFrom(data) {
  const c = {};
  for (const k of [...BASE_FIELDS, ...RICH_FIELDS]) if (data[k] !== undefined) c[k] = data[k];
  return c;
}

async function propertyAction(action, b, admin) {
  const db = adminDb(), props = db.collection("properties"), edits = db.collection("property_edit_requests");
  const now = FieldValue.serverTimestamp();
  const pendingEditFor = async (id) => {
    const q = await edits.where("propertyId", "==", id).where("status", "==", "pending").limit(1).get();
    return q.empty ? null : q.docs[0];
  };

  async function applyEdit(eDoc) {
    const e = eDoc.data(), ref = props.doc(e.propertyId), snap = await ref.get();
    if (!snap.exists) {
      await eDoc.ref.update({ status: "rejected", rejectReason: "العقار لم يعد موجوداً", reviewedBy: admin.uid, reviewedAt: now });
      return [404, { error: "العقار لم يعد موجوداً" }];
    }
    const cur = snap.data(), c = contentFrom(e.newData || {});
    if (c.propertyType === "أرض") APT_ONLY.forEach((k) => { c[k] = FieldValue.delete(); }); else c.landType = FieldValue.delete();
    if (c.purpose === "rent") ["paymentMethod", "downPayment", "installmentYears"].forEach((k) => { c[k] = FieldValue.delete(); });
    else if (c.purpose === "sale") ["rentCycle", "leaseDuration"].forEach((k) => { c[k] = FieldValue.delete(); });
    await ref.update({ ...c, status: "approved", approvedAt: now, approvedBy: admin.uid, rejectReason: "", updatedAt: now });
    await eDoc.ref.update({ status: "approved", reviewedBy: admin.uid, reviewedAt: now });
    const keep = new Set(Array.isArray(c.images) ? c.images : cur.images || []);
    await deleteImages((cur.images || []).filter((u) => !keep.has(u))); // صور اتشالت في التعديل
    return [200, { success: true, message: "تم اعتماد التعديل" }];
  }

  async function rejectEdit(eDoc, reason) {
    const e = eDoc.data(), old = e.oldData || {}, ref = props.doc(e.propertyId), snap = await ref.get();
    if (snap.exists) {
      const orig = old.status && old.status !== "pending" ? old.status : "approved"; // الحالة قبل ما المالك يعدّل
      const up = { status: orig, updatedAt: now };
      if (orig === "rejected") up.rejectReason = reason;
      await ref.update(up);
    }
    await eDoc.ref.update({ status: "rejected", rejectReason: reason, reviewedBy: admin.uid, reviewedAt: now });
    const keep = new Set(old.images || []);
    await deleteImages(((e.newData || {}).images || []).filter((u) => !keep.has(u))); // صور رُفعت ولن تُستخدم
    return [200, { success: true, message: "تم رفض التعديل وبقي الإعلان بحالته السابقة" }];
  }

  if (action === "getPending") {
    // بدون orderBy حتى لا نحتاج فهرس مركّب؛ الترتيب هنا
    const [ps, es] = await Promise.all([
      props.where("status", "==", "pending").limit(200).get(),
      edits.where("status", "==", "pending").limit(200).get(),
    ]);
    const byProp = new Map(); es.forEach((d) => byProp.set(d.data().propertyId, d));
    const list = ps.docs.map((d) => {
      const base = { id: d.id, ...d.data() }, e = byProp.get(d.id);
      // لو عليه طلب تعديل نعرض البيانات الجديدة ونعلّمه
      return e ? { ...base, ...contentFrom(e.data().newData || {}), isEditRequest: true, editRequestId: e.id } : base;
    });
    list.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    return [200, { success: true, data: list }];
  }

  if (action === "approveEdit" || action === "rejectEdit") {
    const id = str(b.requestId, 100);
    if (!id) return [400, { error: "requestId مطلوب" }];
    const eDoc = await edits.doc(id).get();
    if (!eDoc.exists || eDoc.data().status !== "pending") return [404, { error: "طلب التعديل غير موجود أو تمت مراجعته" }];
    if (action === "approveEdit") return applyEdit(eDoc);
    const reason = str(b.rejectReason);
    return reason ? rejectEdit(eDoc, reason) : [400, { error: "اكتب سبب الرفض" }];
  }

  const id = str(b.propertyId, 100);
  if (!id) return [400, { error: "propertyId مطلوب" }];
  const ref = props.doc(id), snap = await ref.get();
  if (!snap.exists) return [404, { error: "العقار غير موجود" }];

  if (action === "approve") {
    const e = await pendingEditFor(id); // الموافقة على عقار عليه تعديل = اعتماد التعديل
    if (e) return applyEdit(e);
    await ref.update({ status: "approved", approvedAt: now, approvedBy: admin.uid, rejectReason: "", updatedAt: now });
    return [200, { success: true, message: "تمت الموافقة على العقار" }];
  }

  if (action === "reject") {
    const reason = str(b.rejectReason);
    if (!reason) return [400, { error: "اكتب سبب الرفض" }];
    const e = await pendingEditFor(id);
    if (e) return rejectEdit(e, reason);
    await ref.update({ status: "rejected", rejectReason: reason, rejectedAt: now, rejectedBy: admin.uid, updatedAt: now });
    return [200, { success: true, message: "تم رفض العقار" }];
  }

  if (action === "edit") {
    const src = b.updateData && typeof b.updateData === "object" ? b.updateData : {}, up = {};
    for (const k of BASE_FIELDS) {
      const v = src[k];
      if (typeof v === "string") up[k] = v.slice(0, 2000);
      else if (typeof v === "number" && Number.isFinite(v)) up[k] = v;
      else if (typeof v === "boolean") up[k] = v;
    }
    if (!Object.keys(up).length) return [400, { error: "لا توجد حقول صالحة للتعديل" }];
    await ref.update({ ...up, updatedAt: now });
    return [200, { success: true, message: "تم تعديل العقار" }];
  }

  if (action === "delete") {
    const rs = await edits.where("propertyId", "==", id).get(), urls = [...(snap.data().images || [])];
    rs.forEach((d) => ((d.data().newData || {}).images || []).forEach((u) => urls.push(u)));
    await deleteImages(urls);
    const batch = db.batch(); rs.forEach((d) => batch.delete(d.ref)); batch.delete(ref); await batch.commit();
    return [200, { success: true, message: "تم حذف العقار وصوره نهائياً" }];
  }

  return [400, { error: "إجراء غير معروف" }];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!JWT_SECRET || JWT_SECRET.length < 32 || !ADMINS.length) {
    console.error("JWT_SECRET (32 حرف على الأقل) و ADMIN_EMAIL لازم يكونوا مضبوطين في متغيرات البيئة");
    return res.status(500).json({ message: "إعداد السيرفر ناقص" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = req.method === "POST" ? body.action : (req.query && req.query.action) || "session";
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

  // ---- الجلسة ----
  if ((req.method === "GET" && (action === "session" || action === "verify")) || (req.method === "POST" && action === "verify")) {
    const s = getSession(req);
    return s ? res.status(200).json({ valid: true, email: s.email }) : res.status(401).json({ valid: false });
  }

  // ---- الإحصائيات ----
  if (req.method === "GET" && action === "stats") {
    if (!getSession(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      return res.status(200).json(await getStats());
    } catch (e) {
      console.error("stats error:", e);
      return res.status(500).json({ error: "Failed to fetch stats" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  // ---- الدخول: التحقق من توكن Firebase ثم إصدار كوكي الجلسة ----
  if (action === "login") {
    const idToken = body.idToken;
    if (typeof idToken !== "string" || idToken.length < 100) return res.status(400).json({ message: "طلب غير صالح" });

    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken, true);
    } catch {
      await logAdmin("login_failed", "unknown", { ip });
      await alertAdmin("failed", "unknown", ip);
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }

    const email = (decoded.email || "").toLowerCase();
    const fresh = Date.now() / 1000 - decoded.auth_time < 300; // تسجيل دخول حديث (5 دقائق)
    if (!ADMINS.includes(email)) {
      await logAdmin("login_denied", email, { ip });
      await alertAdmin("failed", email, ip);
      return res.status(403).json({ message: "هذا الحساب ليس لديه صلاحية الإدارة" });
    }
    if (!fresh) return res.status(401).json({ message: "سجّل الدخول من جديد" });

    // صلاحية admin داخل حساب Firebase نفسه (تستخدمها قواعد Firestore و Realtime Database لاحقاً)
    let claimsUpdated = false;
    if (decoded.admin !== true) {
      const u = await getAuth().getUser(decoded.uid);
      await getAuth().setCustomUserClaims(decoded.uid, { ...(u.customClaims || {}), admin: true });
      claimsUpdated = true;
    }

    const token = jwt.sign({ email, uid: decoded.uid, admin: true }, JWT_SECRET, { expiresIn: SESSION_SECONDS, algorithm: "HS256" });
    res.setHeader("Set-Cookie", serialize("adminToken", token, { ...COOKIE, maxAge: SESSION_SECONDS }));
    await logAdmin("login_success", email, { ip });
    await alertAdmin("success", email, ip);
    return res.status(200).json({ success: true, claimsUpdated });
  }

  // ---- الخروج ----
  if (action === "logout") {
    const s = getSession(req);
    res.setHeader("Set-Cookie", serialize("adminToken", "", { ...COOKIE, maxAge: 0 }));
    if (s) {
      try { await getAuth().revokeRefreshTokens(s.uid); } catch (e) { console.warn("revoke failed:", e.message); }
      await logAdmin("logout", s.email, { ip });
    }
    return res.status(200).json({ success: true });
  }

  // ---- مراجعة العقارات ----
  if (PROP_ACTIONS.has(action)) {
    const admin = await adminFrom(req, body);
    if (!admin) return res.status(401).json({ error: "غير مصرح" });
    try {
      const [status, payload] = await propertyAction(action, body, admin);
      if (status === 200 && action !== "getPending") await logAdmin("property_" + action, admin.email, { ip, propertyId: body.propertyId || body.requestId || "" });
      return res.status(status).json(payload);
    } catch (e) {
      console.error("property action error:", action, e);
      return res.status(500).json({ error: "فشل تنفيذ العملية" });
    }
  }

  return res.status(400).json({ message: "Invalid Action" });
}
