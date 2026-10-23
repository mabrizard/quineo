export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_DEVICES = 3;

async function db(path, method='GET', body=null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method==='POST' ? 'return=representation' : (method==='PATCH' ? 'return=representation' : ''),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  return res.status === 204 ? null : res.json();
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `QUINEO-${part()}-${part()}-${part()}`;
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  };
  if (req.method === 'OPTIONS') return new Response(null, {status:200,headers});
  if (req.method !== 'POST') return new Response('Method not allowed', {status:405});

  const body = await req.json();
  const { action, code, fingerprint } = body;
  const adminKey = req.headers.get('x-admin-key');
  const isAdmin = adminKey === process.env.ADMIN_SECRET_KEY;

  try {
    // ── VERIFY : activer / vérifier un code (permanent ou early adopter) ──
    if (action === 'verify') {
      if (!code || !fingerprint) return new Response(JSON.stringify({valid:false,error:'Paramètres manquants'}), {status:400,headers});
      const normalized = code.trim().toUpperCase();

      // 1. Chercher dans les codes permanents
      const perms = await db(`licenses_permanent?code=eq.${encodeURIComponent(normalized)}&select=*`);
      if (perms?.length > 0) {
        const lic = perms[0];
        if (lic.revoked) return new Response(JSON.stringify({valid:false,error:'Ce code a été désactivé'}), {status:403,headers});
        const fps = lic.fingerprints || [];
        if (fps.includes(fingerprint)) return new Response(JSON.stringify({valid:true,type:'permanent',message:'Licence active'}), {headers});
        if (fps.length >= MAX_DEVICES) return new Response(JSON.stringify({valid:false,error:`Limite de ${MAX_DEVICES} appareils atteinte`}), {status:403,headers});
        await db(`licenses_permanent?code=eq.${encodeURIComponent(normalized)}`, 'PATCH', {fingerprints:[...fps,fingerprint],last_used:new Date().toISOString()});
        return new Response(JSON.stringify({valid:true,type:'permanent',message:`Activé (${fps.length+1}/${MAX_DEVICES} appareils)`}), {headers});
      }

      // 2. Chercher dans les early adopters
      const eas = await db(`early_adopters?code=eq.${encodeURIComponent(normalized)}&select=*`);
      if (eas?.length > 0) {
        const ea = eas[0];
        // Vérifier expiration
        if (new Date(ea.expires_at) < new Date()) {
          return new Response(JSON.stringify({valid:false,error:'Ce code Pionnier a expiré. Passez à la version Premium pour continuer.'}), {status:403,headers});
        }
        // Marquer comme activé
        if (!ea.activated) {
          await db(`early_adopters?code=eq.${encodeURIComponent(normalized)}`, 'PATCH', {activated:true,activated_at:new Date().toISOString(),fingerprint});
        }
        const expDate = new Date(ea.expires_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
        return new Response(JSON.stringify({valid:true,type:'early_adopter',expiresAt:ea.expires_at,message:`Accès Pionnier valide jusqu'au ${expDate}`}), {headers});
      }

      return new Response(JSON.stringify({valid:false,error:'Code invalide ou inexistant'}), {status:404,headers});
    }

    // ── GENERATE : créer un code permanent (admin) ──
    if (action === 'generate') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Non autorisé'}), {status:401,headers});
      let newCode = generateCode();
      let attempts = 0;
      while (attempts < 5) {
        const clash = await db(`licenses_permanent?code=eq.${newCode}&select=code`);
        if (!clash?.length) break;
        newCode = generateCode();
        attempts++;
      }
      await db('licenses_permanent', 'POST', {code:newCode,created_at:new Date().toISOString(),fingerprints:[],revoked:false,source:body.source||'admin'});
      return new Response(JSON.stringify({code:newCode}), {headers});
    }

    // ── LIST : lister tous les codes (admin) ──
    if (action === 'list') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Non autorisé'}), {status:401,headers});
      const perms = await db('licenses_permanent?select=*&order=created_at.desc') || [];
      const eas = await db('early_adopters?select=*&order=created_at.desc') || [];
      // Récupérer le statut ON/OFF
      const settings = await db('ea_settings?key=eq.early_adopters_open&select=value');
      const earlyOpen = settings?.[0]?.value === 'true';
      return new Response(JSON.stringify({licenses:perms,earlyAdopters:eas,earlyOpen,count:perms.length,earlyCount:eas.length}), {headers});
    }

    // ── CHECK_EARLY_STATUS : vérifier si inscriptions ouvertes (public) ──
    if (action === 'check_early_status') {
      const settings = await db('ea_settings?key=eq.early_adopters_open&select=value');
      const earlyOpen = settings?.[0]?.value === 'true';
      return new Response(JSON.stringify({earlyOpen}), {headers});
    }

    // ── TOGGLE : activer/désactiver les inscriptions early adopters (admin) ──
    if (action === 'toggle_early') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Non autorisé'}), {status:401,headers});
      const {open} = body;
      // Upsert dans ea_settings (on=conflict pour éviter doublons)
      await db('ea_settings?on_conflict=key', 'POST', {key:'early_adopters_open',value:open?'true':'false'});
      return new Response(JSON.stringify({ok:true,earlyOpen:open}), {headers});
    }

    // ── REVOKE : révoquer un code permanent (admin) ──
    if (action === 'revoke') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Non autorisé'}), {status:401,headers});
      await db(`licenses_permanent?code=eq.${encodeURIComponent(body.code)}`, 'PATCH', {revoked:true});
      return new Response(JSON.stringify({ok:true}), {headers});
    }

    return new Response(JSON.stringify({error:'Action inconnue'}), {status:400,headers});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers});
  }
}
