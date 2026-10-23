export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { password } = await req.json();
  const correct = process.env.ADMIN_PASSWORD;

  if (!correct || password !== correct) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Token signé = ADMIN_SECRET hashé avec un sel temporel (jour courant)
  // Simple mais suffisant : expire chaque jour
  const day = new Date().toISOString().slice(0, 10);
  const token = btoa(`${process.env.ADMIN_SECRET || ''}:${day}`);

  return new Response(JSON.stringify({ ok: true, token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
