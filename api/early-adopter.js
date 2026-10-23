export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const DURATION_DAYS = 30;

function generateEarlyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `EA-${part()}-${part()}`;
}

async function db(path, method='GET', body=null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${err}`);
  }
  return res.status === 204 ? null : res.json();
}

async function sendWelcomeEmail(email, code, expiresAt) {
  const expDate = new Date(expiresAt).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'});
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Quinéo par La Fabrique <onboarding@resend.dev>',
      reply_to: 'mabrizard@gmail.com',
      to: [email],
      subject: '🎱 Votre accès Pionnier Quinéo est prêt !',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1a1a3e,#2d2b6e);padding:32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">🎱</div>
            <h1 style="color:#f5c518;font-size:28px;margin:0;letter-spacing:1px;">Quinéo</h1>
            <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">par La Fabrique Sur-Mesure</p>
          </div>
          <div style="padding:32px;">
            <h2 style="color:#1a1a3e;font-size:20px;margin:0 0 16px;">Bienvenue parmi nos Pionniers ! 🚀</h2>
            <p style="color:#374151;line-height:1.6;">Vous faites partie des premiers utilisateurs de Quinéo. Merci de votre confiance — votre retour est précieux pour nous !</p>
            <p style="color:#374151;line-height:1.6;">Votre accès Pionnier est <strong>gratuit pendant 30 jours</strong>, jusqu'au <strong>${expDate}</strong>.</p>
            <div style="background:#1a1a3e;border-radius:10px;padding:20px;text-align:center;margin:24px 0;">
              <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Votre code d'accès</p>
              <p style="color:#f5c518;font-size:26px;font-weight:bold;letter-spacing:4px;margin:0;font-family:monospace;">${code}</p>
            </div>
            <p style="color:#374151;line-height:1.6;font-size:14px;"><strong>Comment l'utiliser :</strong><br>
              1. Ouvrez <a href="https://quineo.vercel.app" style="color:#6c63ff;">quineo.vercel.app</a><br>
              2. Appuyez sur le bouton <strong>"Pionnier"</strong> ou <strong>"Passer Premium"</strong><br>
              3. Entrez votre code et profitez de toutes les fonctionnalités !
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#9ca3af;font-size:12px;text-align:center;">Une question ? Répondez directement à cet email.<br>Quinéo — La Fabrique Sur-Mesure</p>
          </div>
        </div>
      `
    })
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { email } = await req.json();
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ok:false,error:'Email invalide'}), {status:400,headers:{'Content-Type':'application/json'}});
  }

  try {
    // Vérifier que le registre est ouvert
    const settings = await db('ea_settings?key=eq.early_adopters_open&select=value');
    const isOpen = settings?.[0]?.value === 'true';
    if (!isOpen) {
      return new Response(JSON.stringify({ok:false,error:'Les inscriptions Pionnier sont actuellement fermées.'}), {status:403,headers:{'Content-Type':'application/json'}});
    }

    // Vérifier si cet email est déjà inscrit
    const existing = await db(`early_adopters?email=eq.${encodeURIComponent(email)}&select=code,expires_at`);
    if (existing?.length > 0) {
      return new Response(JSON.stringify({ok:false,error:'Cet email est déjà inscrit. Vérifiez votre boîte mail.'}), {status:409,headers:{'Content-Type':'application/json'}});
    }

    // Générer un code unique
    let code = generateEarlyCode();
    let attempts = 0;
    while (attempts < 5) {
      const clash = await db(`early_adopters?code=eq.${code}&select=code`);
      if (!clash?.length) break;
      code = generateEarlyCode();
      attempts++;
    }

    // Calculer la date d'expiration
    const expiresAt = new Date(Date.now() + DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Enregistrer dans Supabase
    await db('early_adopters', 'POST', {
      email,
      code,
      expires_at: expiresAt,
      activated: false,
      created_at: new Date().toISOString(),
    });

    // Envoyer l'email
    await sendWelcomeEmail(email, code, expiresAt);

    return new Response(JSON.stringify({ok:true,message:'Votre code a été envoyé par email !'}), {headers:{'Content-Type':'application/json'}});

  } catch(e) {
    return new Response(JSON.stringify({ok:false,error:e.message}), {status:500,headers:{'Content-Type':'application/json'}});
  }
}
