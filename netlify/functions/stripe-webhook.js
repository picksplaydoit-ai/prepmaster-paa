const Stripe = require('stripe');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// Initialize Firebase Admin (only once across warm invocations)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Netlify env vars can't have literal \n — replace escaped newlines
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  // Only handle successful payments
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;
  const { uid, email } = session.metadata;

  if (!uid) {
    console.error('No uid in metadata');
    return { statusCode: 400, body: 'Missing uid' };
  }

  try {
    // 3 months from now
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);

    await db.collection('subscriptions').doc(uid).set({
      active:      true,
      email,
      expiresAt:   Timestamp.fromDate(expiresAt),
      plan:        '3_meses',
      priceMXN:    89,
      stripeSessionId: session.id,
      createdAt:   Timestamp.now(),
    }, { merge: true });

    console.log(`✅ Suscripción activada para UID: ${uid} (${email}) hasta ${expiresAt.toISOString()}`);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Firestore error:', err);
    return { statusCode: 500, body: err.message };
  }
};
