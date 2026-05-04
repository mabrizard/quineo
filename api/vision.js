export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY not set' });

  const { cells, image } = req.body;

  try {
    // ── Mode cellules (27 cases individuelles) ──
    if (cells && Array.isArray(cells)) {
      // Google Vision batch: max 16 per request, so split into 2 calls
      const BATCH = 16;
      const allResults = [];

      for (let i = 0; i < cells.length; i += BATCH) {
        const batch = cells.slice(i, i + BATCH);
        const response = await fetch(
          `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: batch.map(cell => ({
                image: { content: cell.b64 },
                features: [{ type: 'TEXT_DETECTION', maxResults: 5 }],
              }))
            })
          }
        );

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return res.status(response.status).json({ error: err.error?.message || 'Vision API error' });
        }

        const data = await response.json();
        const responses = data.responses || [];

        responses.forEach((r, idx) => {
          const cell = batch[idx];
          // Get the first text annotation (most confident full text)
          const text = r.textAnnotations?.[0]?.description || '';
          allResults.push({ row: cell.row, col: cell.col, text: text.trim() });
        });
      }

      return res.status(200).json({ results: allResults });
    }

    // ── Mode image entière (fallback) ──
    if (image) {
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: image },
              features: [{ type: 'TEXT_DETECTION', maxResults: 200 }],
            }]
          })
        }
      );
      const data = await response.json();
      const annotations = data.responses?.[0]?.textAnnotations || [];
      const words = annotations.slice(1).map(a => ({
        text: a.description,
        x: Math.min(...a.boundingPoly.vertices.map(v => v.x || 0)),
        y: Math.min(...a.boundingPoly.vertices.map(v => v.y || 0)),
        w: Math.max(...a.boundingPoly.vertices.map(v => v.x || 0)) - Math.min(...a.boundingPoly.vertices.map(v => v.x || 0)),
        h: Math.max(...a.boundingPoly.vertices.map(v => v.y || 0)) - Math.min(...a.boundingPoly.vertices.map(v => v.y || 0)),
      }));
      return res.status(200).json({ words });
    }

    return res.status(400).json({ error: 'Provide cells or image' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
