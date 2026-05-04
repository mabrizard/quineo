export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY not set' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [{ type: 'TEXT_DETECTION', maxResults: 200 }],
            imageContext: { languageHints: ['fr'] }
          }]
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    const annotations = data.responses?.[0]?.textAnnotations || [];

    // ── annotations[0] = bloc complet, son .description contient TOUTES les
    // lignes séparées par \n, dans l'ordre visuel top→bottom tel que Vision
    // les a détectées. C'est exactement ce dont on a besoin pour reconstruire
    // les 3 lignes d'un carton sans recalculer des coordonnées Y.
    const lines = annotations.length > 0
      ? annotations[0].description
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0)
      : [];

    // ── words = annotations individuels (slice(1)) avec leurs bounding boxes,
    // conservés comme fallback et pour d'éventuels usages futurs.
    const words = annotations.slice(1).map(a => {
      const xs = a.boundingPoly.vertices.map(v => v.x || 0);
      const ys = a.boundingPoly.vertices.map(v => v.y || 0);
      const x = Math.min(...xs), y = Math.min(...ys);
      return {
        text: a.description,
        x, y,
        w: Math.max(...xs) - x,
        h: Math.max(...ys) - y,
      };
    });

    return res.status(200).json({ words, lines });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
