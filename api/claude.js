export default async function handler(req, res) {
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const log = (...args) => console.log(`[claude:${rid}]`, ...args);
  const fail = (status, error, extra = {}) => {
    log('FAIL', status, error, extra);
    return res.status(status).json({ error, requestId: rid, ...extra });
  };

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    log('start', { method: req.method, url: req.url, hasBody: !!req.body });

    if (req.method === 'OPTIONS') {
      log('cors preflight');
      return res.status(200).end();
    }
    if (req.method !== 'POST') {
      return fail(405, 'Method not allowed');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    log('env', { apiKeyPresent: !!apiKey });
    if (!apiKey) return fail(500, 'ANTHROPIC_API_KEY not set');

    const body = req.body;
    if (!body) return fail(400, 'Empty request body');

    const messages = body.messages;
    const model = body.model || 'claude-3-5-sonnet-20241022';
    const max_tokens = body.max_tokens || 4096;
    log('body parsed', { model, max_tokens, messagesType: Array.isArray(messages) ? 'array' : typeof messages, messagesCount: Array.isArray(messages) ? messages.length : null });

    if (!Array.isArray(messages) || messages.length === 0) {
      return fail(400, 'Invalid request body: messages missing', { keys: Object.keys(body || {}) });
    }

    const payload = { model, max_tokens, messages };
    log('anthropic request', { model, max_tokens, messagesCount: messages.length, firstRole: messages[0]?.role });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    log('anthropic response', { status: response.status, ok: response.ok, rawPreview: raw.slice(0, 500) });

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return fail(502, 'Invalid JSON from Anthropic', { raw: raw.slice(0, 300) });
    }

    if (!response.ok) {
      return fail(response.status, data?.error?.message || data?.message || 'Anthropic API error', { details: data });
    }

    log('success');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[claude:unhandled]', err);
    return res.status(500).json({ error: err.message, requestId: rid, stack: err.stack?.slice(0, 500) });
  }
}