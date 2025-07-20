// initUser.js
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    const userRef = db.collection("users").doc(user.uid);

    userRef.get().then((doc) => {
      if (!doc.exists) {
        userRef.set({
          name: user.displayName || "مستخدم",
          email: user.email,
          points: 0,
          joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          console.log("📦 تم إنشاء حساب المستخدم بنجاح في Firestore");
        }).catch((error) => {
          console.error("❌ خطأ أثناء إنشاء الحساب:", error);
        });
      } else {
        console.log("✅ المستخدم موجود بالفعل في قاعدة البيانات");
      }
    });
  }
});
