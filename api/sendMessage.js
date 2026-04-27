import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) {
    console.error("Firebase Init Error:", e.message);
  }
}

const db = getDatabase();
const messaging = getMessaging();
const auth = getAuth();

// ✅ دالة للحصول على الهوية اليومية
async function getIdentity(uid) {
  try {
    const snapshot = await db.ref(`users/${uid}/identity`).get();
    
    if (snapshot.exists() && snapshot.val().date === new Date().toDateString()) {
      return snapshot.val();
    }

    const ghostNames = [
      'الروح الضائعة', 'الطيف الأزرق', 'صوت الليل', 'همسة الظلام',
      'الشبح الأبيض', 'المتجول الصامت', 'النداء البعيد', 'أصداء الحزن',
      'الضوء الغامض', 'الرياح العابرة', 'صدى الأحلام', 'الليل الساكن'
    ];

    const ranks = ['روح عابرة', 'متجول الليل', 'حافظ الأسرار', 'ملاك الهمس'];

    const newIdentity = {
      ghostName: ghostNames[Math.floor(Math.random() * ghostNames.length)],
      rank: ranks[Math.floor(Math.random() * ranks.length)],
      date: new Date().toDateString(),
      activeDay: new Date().toISOString().split('T')[0]
    };

    await db.ref(`users/${uid}/identity`).set(newIdentity);
    return newIdentity;
  } catch (e) {
    console.error("❌ Identity Error:", e);
    throw e;
  }
}

// ✅ إرسال إشعار تراكمي ذكي
async function sendGroupedNotifications(title, body, recipients, messageCount = 1) {
    try {
        const validTokens = [];

        for (const recipientId of recipients) {
            try {
                const tokenSnap = await db.ref(`users_tokens/${recipientId}`).get();
                if (tokenSnap.exists() && tokenSnap.val().token) {
                    validTokens.push({
                        token: tokenSnap.val().token,
                        userId: recipientId
                    });
                }
            } catch (err) {
                console.warn(`⚠️ خطأ في جلب التوكن لـ ${recipientId}:`, err);
            }
        }

        if (validTokens.length === 0) {
            console.log('ℹ️ لا توجد توكنات صحيحة للإرسال');
            return;
        }

        const sendPromises = validTokens.map(({ token, userId }) => {
            const message = {
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    messageCount: messageCount.toString(),
                    timestamp: new Date().getTime().toString(),
                    type: messageCount > 1 ? 'grouped' : 'single'
                },
                webpush: {
                    notification: {
                        title: title,
                        body: body,
                        icon: '👻',
                        badge: messageCount > 1 ? messageCount.toString() : '💬',
                        tag: 'ghost_chat_group',
                        renotify: true,
                        requireInteraction: messageCount > 1
                    },
                    data: {
                        url: 'https://am-rewards.vercel.app/ghost-chat.html'
                    }
                },
                android: {
                    notification: {
                        title: title,
                        body: body,
                        channelId: 'ghost_chat_channel',
                        tag: 'ghost_chat_group',
                        sound: 'default',
                        groupSummary: messageCount > 1
                    }
                }
            };

            return messaging.send(message)
                .then(() => {
                    console.log(`✅ إشعار مرسل لـ ${userId}`);
                })
                .catch((err) => {
                    console.error(`❌ خطأ في الإرسال لـ ${userId}:`, err);
                });
        });

        await Promise.all(sendPromises);
        console.log(`✅ تم إرسال ${validTokens.length} إشعار`);

    } catch (err) {
        console.error('❌ خطأ في إرسال الإشعارات:', err);
    }
}

