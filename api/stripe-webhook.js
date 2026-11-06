export const config = { runtime: 'edge' };

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// ── Supabase helper ──────────────────────────────────────────────
async function db(path, method='GET', body=null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method==='POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`Supabase ${method} ${path}: ${e}`); }
  return res.status === 204 ? null : res.json();
}

// ── Génération code permanent ────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `QUINEO-${part()}-${part()}-${part()}`;
}

// ── Email de confirmation d'achat ────────────────────────────────
async function sendPurchaseEmail(email, code, name) {
  const displayName = name ? name.split(' ')[0] : 'cher client';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Quinéo par La Fabrique <onboarding@resend.dev>',
      reply_to: 'mabrizard@gmail.com',
      to: [email],
      subject: '✨ Votre licence Quinéo Premium est prête !',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1a1a3e,#2d2b6e);padding:32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">🎱</div>
            <h1 style="color:#f5c518;font-size:28px;margin:0;letter-spacing:1px;">Quinéo</h1>
            <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">par La Fabrique Sur-Mesure</p>
          </div>
          <div style="padding:32px;">
            <h2 style="color:#1a1a3e;font-size:20px;margin:0 0 12px;">Merci ${displayName} ! Bienvenue en Premium ✨</h2>
            <p style="color:#374151;line-height:1.6;">Votre paiement a bien été reçu. Voici votre licence Quinéo Premium — <strong>accès à vie</strong>, utilisable sur jusqu'à 3 appareils.</p>
            <div style="background:#1a1a3e;border-radius:10px;padding:20px;text-align:center;margin:24px 0;">
              <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Votre code de licence</p>
              <p style="color:#f5c518;font-size:22px;font-weight:bold;letter-spacing:3px;margin:0;font-family:monospace;">${code}</p>
            </div>
            <p style="color:#374151;line-height:1.6;font-size:14px;"><strong>Activer votre licence :</strong><br>
              1. Ouvrez <a href="https://quineo.vercel.app" style="color:#6c63ff;">quineo.vercel.app</a><br>
              2. Menu <strong>···</strong> → <strong>Passer Premium</strong><br>
              3. Entrez votre code et profitez de Quinéo sans limite !
            </p>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:20px 0;">
              <p style="color:#166534;font-size:13px;margin:0;line-height:1.5;">
                💡 <strong>Conservez cet email</strong> — votre code est unique et vous permet de réactiver Quinéo sur un nouvel appareil à tout moment.
              </p>
            </div>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#9ca3af;font-size:12px;text-align:center;">
              Un problème ? Répondez directement à cet email.<br>
              Quinéo — La Fabrique Sur-Mesure
            </p>
          </div>
        </div>
      `
    })
  });
}

// ── Vérification signature Stripe (Edge-compatible) ──────────────
async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) throw new Error('Signature Stripe invalide');

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);
  const signed = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const hex = Array.from(new Uint8Array(mac)).map(b=>b.toString(16).padStart(2,'0')).join('');

  if (hex !== signature) throw new Error('Signature Stripe incorrecte');

  // Vérifier que l'événement n'est pas trop vieux (5 min)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) throw new Error('Événement Stripe expiré');
}

// ── Handler principal ────────────────────────────────────────────
export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json' };

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const payload = await req.text();
  const sigHeader = req.headers.get('stripe-signature');

  // Vérifier la signature webhook
  try {
    await verifyStripeSignature(payload, sigHeader, WEBHOOK_SECRET);
  } catch(e) {
    return new Response(JSON.stringify({error:`Signature invalide: ${e.message}`}), {status:400,headers});
  }

  const event = JSON.parse(payload);

  // On ne traite que les paiements réussis
  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
    return new Response(JSON.stringify({received:true}), {headers});
  }

  try {
    // Extraire email et nom depuis l'événement Stripe
    let email, name;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      email = session.customer_details?.email || session.customer_email;
      name  = session.customer_details?.name || '';
    } else {
      // payment_intent.succeeded — récupérer les détails via l'API Stripe
      const piId = event.data.object.id;
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}?expand[]=customer`, {
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` }
      });
      const pi = await piRes.json();
      email = pi.receipt_email || pi.customer?.email;
      name  = pi.customer?.name || '';
    }

    if (!email) {
      console.error('Webhook Stripe : pas d\'email dans l\'événement', event.id);
      return new Response(JSON.stringify({error:'Email manquant'}), {status:400,headers});
    }

    // Vérifier si cet email a déjà un code (idempotence)
    const existing = await db(`licenses_permanent?source=eq.stripe&select=code`, 'GET');
    // Chercher plus précisément par metadata si disponible
    const stripeEventId = event.id;
    const dupCheck = await db(`licenses_permanent?source=eq.stripe_${stripeEventId}&select=code`);
    if (dupCheck?.length > 0) {
      // Déjà traité — idempotent
      return new Response(JSON.stringify({received:true,duplicate:true}), {headers});
    }

    // Générer un code unique
    let code = generateCode();
    let attempts = 0;
    while (attempts < 5) {
      const clash = await db(`licenses_permanent?code=eq.${code}&select=code`);
      if (!clash?.length) break;
      code = generateCode();
      attempts++;
    }

    // Enregistrer la licence
    await db('licenses_permanent', 'POST', {
      code,
      created_at: new Date().toISOString(),
      fingerprints: [],
      revoked: false,
      source: `stripe_${stripeEventId}`,
      last_used: null,
    });

    // Envoyer l'email avec le code
    await sendPurchaseEmail(email, code, name);

    return new Response(JSON.stringify({received:true,code}), {headers});

  } catch(e) {
    console.error('Webhook Stripe erreur:', e.message);
    return new Response(JSON.stringify({error:e.message}), {status:500,headers});
  }
}
