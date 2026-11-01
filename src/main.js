import './style.css';
import { PERSONAS, PERSONA_ORDER } from './personas.js';
import { askGemini } from './gemini.js';

// ---------- 1. Grab the HTML elements we need ----------
const $ = (id) => document.getElementById(id);
const jobsNav = $('jobs');
const messagesEl = $('messages');
const startersEl = $('starters');
const form = $('chat-form');
const input = $('chat-input');
const sendBtn = $('send-btn');
const keyModal = $('key-modal');
const keyForm = $('key-form');
const keyInput = $('key-input');
const keyError = $('key-error');
const changeKeyBtn = $('change-key');

// ---------- 2. App state ----------
let apiKey = safeGet('gemini_key') || '';
let currentId = PERSONA_ORDER[0];
let busy = false;

// One separate conversation per job, so switching tabs doesn't mix them up.
// Shape: { pm: [{role:'model', text:'...'}, ...], fde: [...], ... }
const chats = {};
for (const id of PERSONA_ORDER) {
  chats[id] = [{ role: 'model', text: PERSONAS[id].greeting }];
}

// sessionStorage can throw in some private modes, so wrap it.
function safeGet(k) {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function safeSet(k, v) {
  try { sessionStorage.setItem(k, v); } catch { /* ignore */ }
}
function safeRemove(k) {
  try { sessionStorage.removeItem(k); } catch { /* ignore */ }
}

// ---------- 3. Rendering ----------
function renderTabs() {
  jobsNav.innerHTML = '';
  for (const id of PERSONA_ORDER) {
    const p = PERSONAS[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'job' + (id === currentId ? ' active' : '');
    btn.textContent = p.label;
    btn.style.setProperty('--job-accent', p.accent);
    btn.addEventListener('click', () => selectPersona(id));
    jobsNav.appendChild(btn);
  }
}

// Very small, SAFE formatter: escape HTML first, then allow **bold**, `code`
// and line breaks. Escaping first prevents the model's text from injecting HTML.
function formatText(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*[*-] /gm, '• ')
    .replace(/\n/g, '<br>');
}

function addBubble(role, text, extraClass = '') {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'bot'} ${extraClass}`;
  div.innerHTML = formatText(text);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function renderChat() {
  messagesEl.innerHTML = '';
  for (const m of chats[currentId]) addBubble(m.role, m.text);

  // Show suggestion chips only before the user has said anything.
  startersEl.innerHTML = '';
  if (chats[currentId].length === 1) {
    for (const s of PERSONAS[currentId].starters) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = s;
      chip.addEventListener('click', () => send(s));
      startersEl.appendChild(chip);
    }
  }
}

// ---------- 4. Switching jobs ----------
function selectPersona(id) {
  if (id === currentId) return;
  currentId = id;
  const p = PERSONAS[id];
  // The CSS reads these variables, and transitions make the colours fade.
  const root = document.documentElement;
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--accent2', p.accent2);
  document.body.dataset.persona = id;
  renderTabs();
  renderChat();
  input.focus();
}

// ---------- 5. Sending a message ----------
async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  const personaId = currentId; // remember which chat this reply belongs to
  const history = chats[personaId];
  history.push({ role: 'user', text });
  startersEl.innerHTML = '';
  addBubble('user', text);
  input.value = '';

  busy = true;
  sendBtn.disabled = true;
  const typing = addBubble('model', 'Thinking…', 'typing');

  try {
    const reply = await askGemini(apiKey, PERSONAS[personaId].systemPrompt, history);
    history.push({ role: 'model', text: reply });
    // Only draw it if the user is still looking at the same job.
    if (personaId === currentId) {
      typing.remove();
      addBubble('model', reply);
    }
  } catch (err) {
    history.pop(); // remove the failed user message so they can retry
    typing.remove();
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      showKeyModal('Gemini rejected the request: ' + err.message);
    } else {
      addBubble('model', '⚠️ ' + err.message, 'error-msg');
    }
    if (personaId === currentId) renderChat();
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});

// ---------- 6. API key screen ----------
function showKeyModal(errorText = '') {
  keyError.hidden = !errorText;
  keyError.textContent = errorText;
  keyInput.value = '';
  keyModal.hidden = false;
  keyInput.focus();
}

keyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = keyInput.value.trim();
  if (!value) return;
  apiKey = value;
  safeSet('gemini_key', value);
  keyModal.hidden = true;
  changeKeyBtn.hidden = false;
  input.focus();
});

changeKeyBtn.addEventListener('click', () => {
  safeRemove('gemini_key');
  apiKey = '';
  showKeyModal();
});

// ---------- 7. Start the app ----------
(function init() {
  const p = PERSONAS[currentId];
  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--accent2', p.accent2);
  renderTabs();
  renderChat();
  if (apiKey) changeKeyBtn.hidden = false;
  else showKeyModal();
})();
