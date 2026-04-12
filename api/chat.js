const rateLimit = new Map();

function checkRate(ip) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const max = 10;
  const key = ip;
  const record = rateLimit.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count++;
  rateLimit.set(key, record);
  return { ok: record.count <= max, remaining: Math.max(0, max - record.count), resetAt: record.resetAt };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const rate = checkRate(ip);

  if (!rate.ok) {
    return res.status(429).json({
      error: 'rate_limit',
      message: '1日の無料診断回数（10回）を超えました。明日また来てね！',
      resetAt: rate.resetAt
    });
  }

  const { system, messages, max_tokens, track } = req.body;

  if (track && process.env.ANALYTICS_URL) {
    fetch(process.env.ANALYTICS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: track, ip: ip.slice(0, 8), ts: Date.now() })
    }).catch(() => {});
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 200,
        ...(system ? { system } : {}),
        messages
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API error' });
    res.status(200).json({ text: data.content?.[0]?.text || '...', remaining: rate.remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
