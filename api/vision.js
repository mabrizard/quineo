export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

function expectedCol(n) {
  return n <= 9 ? 0 : n >= 80 ? 8 : Math.floor(n / 10);
}

function parseOcrToken(text) {
  if (!text) return null;
  const clean = text.replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/\D/g,'').trim();
  if (!clean) return null;
  const n = parseInt(clean, 10);
  if (isNaN(n) || n < 1 || n > 90) return null;
  return n;
}

async function visionAnnotate(apiKey, requests) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({requests}) }
  );
  if (!response.ok) {
    const err = await response.json().catch(()=>({}));
    throw new Error(err.error?.message || `Vision API HTTP ${response.status}`);
  }
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey    = process.env.GOOGLE_VISION_API_KEY;
  const { cells, image, mode } = req.body;

  try {

    // MODE "detect" : Claude localise la grille de jeu dans la photo
    if (mode === 'detect') {
      if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: [
              { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:image } },
              { type:'text', text:`Cette photo contient un carton de loto français (grille 9 colonnes x 3 lignes).
Trouve le rectangle qui contient exactement la grille de jeu (les cellules avec les numéros), sans le fond autour.
Réponds UNIQUEMENT avec un objet JSON sur une seule ligne, sans texte autour :
{"x":0.12,"y":0.25,"w":0.76,"h":0.50}
x et y = coin haut-gauche, w = largeur, h = hauteur. Toutes les valeurs sont des fractions entre 0 et 1.` }
            ],
          }],
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.json().catch(()=>({}));
        throw new Error(err.error?.message || `Claude API HTTP ${claudeRes.status}`);
      }

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.find(b => b.type==='text')?.text || '';
      const match = text.match(/\{[^}]+\}/);
      if (!match) throw new Error('Claude n\'a pas retourné de coordonnées valides');

      const box = JSON.parse(match[0]);
      if (typeof box.x !== 'number' || typeof box.y !== 'number' ||
          typeof box.w !== 'number' || typeof box.h !== 'number')
        throw new Error('Coordonnées invalides');

      box.x = Math.max(0, Math.min(1, box.x));
      box.y = Math.max(0, Math.min(1, box.y));
      box.w = Math.max(0.1, Math.min(1 - box.x, box.w));
      box.h = Math.max(0.1, Math.min(1 - box.y, box.h));

      return res.status(200).json({ box });
    }

    // MODE "document" : Google Vision DOCUMENT_TEXT_DETECTION sur image recadrée
    if (mode === 'document' || (image && !cells)) {
      if (!googleKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY not set' });

      const data = await visionAnnotate(googleKey, [{
        image: { content: image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 200 }],
      }]);

      const page = data.responses?.[0]?.fullTextAnnotation?.pages?.[0];
      const imgW = page?.width || 1;
      const imgH = page?.height || 1;

      const words = [];
      for (const block of (page?.blocks || [])) {
        for (const para of (block.paragraphs || [])) {
          for (const word of (para.words || [])) {
            const txt = word.symbols?.map(s => s.text).join('') || '';
            const verts = word.boundingBox?.vertices || [];
            if (!verts.length) continue;
            const xs = verts.map(v => v.x || 0);
            const ys = verts.map(v => v.y || 0);
            words.push({
              text: txt,
              x: Math.min(...xs) / imgW,
              y: Math.min(...ys) / imgH,
              w: (Math.max(...xs) - Math.min(...xs)) / imgW,
              h: (Math.max(...ys) - Math.min(...ys)) / imgH,
              conf: word.confidence ?? 1,
            });
          }
        }
      }

      return res.status(200).json({ words, imgW, imgH });
    }

    // MODE "cells" : OCR ciblé sur cellules douteuses
    if (cells && Array.isArray(cells)) {
      if (!googleKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY not set' });

      const BATCH = 16;
      const allResults = [];

      for (let i = 0; i < cells.length; i += BATCH) {
        const batch = cells.slice(i, i + BATCH);
        const data = await visionAnnotate(googleKey, batch.map(cell => ({
          image: { content: cell.b64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 5 }],
        })));

        (data.responses || []).forEach((r, idx) => {
          const cell = batch[idx];
          const fullText = r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description || '';
          const n = parseOcrToken(fullText);
          allResults.push({
            row: cell.row, col: cell.col,
            text: fullText.trim(), n,
            valid: n !== null && expectedCol(n) === cell.col,
            conf: r.textAnnotations?.[0] ? 1 : 0,
          });
        });
      }

      return res.status(200).json({ results: allResults });
    }

    return res.status(400).json({ error: 'Provide cells or image' });

  } catch (err) {
    console.error('Vision handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
