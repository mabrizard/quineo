export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

// ── Colonne attendue pour un nombre n (0-8) ──────────────────────────────────
function expectedCol(n) {
  return n <= 9 ? 0 : n >= 80 ? 8 : Math.floor(n / 10);
}

// ── Normalise un token OCR → nombre 1-90 ou null ─────────────────────────────
function parseOcrToken(text) {
  if (!text) return null;
  // Garde chiffres, remplace O/o→0, I/l→1
  const clean = text.replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/\D/g,'').trim();
  if (!clean) return null;
  const n = parseInt(clean, 10);
  if (isNaN(n) || n < 1 || n > 90) return null;
  return n;
}

// ── Appel Vision API générique ────────────────────────────────────────────────
async function visionAnnotate(apiKey, requests) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
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

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY not set' });

  const { cells, image, mode } = req.body;

  try {

    // ── MODE "document" : image carton entière → DOCUMENT_TEXT_DETECTION ───────
    // Renvoie { words: [{text, x, y, w, h}] } avec coordonnées normalisées 0-1
    if (mode === 'document' || (image && !cells)) {
      const data = await visionAnnotate(apiKey, [{
        image: { content: image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 200 }],
      }]);

      const page = data.responses?.[0]?.fullTextAnnotation?.pages?.[0];
      const imgW = page?.width || 1;
      const imgH = page?.height || 1;

      // Extraire tous les mots avec leur bounding box normalisée
      const words = [];
      for (const block of (page?.blocks || [])) {
        for (const para of (block.paragraphs || [])) {
          for (const word of (para.words || [])) {
            const txt = word.symbols?.map(s => s.text).join('') || '';
            const verts = word.boundingBox?.vertices || [];
            if (!verts.length) continue;
            const xs = verts.map(v => v.x || 0);
            const ys = verts.map(v => v.y || 0);
            const x = Math.min(...xs) / imgW;
            const y = Math.min(...ys) / imgH;
            const w = (Math.max(...xs) - Math.min(...xs)) / imgW;
            const h = (Math.max(...ys) - Math.min(...ys)) / imgH;
            const conf = word.confidence ?? 1;
            words.push({ text: txt, x, y, w, h, conf });
          }
        }
      }

      return res.status(200).json({ words, imgW, imgH });
    }

    // ── MODE "cells" : OCR ciblé sur cellules douteuses ──────────────────────
    // Même logique qu'avant MAIS avec DOCUMENT_TEXT_DETECTION
    if (cells && Array.isArray(cells)) {
      const BATCH = 16;
      const allResults = [];

      for (let i = 0; i < cells.length; i += BATCH) {
        const batch = cells.slice(i, i + BATCH);
        const data = await visionAnnotate(apiKey, batch.map(cell => ({
          image: { content: cell.b64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 5 }],
        })));

        (data.responses || []).forEach((r, idx) => {
          const cell = batch[idx];
          // Récupère tous les symboles pour reconstruire le nombre même si collé
          const fullText = r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description || '';
          const n = parseOcrToken(fullText);
          allResults.push({
            row: cell.row,
            col: cell.col,
            text: fullText.trim(),
            n,                        // nombre parsé ou null
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