// ✅ إرسال الرسالة
async function sendMessage(req, res) {
  const { text, uid, token, day } = req.body;

  if (!text || !uid || !day) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }

  try {
    await auth.verifyIdToken(token);

    const identity = await getIdentity(uid);

    let messageType = 'normal';
    let isSecret = false;
    let isConfession = false;

    if (text.startsWith('#اعتراف')) {
      isConfession = true;
      text = text.replace('#اعتراف', '').trim();
    } else if (text.startsWith('#سر')) {
      isSecret = true;
      text = text.replace('#سر', '').trim();
    }

    const msgRef = db.ref(`messages/global/${day}`).push();
    const msgData = {
      text: text,
      sender: identity.ghostName,
      uid: uid,
      timestamp: new Date().getTime(),
      isSecret: isSecret,
      isConfession: isConfession,
      deleted: false,
      edited: false
    };

    await msgRef.set(msgData);
    console.log(`✅ رسالة مرسلة: ${msgRef.key}`);

    const recentMessagesSnap = await db.ref(`messages/global/${day}`).get();
    let recentMessageCount = 1;

    if (recentMessagesSnap.exists()) {
      const messages = recentMessagesSnap.val();
      const now = new Date().getTime();
      const fiveMinutesAgo = now - (5 * 60 * 1000);

      recentMessageCount = Object.values(messages)
        .filter(msg => msg.timestamp > fiveMinutesAgo && !msg.deleted)
        .length;
    }

    const usersOnlineSnap = await db.ref('users_online').get();
    const activeUsers = usersOnlineSnap.exists() ? Object.keys(usersOnlineSnap.val()) : [];
    const validRecipients = activeUsers.filter(u => u !== uid);

    if (validRecipients.length > 0) {
      const notificationTitle = recentMessageCount > 1 
        ? `💬 ${recentMessageCount} رسائل جديدة`
        : `💬 ${identity.ghostName}`;

      const notificationBody = text.substring(0, 100) + (text.length > 100 ? '...' : '');

      await sendGroupedNotifications(
        notificationTitle,
        notificationBody,
        validRecipients,
        recentMessageCount
      );
    }

    return res.status(200).json({
      success: true,
      msgId: msgRef.key,
      message: "✅ تم إرسال الهمسة",
      notificationCount: recentMessageCount
    });

  } catch (error) {
    console.error("❌ Send Error:", error);
    return res.status(500).json({ error: "فشل الإرسال" });
  }
}

// ✅ الحصول على الهوية
async function getIdentityAction(req, res) {
  const { uid, token } = req.body;

  try {
    await auth.verifyIdToken(token);
    const identity = await getIdentity(uid);

    return res.status(200).json({
      ghostName: identity.ghostName,
      rank: identity.rank,
      activeDay: identity.activeDay,
      welcomeCard: {
        show: true,
        message: `👻 مرحباً ${identity.ghostName}... هنا تحت الظلام، أنت بين الأشباح. لا أحد يعرفك، لكن الجميع يسمعك.`
      }
    });
  } catch (error) {
    console.error("❌ Identity Error:", error);
    return res.status(401).json({ error: "خطأ في التحقق" });
  }
}

// ✅ حذف الرسالة
async function deleteMessage(req, res) {
  const { msgId, uid, token, day } = req.body;

  try {
    await auth.verifyIdToken(token);
    await db.ref(`messages/global/${day}/${msgId}`).update({ deleted: true });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "خطأ في الحذف" });
  }
}

// ✅ تعديل الرسالة
async function editMessage(req, res) {
  const { msgId, text, uid, token, day } = req.body;

  try {
    await auth.verifyIdToken(token);
    await db.ref(`messages/global/${day}/${msgId}`).update({ 
      text: text,
      edited: true,
      editedAt: new Date().getTime()
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "خطأ في التعديل" });
  }
}

// ✅ الإبلاغ عن الرسالة
async function reportMessage(req, res) {
  const { msgId, reason, uid, token, day } = req.body;

  try {
    await auth.verifyIdToken(token);
    await db.ref(`reports/${msgId}`).set({
      msgId: msgId,
      reason: reason,
      reportedBy: uid,
      day: day,
      timestamp: new Date().getTime()
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "خطأ في الإبلاغ" });
  }
}

// ✅ معالج رئيسي
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action } = req.body;

  try {
    if (action === 'GET_IDENTITY') {
      return getIdentityAction(req, res);
    } else if (action === 'DELETE') {
      return deleteMessage(req, res);
    } else if (action === 'EDIT') {
      return editMessage(req, res);
    } else if (action === 'REPORT') {
      return reportMessage(req, res);
    } else {
      return sendMessage(req, res);
    }
  } catch (err) {
    console.error("❌ Handler Error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
}
