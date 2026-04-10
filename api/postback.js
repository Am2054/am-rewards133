// api/postback.js
export default async function handler(req, res) {
  const { player_id, amount, status } = req.query;

  if (status === '1') {
    // هنا هتحط كود التحديث بتاع Firestore اللي إنت متعود عليه
    // زي ما بنعمل في Firebase العادي
    return res.status(200).send('OK');
  }
  
  return res.status(400).send('Invalid');
}
