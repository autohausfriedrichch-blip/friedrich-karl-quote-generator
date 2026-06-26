// ============================================================================
// api/claude.js
// ============================================================================
// Vercel Serverless Function — biztonságos proxy az Anthropic Claude API felé,
// ANTHROPIC TOOL USE mechanizmussal.
//
// MIÉRT TOOL USE ÉS NEM SIMA SZÖVEGES JSON-KÉRÉS?
// Ha a frontend egyszerűen megkéri a modellt, hogy "válaszolj JSON-nal",
// a modell SZABAD SZÖVEGET generál, amely néha hibásan formázott JSON-t ad
// (csonka tömb, hiányzó vessző, bevezető mondat a JSON előtt stb.) — ez okozta
// a korábbi "Expected ',' or ']'" hibákat.
//
// A Tool Use mechanizmussal a modellt egy SZIGORÚ SCHEMA betartására kényszerítjük:
// az Anthropic API garantálja, hogy a válasz `tool_use` blokkja pontosan az általunk
// megadott JSON Schema-nak megfelelő struktúrájú objektum lesz — nincs szabad
// szöveg-generálás, nincs parse-hiba, nincs csonka válasz.
//
// FÁJL HELYE A PROJEKTBEN: /api/claude.js
// SZÜKSÉGES ENVIRONMENT VARIABLE: ANTHROPIC_API_KEY (Vercel Settings → Environment Variables)
//
// A frontendből így hívható:
//   fetch('/api/claude', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       system: "...",
//       user: "...",
//       max_tokens: 4000,
//       tool_name: "submit_diagnosis",
//       tool_description: "...",
//       tool_schema: { type: "object", properties: {...}, required: [...] }
//     })
//   })
// A válasz: { result: <a tool_schema-nak megfelelő objektum> }
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
    console.error('HIBA: Az ANTHROPIC_API_KEY environment variable nincs beállítva a Vercel projektben.');
    return res.status(500).json({ error: 'Szerver-konfigurációs hiba: hiányzó API-kulcs. Ellenőrizd a Vercel Environment Variables beállítást.' });
  }

  const { system, user, max_tokens, tool_name, tool_description, tool_schema } = req.body || {};
  if (!user) {
    return res.status(400).json({ error: 'A "user" mező (a prompt szövege) kötelező.' });
  }
  if (!tool_name || !tool_schema) {
    return res.status(400).json({ error: 'A "tool_name" és "tool_schema" mező kötelező a garantált JSON-válaszhoz.' });
  }

  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: max_tokens || 2000,
    system: system || undefined,
    messages: [{ role: 'user', content: user }],
    tools: [{
      name: tool_name,
      description: tool_description || 'Strukturált adat visszaadása a megadott schema szerint.',
      input_schema: tool_schema
    }],
    tool_choice: { type: 'tool', name: tool_name }
  };

  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
        if (anthropicRes.status === 429 || anthropicRes.status >= 500) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        return res.status(anthropicRes.status).json({ error: lastError });
      }

      const toolBlock = data.content?.find(b => b.type === 'tool_use');
      if (!toolBlock) {
        lastError = 'A modell nem a kért strukturált formátumban válaszolt (hiányzó tool_use blokk).';
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      return res.status(200).json({ result: toolBlock.input });

    } catch (err) {
      lastError = err.message;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  console.error('Proxy hiba (minden próbálkozás sikertelen):', lastError);
  return res.status(502).json({
    error: 'Az AI-szolgáltatás jelenleg nem érhető el. Kérlek próbáld újra pár másodperc múlva. (Részlet: ' + lastError + ')'
  });
}
