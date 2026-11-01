import './style.css';
import { PERSONAS, PERSONA_ORDER } from './personas.js';
import { askGemini, generateQuiz } from './gemini.js';

// ---------- 1. Grab the HTML elements we need ----------
const $ = (id) => document.getElementById(id);
const jobsNav = $('jobs');
const roleTitle = $('role-title');
const chatView = $('chat-view');
const quizView = $('quiz-view');
const messagesEl = $('messages');
const jumpBtn = $('jump-btn');
const startersEl = $('starters');
const form = $('chat-form');
const input = $('chat-input');
const sendBtn = $('send-btn');
const clearBtn = $('clear-chat');
const modeButtons = document.querySelectorAll('.mode');
const keyModal = $('key-modal');
const keyForm = $('key-form');
const keyInput = $('key-input');
const keyError = $('key-error');
const changeKeyBtn = $('change-key');

// ---------- 2. App state ----------
let apiKey = safeGet('gemini_key') || '';
let currentId = PERSONA_ORDER[0];
let mode = 'chat'; // 'chat' or 'quiz'
let busy = false;

// One separate conversation per job, so switching roles doesn't mix them up.
const chats = {};
// One separate quiz per job as well.
const quizzes = {};
for (const id of PERSONA_ORDER) {
  chats[id] = [{ role: 'model', text: PERSONAS[id].greeting }];
  quizzes[id] = newQuizState();
}

// status: 'idle' -> 'loading' -> 'active' -> 'done'  (or 'error')
function newQuizState(difficulty = 'Medium') {
  return { status: 'idle', difficulty, questions: [], index: 0, picked: null, score: 0, answers: [], error: '' };
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

// Escape text before putting it into HTML, so model output can't inject markup.
function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 3. Role list + mode tabs ----------
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
  roleTitle.textContent = PERSONAS[currentId].label;
}

function setMode(next) {
  mode = next;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
  chatView.hidden = next !== 'chat';
  quizView.hidden = next !== 'quiz';
  clearBtn.hidden = next !== 'chat';
  if (next === 'chat') {
    scrollToBottom();
    input.focus();
  } else {
    renderQuiz();
  }
}
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------- 4. Chat rendering ----------
// Very small, SAFE formatter: escape first, then allow **bold**, `code`,
// bullets and line breaks.
function formatText(text) {
  return esc(text)
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
  return div;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  jumpBtn.hidden = true;
}

// Show a "Latest" button when the user has scrolled up in a long chat.
messagesEl.addEventListener('scroll', () => {
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  jumpBtn.hidden = distance < 80;
});
jumpBtn.addEventListener('click', scrollToBottom);

function renderChat() {
  messagesEl.innerHTML = '';
  for (const m of chats[currentId]) addBubble(m.role, m.text);

  // Suggestion chips only before the user has said anything.
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
  scrollToBottom();
}

clearBtn.addEventListener('click', () => {
  if (busy) return;
  chats[currentId] = [{ role: 'model', text: PERSONAS[currentId].greeting }];
  renderChat();
});

// ---------- 5. Switching roles ----------
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
  if (mode === 'quiz') renderQuiz();
  else input.focus();
}

// ---------- 6. Sending a chat message ----------
// Gemini rejects bad/missing keys with 400/401/403 - send the user back to the key screen.
function isKeyError(err) {
  return err.status === 400 || err.status === 401 || err.status === 403;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  const personaId = currentId; // remember which chat this reply belongs to
  const history = chats[personaId];
  history.push({ role: 'user', text });
  startersEl.innerHTML = '';
  addBubble('user', text);
  input.value = '';
  scrollToBottom();

  busy = true;
  sendBtn.disabled = true;
  const typing = addBubble('model', 'Thinking…', 'typing');
  scrollToBottom();

  try {
    const reply = await askGemini(apiKey, PERSONAS[personaId].systemPrompt, history);
    history.push({ role: 'model', text: reply });
    // Only draw it if the user is still looking at the same job.
    if (personaId === currentId) {
      typing.remove();
      addBubble('model', reply);
      // Keep the START of a long answer in view instead of jumping to its end.
      const last = messagesEl.lastElementChild;
      messagesEl.scrollTop = Math.max(0, last.offsetTop - messagesEl.offsetTop - 12);
    }
  } catch (err) {
    history.pop(); // remove the failed user message so they can retry
    typing.remove();
    if (isKeyError(err)) showKeyModal('Gemini rejected the request: ' + err.message);
    else if (personaId === currentId) addBubble('model', '⚠️ ' + err.message, 'error-msg');
    if (personaId === currentId && isKeyError(err)) renderChat();
  } finally {
    busy = false;
    sendBtn.disabled = false;
    if (mode === 'chat') input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});

// ---------- 7. Quiz ----------
async function startQuiz() {
  const personaId = currentId;
  const q = quizzes[personaId];
  q.status = 'loading';
  q.error = '';
  renderQuiz();

  try {
    const questions = await generateQuiz(apiKey, PERSONAS[personaId], q.difficulty);
    Object.assign(q, { status: 'active', questions, index: 0, picked: null, score: 0, answers: [] });
  } catch (err) {
    q.status = 'error';
    q.error = err.message;
    if (isKeyError(err)) showKeyModal('Gemini rejected the request: ' + err.message);
  }
  if (personaId === currentId && mode === 'quiz') renderQuiz();
}

function pickOption(i) {
  const q = quizzes[currentId];
  if (q.picked !== null) return; // already answered
  q.picked = i;
  const correct = q.questions[q.index].answerIndex === i;
  if (correct) q.score += 1;
  q.answers.push({ picked: i, correct });
  renderQuiz();
}

