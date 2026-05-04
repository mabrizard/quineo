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

  const { image } = req.body; // base64 JPEG
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

    // Extract text annotations with bounding boxes
    const annotations = data.responses?.[0]?.textAnnotations || [];
    // Skip first annotation (full text), keep individual words
    const words = annotations.slice(1).map(a => ({
      text: a.description,
      x: Math.min(...a.boundingPoly.vertices.map(v => v.x || 0)),
      y: Math.min(...a.boundingPoly.vertices.map(v => v.y || 0)),
      w: Math.max(...a.boundingPoly.vertices.map(v => v.x || 0)) - Math.min(...a.boundingPoly.vertices.map(v => v.x || 0)),
      h: Math.max(...a.boundingPoly.vertices.map(v => v.y || 0)) - Math.min(...a.boundingPoly.vertices.map(v => v.y || 0)),
    }));

    return res.status(200).json({ words });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
