// ============================================================================
// api/claude.js
// ============================================================================
// Vercel Serverless Function — biztonságos proxy az Anthropic Claude API felé,
// ANTHROPIC TOOL USE mechanizmussal.
//
// FONTOS (Vercel Hobby csomag): a Serverless Function-ök max. 10 másodpercig
// futhatnak — ez platform-szintű limit, nem módosítható configgal. Ezért itt
// NEM próbálkozunk újra hiba esetén, és a frontend promptjait/token-limitjeit
// is úgy állítottuk be, hogy a válasz ezen az időn belül megérkezzen.
// ============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Csak POST metódus engedélyezett.' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('HIBA: Az ANTHROPIC_API_KEY environment variable nincs beállítva.');
    return res.status(500).json({ error: 'Szerver-konfigurációs hiba: hiányzó API-kulcs.' });
  }

  const { system, user, max_tokens, tool_name, tool_description, tool_schema } = req.body || {};
  if (!user) {
    return res.status(400).json({ error: 'A "user" mező kötelező.' });
  }
  if (!tool_name || !tool_schema) {
    return res.status(400).json({ error: 'A "tool_name" és "tool_schema" mező kötelező.' });
  }

  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: max_tokens || 1500,
    system: system || undefined,
    messages: [{ role: 'user', content: user }],
    tools: [{
      name: tool_name,
      description: tool_description || 'Strukturált adat visszaadása a megadott schema szerint.',
      input_schema: tool_schema
    }],
    tool_choice: { type: 'tool', name: tool_name }
  };

  let lastError = null;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      lastError = data.error?.message || `Anthropic API hiba (${anthropicRes.status})`;
      return res.status(anthropicRes.status).json({ error: lastError });
    }

    const toolBlock = data.content?.find(b => b.type === 'tool_use');
    if (!toolBlock) {
      return res.status(502).json({ error: 'A modell nem a kért strukturált formátumban válaszolt.' });
    }

    return res.status(200).json({ result: toolBlock.input });

  } catch (err) {
    lastError = err.message;
    console.error('Proxy hiba:', lastError);
    return res.status(502).json({
      error: 'Az AI-szolgáltatás jelenleg nem érhető el, vagy túl sokáig tartott a válasz (Vercel Hobby csomagon 10 mp a limit). Kérlek próbáld újra. (Részlet: ' + lastError + ')'
    });
  }
}
