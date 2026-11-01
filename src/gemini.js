// Talks to Google's Gemini API using the browser's built-in `fetch`.
// No extra library is needed.

// The model name you asked for. It is kept in ONE place so it is easy to
// change if Google publishes the model under a different ID.
export const MODEL = 'gemini-3.8-flash';

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Low-level helper: sends a request body to Gemini and returns the reply text.
 * Both the chat and the quiz use it, so error handling lives in one place.
 */
async function callGemini(apiKey, body) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
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

/**
 * CHAT: send the conversation and return the reply text.
 *
 * @param {string} apiKey        the user's Gemini API key
 * @param {string} systemPrompt  hidden instructions (which persona to play)
 * @param {{role: 'user'|'model', text: string}[]} history  conversation so far
 */
export function askGemini(apiKey, systemPrompt, history) {
  // The bot's greeting is only for display. Gemini expects a conversation to
  // start with a user message, so skip any leading "model" messages.
  const firstUser = history.findIndex((m) => m.role === 'user');
  const turns = history.slice(firstUser === -1 ? 0 : firstUser);

  return callGemini(apiKey, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // Gemini expects each message as { role, parts: [{ text }] }
    contents: turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
  });
}

/**
 * QUIZ: ask Gemini for multiple-choice questions and return them as objects:
 *   [{ question, options: [4 strings], answerIndex: 0-3, explanation }]
 *
 * We ask for JSON (responseMimeType) so the reply is easy to parse, then
 * validate it, because a model can occasionally return something unexpected.
 */
export async function generateQuiz(apiKey, persona, difficulty, count = 5) {
  // Pick a few random topics so each quiz feels different.
  const topics = [...persona.quizTopics].sort(() => Math.random() - 0.5).slice(0, 3);

  const prompt = `Create a ${count}-question multiple-choice quiz for a candidate preparing for a ${persona.label} interview.
Difficulty: ${difficulty}.
Focus on these topics: ${topics.join('; ')}.
Rules:
- Each question has exactly 4 options and exactly one correct answer.
- Make wrong options plausible, not silly.
- "explanation" is 1-2 sentences on why the answer is correct.
Return ONLY a JSON array, no markdown, in this exact shape:
[{"question": "...", "options": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "..."}]`;

  const raw = await callGemini(apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 1 },
  });

  return parseQuiz(raw);
}

// Turn the model's text into a clean, validated list of questions.
function parseQuiz(raw) {
  // Some models wrap JSON in ```json fences even when told not to.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error('The quiz came back in an unexpected format. Please try again.');
  }
  if (!Array.isArray(data)) data = data?.questions; // tolerate { questions: [...] }

  const questions = (Array.isArray(data) ? data : [])
    .filter(
      (q) =>
        q &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < 4,
    )
    .map((q) => shuffleOptions(q));

  if (questions.length === 0) {
    throw new Error('Could not build a quiz from the reply. Please try again.');
  }
  return questions;
}

// Models tend to put the right answer first. Shuffle the options and keep
// track of where the correct one ended up.
function shuffleOptions(q) {
  const correct = q.options[q.answerIndex];
  const options = q.options.map(String).sort(() => Math.random() - 0.5);
  return {
    question: q.question,
    options,
    answerIndex: options.indexOf(String(correct)),
    explanation: q.explanation || '',
  };
}
