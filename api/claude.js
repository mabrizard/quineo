export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    // Vercel limite la taille du body — vérification explicite
    const body = req.body;
    if (!body || !body.messages) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'Invalid JSON from Anthropic', raw: text.slice(0,200) }); }

    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0,300) });
  }
}
