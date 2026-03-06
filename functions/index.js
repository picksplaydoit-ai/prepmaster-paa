const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const Stripe    = require('stripe');
const cors      = require('cors')({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// ── CORS wrapper ─────────────────────────────────────────────────────────────
function withCORS(handler) {
  return (req, res) => cors(req, res, () => handler(req, res));
}

// ── 1. CREATE STRIPE CHECKOUT SESSION ────────────────────────────────────────
exports.createCheckout = functions.https.onRequest(withCORS(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    const { email, uid } = req.body;
    if (!email || !uid) { res.status(400).json({ error: 'Faltan datos' }); return; }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'mxn',
          unit_amount: 8900,
          product_data: {
            name: 'PrepMaster PAA — Acceso 3 meses',
            description: 'Acceso completo: simulaciones, supervivencia, lectura rápida y guías de respuestas.',
          },
        },
        quantity: 1,
      }],
      metadata: { uid, email },
      success_url: 'https://prepmaster-paa.vercel.app/pago-exitoso.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://prepmaster-paa.vercel.app/?cancelled=true',
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('createCheckout error:', err);
    res.status(500).json({ error: err.message });
  }
}));

// ── 2. STRIPE WEBHOOK ────────────────────────────────────────────────────────
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    res.status(400).send(`Webhook error: ${err.message}`);
    return;
  }

  if (event.type !== 'checkout.session.completed') {
    res.status(200).send('Ignored');
    return;
  }

  const session = event.data.object;
  const { uid, email } = session.metadata;
  if (!uid) { res.status(400).send('Missing uid'); return; }

  try {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
    await db.collection('subscriptions').doc(uid).set({
      active: true, email,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      plan: '3_meses', priceMXN: 89,
      stripeSessionId: session.id,
      createdAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    console.log(`✅ Suscripción activada: ${email} (${uid})`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Firestore error:', err);
    res.status(500).send(err.message);
  }
});

// ── 3. ACTIVATE FREE CODE ────────────────────────────────────────────────────
exports.activateFree = functions.https.onRequest(withCORS(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    const { uid, email, code } = req.body;
    if (!uid || !email || !code) { res.status(400).json({ error: 'Faltan datos.' }); return; }

    const codeKey = code.trim().toUpperCase();
    const codeRef = db.collection('access_codes').doc(codeKey);

    const result = await db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) return { error: 'Código de acceso inválido.' };
      const data = codeSnap.data();
      if (data.used) return { error: 'Este código ya fue utilizado.' };
      tx.update(codeRef, { used: true, usedBy: email, usedByUid: uid, usedAt: admin.firestore.Timestamp.now() });
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 3);
      tx.set(db.collection('subscriptions').doc(uid), {
        active: true, email,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        plan: 'codigo_gratis', priceMXN: 0, code: codeKey,
        createdAt: admin.firestore.Timestamp.now(),
      }, { merge: true });
      return { ok: true };
    });

    if (result.error) { res.status(403).json({ error: result.error }); return; }
    console.log(`✅ Código ${codeKey} usado por ${email}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('activateFree error:', err);
    res.status(500).json({ error: err.message });
  }
}));
