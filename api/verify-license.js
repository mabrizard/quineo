// Stockage simple via Vercel KV (Redis) — à activer plus tard
// Pour l'instant : stockage en mémoire de fallback (perdu à chaque redeploy)
// TODO: remplacer par Vercel KV quand le compte sera configuré

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

// ⚠️ TEMPORAIRE : stockage en mémoire (non persistant entre déploiements)
// À remplacer par Vercel KV / Upstash Redis pour la production
const MEMORY_STORE = globalThis.__quineoLicenses || (globalThis.__quineoLicenses = new Map());

const MAX_DEVICES = 3;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 pour éviter confusion
  const part = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `QUINEO-${part()}-${part()}-${part()}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, code, fingerprint } = req.body || {};

  try {
    // ── Action: vérifier / activer un code ──
    if (action === 'verify') {
      if (!code || !fingerprint) {
        return res.status(400).json({ valid: false, error: 'Code et fingerprint requis' });
      }

      const normalized = code.trim().toUpperCase();
      const license = MEMORY_STORE.get(normalized);

      if (!license) {
        return res.status(404).json({ valid: false, error: 'Code invalide ou inexistant' });
      }

      if (license.revoked) {
        return res.status(403).json({ valid: false, error: 'Ce code a été désactivé' });
      }

      // Already activated on this device
      if (license.fingerprints.includes(fingerprint)) {
        return res.status(200).json({ valid: true, message: 'Licence déjà active sur cet appareil' });
      }

      // New device - check limit
      if (license.fingerprints.length >= MAX_DEVICES) {
        return res.status(403).json({
          valid: false,
          error: `Ce code a atteint sa limite de ${MAX_DEVICES} appareils. Contactez le support si besoin.`
        });
      }

      // Activate on this new device
      license.fingerprints.push(fingerprint);
      license.lastUsed = new Date().toISOString();
      MEMORY_STORE.set(normalized, license);

      return res.status(200).json({
        valid: true,
        message: `Licence activée (${license.fingerprints.length}/${MAX_DEVICES} appareils)`
      });
    }

    // ── Action: générer un nouveau code (admin only, protégé par clé secrète) ──
    if (action === 'generate') {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      let newCode = generateCode();
      while (MEMORY_STORE.has(newCode)) newCode = generateCode(); // avoid collision

      MEMORY_STORE.set(newCode, {
        createdAt: new Date().toISOString(),
        fingerprints: [],
        revoked: false,
        source: req.body.source || 'manual',
      });

      return res.status(200).json({ code: newCode });
    }

    // ── Action: lister les codes (debug admin) ──
    if (action === 'list') {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Non autorisé' });
      }
      const all = Array.from(MEMORY_STORE.entries()).map(([code, data]) => ({ code, ...data }));
      return res.status(200).json({ licenses: all, count: all.length });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
