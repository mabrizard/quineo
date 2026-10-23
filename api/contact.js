export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { name, email, message } = await req.json();
  if (!name || !message) return new Response(JSON.stringify({ok:false,error:'Champs manquants'}), {status:400,headers:{'Content-Type':'application/json'}});

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return new Response(JSON.stringify({ok:false,error:'Config manquante'}), {status:500,headers:{'Content-Type':'application/json'}});

  const body = {
    from: 'Quinéo Contact <contact@quineo.fr>',
    to: ['mabrizard@gmail.com'],
    reply_to: email || undefined,
    subject: `[Quinéo] Message de ${name}`,
    text: `Nom : ${name}\nEmail : ${email||'non renseigné'}\n\nMessage :\n${message}`
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) return new Response(JSON.stringify({ok:true}), {headers:{'Content-Type':'application/json'}});
  const err = await res.text();
  return new Response(JSON.stringify({ok:false,error:err}), {status:500,headers:{'Content-Type':'application/json'}});
}