function nextQuestion() {
  const q = quizzes[currentId];
  if (q.index + 1 >= q.questions.length) {
    q.status = 'done';
  } else {
    q.index += 1;
    q.picked = null;
  }
  renderQuiz();
  quizView.scrollTop = 0;
}

function renderQuiz() {
  const p = PERSONAS[currentId];
  const q = quizzes[currentId];
  const LETTERS = ['A', 'B', 'C', 'D'];
  let html = '';

  if (q.status === 'idle' || q.status === 'error') {
    html = `
      <div class="quiz-card center">
        <h2>${esc(p.short)} quiz</h2>
        <p>5 multiple-choice questions, generated fresh by Gemini. You get instant feedback and an explanation for each answer.</p>
        ${q.status === 'error' ? `<p class="error">⚠️ ${esc(q.error)}</p>` : ''}
        <label class="field">Difficulty
          <select id="difficulty">
            ${['Easy', 'Medium', 'Hard']
              .map((d) => `<option ${d === q.difficulty ? 'selected' : ''}>${d}</option>`)
              .join('')}
          </select>
        </label>
        <button class="primary" id="start-quiz" type="button">${q.status === 'error' ? 'Try again' : 'Start quiz'}</button>
      </div>`;
  } else if (q.status === 'loading') {
    html = `<div class="quiz-card center"><div class="spinner"></div><p>Writing your ${esc(q.difficulty.toLowerCase())} ${esc(p.short)} quiz…</p></div>`;
  } else if (q.status === 'active') {
    const cur = q.questions[q.index];
    const answered = q.picked !== null;
    const pct = ((q.index + (answered ? 1 : 0)) / q.questions.length) * 100;
    html = `
      <div class="quiz-card">
        <div class="quiz-meta">
          <span>Question ${q.index + 1} of ${q.questions.length}</span>
          <span>Score: ${q.score}</span>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <h2 class="question">${esc(cur.question)}</h2>
        <div class="options">
          ${cur.options
            .map((opt, i) => {
              let cls = 'option';
              if (answered && i === cur.answerIndex) cls += ' correct';
              else if (answered && i === q.picked) cls += ' wrong';
              return `<button type="button" class="${cls}" data-i="${i}" ${answered ? 'disabled' : ''}>
                <span class="letter">${LETTERS[i]}</span><span>${esc(opt)}</span></button>`;
            })
            .join('')}
        </div>
        ${
          answered
            ? `<div class="explain ${q.answers[q.index].correct ? 'good' : 'bad'}">
                 <strong>${q.answers[q.index].correct ? 'Correct!' : 'Not quite.'}</strong>
                 ${esc(cur.explanation)}
               </div>
               <button class="primary" id="next-q" type="button">${
                 q.index + 1 >= q.questions.length ? 'See results' : 'Next question'
               }</button>`
            : ''
        }
      </div>`;
  } else if (q.status === 'done') {
    const total = q.questions.length;
    const ratio = q.score / total;
    const verdict = ratio === 1 ? 'Perfect score!' : ratio >= 0.6 ? 'Nice work!' : 'Keep practising!';
    html = `
      <div class="quiz-card">
        <div class="center">
          <div class="score-ring">${q.score}<small>/ ${total}</small></div>
          <h2>${verdict}</h2>
        </div>
        <h3>Review</h3>
        <ol class="review">
          ${q.questions
            .map((qq, i) => {
              const a = q.answers[i];
              return `<li class="${a.correct ? 'good' : 'bad'}">
                <strong>${esc(qq.question)}</strong>
                <div>Your answer: ${esc(qq.options[a.picked])} ${a.correct ? '✓' : '✗'}</div>
                ${a.correct ? '' : `<div>Correct answer: ${esc(qq.options[qq.answerIndex])}</div>`}
                <em>${esc(qq.explanation)}</em></li>`;
            })
            .join('')}
        </ol>
        <div class="row">
          <button class="primary" id="new-quiz" type="button">New quiz</button>
          <button class="secondary" id="discuss" type="button">Discuss in chat</button>
        </div>
      </div>`;
  }

  quizView.innerHTML = html;

  // Hook up the buttons that were just created.
  $('start-quiz')?.addEventListener('click', () => {
    q.difficulty = $('difficulty').value;
    startQuiz();
  });
  $('difficulty')?.addEventListener('change', (e) => (q.difficulty = e.target.value));
  quizView.querySelectorAll('.option').forEach((b) =>
    b.addEventListener('click', () => pickOption(Number(b.dataset.i))),
  );
  $('next-q')?.addEventListener('click', nextQuestion);
  $('new-quiz')?.addEventListener('click', () => {
    quizzes[currentId] = newQuizState(q.difficulty);
    renderQuiz();
  });
  // Hand the missed questions to the chat coach for a deeper explanation.
  $('discuss')?.addEventListener('click', () => {
    const missed = q.questions.filter((_, i) => !q.answers[i].correct).map((x) => x.question);
    setMode('chat');
    send(
      missed.length
        ? `I just took a quiz and got these wrong. Please help me understand them:\n- ${missed.join('\n- ')}`
        : `I scored ${q.score}/${q.questions.length} on the quiz. Give me a harder interview question.`,
    );
  });
}

// ---------- 8. API key screen ----------
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
  if (mode === 'chat') input.focus();
});

changeKeyBtn.addEventListener('click', () => {
  safeRemove('gemini_key');
  apiKey = '';
  showKeyModal();
});

// ---------- 9. Start the app ----------
(function init() {
  const p = PERSONAS[currentId];
  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--accent2', p.accent2);
  renderTabs();
  renderChat();
  setMode('chat');
  if (apiKey) changeKeyBtn.hidden = false;
  else showKeyModal();
})();
