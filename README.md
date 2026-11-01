# AI Interview Agent

A chatbot that helps you prepare for AI roles: **AI Product Manager**, **Forward Deployed Engineer** and **AI Researcher**.
Pick a job and the bot coaches you with role-specific questions and feedback, powered by Gemini.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL, paste your Gemini API key (free from https://aistudio.google.com/apikey) and start chatting.
The key is kept in `sessionStorage` (cleared when the tab closes) and only sent to Google.

## Project layout

| File | What it does |
| --- | --- |
| `index.html` | Page structure: title, job buttons, chat, API key popup |
| `src/personas.js` | The 3 jobs: system prompts, colours, greetings |
| `src/gemini.js` | Calls the Gemini API (model name lives in `MODEL`) |
| `src/main.js` | App logic: tabs, chat history per job, sending messages |
| `src/style.css` | Blue/neon grid theme and per-job colour transitions |

## Notes
- The model is set to `gemini-3.8-flash` in `src/gemini.js`. If Google returns "model not found", change that one constant.
- The key is used directly from the browser, which is fine for personal use. For a public deployment, move the API call to a small backend so the key is never exposed.
