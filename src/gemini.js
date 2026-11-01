// Talks to Google's Gemini API using the browser's built-in `fetch`.
// No extra library is needed.

// The model name you asked for. It is kept in ONE place so it is easy to
// change if Google publishes the model under a different ID.
export const MODEL = 'gemini-3.8-flash';

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Send the conversation to Gemini and return the reply text.
 *
 * @param {string} apiKey        the user's Gemini API key
 * @param {string} systemPrompt  hidden instructions (which persona to play)
 * @param {{role: 'user'|'model', text: string}[]} history  conversation so far
 */
export async function askGemini(apiKey, systemPrompt, history) {
  // The bot's greeting is only for display. Gemini expects a conversation to
  // start with a user message, so skip any leading "model" messages.
  const firstUser = history.findIndex((m) => m.role === 'user');
  const turns = history.slice(firstUser === -1 ? 0 : firstUser);

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      // Gemini expects each message as { role, parts: [{ text }] }
      contents: turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    }),
  });

  if (!response.ok) {
    // Google returns a JSON body like { error: { message: "..." } }
    let detail = '';
    try {
      detail = (await response.json()).error?.message ?? '';
    } catch {
      /* body was not JSON - ignore */
    }
    const err = new Error(detail || `Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned an empty reply (it may have been blocked). Try rephrasing.');
  }
  return text;
}
