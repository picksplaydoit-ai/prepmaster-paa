const Stripe = require('stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { email, uid } = JSON.parse(event.body);
    if (!email || !uid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos' }) };
    }

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
      success_url: 'https://preparacion-pro-udg.netlify.app/pago-exitoso.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://preparacion-pro-udg.netlify.app/?cancelled=true',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('create-checkout error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
