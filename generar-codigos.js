/**
 * generar-codigos.js
 * 
 * Ejecuta este script UNA vez desde tu computadora para crear
 * los códigos de acceso gratuito en Firestore.
 * 
 * USO:
 *   1. npm install firebase-admin
 *   2. Descarga tu serviceAccountKey.json de Firebase Console
 *      (Configuración → Cuentas de servicio → Generar nueva clave privada)
 *   3. Pon ese archivo en la misma carpeta que este script
 *   4. node generar-codigos.js
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');

// ── CONFIGURA AQUÍ ───────────────────────────────────────────────────────────
const SERVICE_ACCOUNT = require('./serviceAccountKey.json'); // tu archivo descargado
const CANTIDAD = 20;      // cuántos códigos generar
const PREFIJO  = 'PM';    // prefijo de los códigos, ej: PM-A3F2-K9X1
// ─────────────────────────────────────────────────────────────────────────────

initializeApp({ credential: cert(SERVICE_ACCOUNT) });
const db = getFirestore();

function generarCodigo() {
  const parte1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const parte2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${PREFIJO}-${parte1}-${parte2}`;
}

async function main() {
  console.log(`\nGenerando ${CANTIDAD} códigos con prefijo "${PREFIJO}"...\n`);
  const batch = db.batch();
  const codigos = [];

  for (let i = 0; i < CANTIDAD; i++) {
    const code = generarCodigo();
    codigos.push(code);
    const ref = db.collection('access_codes').doc(code);
    batch.set(ref, {
      used:      false,
      usedBy:    null,
      usedByUid: null,
      usedAt:    null,
      createdAt: Timestamp.now(),
      notes:     '',   // puedes anotar a quién le diste cada código
    });
  }

  await batch.commit();

  console.log('✅ Códigos creados en Firestore (colección: access_codes):\n');
  codigos.forEach(c => console.log('  ', c));
  console.log(`\nTotal: ${codigos.length} códigos listos para distribuir.`);
  console.log('Recuerda: cada código es de un solo uso.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
