const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { uid, email, code } = JSON.parse(event.body);
    if (!uid || !email || !code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos.' }) };
    }

    const codeKey = code.trim().toUpperCase();
    const codeRef = db.collection('access_codes').doc(codeKey);

    // Transaction: validate + mark used + activate subscription atomically
    const result = await db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);

      if (!codeSnap.exists()) {
        return { error: 'Código de acceso inválido.' };
      }

      const codeData = codeSnap.data();

      if (codeData.used) {
        return { error: 'Este código ya fue utilizado.' };
      }

      // Mark code as used
      tx.update(codeRef, {
        used:      true,
        usedBy:    email,
        usedByUid: uid,
        usedAt:    Timestamp.now(),
      });

      // Activate 3-month subscription
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 3);
      tx.set(db.collection('subscriptions').doc(uid), {
        active:    true,
        email,
        expiresAt: Timestamp.fromDate(expiresAt),
        plan:      'codigo_gratis',
        priceMXN:  0,
        code:      codeKey,
        createdAt: Timestamp.now(),
      }, { merge: true });

      return { ok: true };
    });

    if (result.error) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: result.error }) };
    }

    console.log(`✅ Código ${codeKey} usado por ${email} (uid: ${uid})`);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('activate-free error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
