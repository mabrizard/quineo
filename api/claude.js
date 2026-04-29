export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const body = req.body;

  // Debug: retourne ce qu'on reçoit et ce qu'on envoie
  const debug = {
    hasBody: !!body,
    bodyType: typeof body,
    hasModel: !!body?.model,
    model: body?.model,
    hasMessages: !!body?.messages,
    messageCount: body?.messages?.length,
    firstMessageRole: body?.messages?.[0]?.role,
    contentTypes: body?.messages?.[0]?.content?.map(c => c.type),
    apiKeyFirst6: apiKey?.slice(0, 6),
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } 
    catch { return res.status(502).json({ error: 'Bad JSON', raw: text.slice(0, 300), debug }); }

    // Si erreur, inclure le debug dans la réponse
    if (!response.ok) {
      return res.status(response.status).json({ ...data, debug });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message, debug });
  }
}
