/* ==========================================================
   Read Receipt — interactive logic
   ----------------------------------------------------------
   Session timeline (5 min total, starts when rules are accepted):
     0:00 – 2:00   chatbot replies normally
     2:00 – 4:00   chatbot ghosts (typing bubble loops, stays online)
     4:00 – 5:00   chatbot comes back and replies normally
     5:00          "Section End" popup -> OK -> forum -> mandatory comment

   Testing shortcut: open index.html?fast=20 to run everything 20x faster.
   Clear saved forum comments: index.html?clear
   To start a new participant: just reload the page.
   ========================================================== */

(() => {
  'use strict';

  /* ---------------- Config ---------------- */
  const params = new URLSearchParams(location.search);
  const SCALE = Math.max(1, Number(params.get('fast')) || 1);

  const PHASE_TALK1 = 120000 / SCALE; // 2 min normal
  const PHASE_GHOST = 120000 / SCALE; // 2 min ghosting
  const PHASE_TALK2 =  60000 / SCALE; // 1 min normal again
  const TOTAL = PHASE_TALK1 + PHASE_GHOST + PHASE_TALK2;

  const STORAGE_KEY = 'readReceiptComments';

  /* ---------------- Elements ---------------- */
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const tabConversation = $('tabConversation');
  const tabForum = $('tabForum');
  const viewConversation = $('conversation');
  const viewForum = $('forum');
  const landing = $('landing');
  const chat = $('chat');
  const messages = $('messages');
  const composer = $('composer');
  const input = $('input');
  const rulesModal = $('rulesModal');
  const endModal = $('endModal');
  const commentModal = $('commentModal');
  const commentForm = $('commentForm');
  const commentName = $('commentName');
  const commentText = $('commentText');
  const commentPost = $('commentPost');
  const commentCancel = $('commentCancel');
  const commentList = $('commentList');

  /* ---------------- State ---------------- */
  let startTime = 0;
  let phase = 'idle';          // idle | talk1 | ghost | talk2 | ended
  let tickTimer = null;
  let pendingTimers = [];      // timers for a reply that is being "typed"
  let typingEl = null;
  let readEl = null;
  let ghostMessages = 0;       // user messages sent while being ghosted
  let comebackPending = false;
  let userMessageCount = 0;
  let firstCommentDone = false;

  /* ==========================================================
     Tabs
     ========================================================== */
  function switchTab(name) {
    const forum = name === 'forum';
    viewConversation.classList.toggle('hidden', forum);
    viewForum.classList.toggle('hidden', !forum);
    tabConversation.classList.toggle('active', !forum);
    tabForum.classList.toggle('active', forum);
    body.classList.toggle('theme-light', forum);
    body.classList.toggle('theme-dark', !forum);
  }
  tabConversation.addEventListener('click', () => switchTab('conversation'));
  tabForum.addEventListener('click', () => { if (!tabForum.disabled) switchTab('forum'); });

  /* ==========================================================
     Flow: start -> rules -> chat
     ========================================================== */
  $('startBtn').addEventListener('click', () => rulesModal.classList.remove('hidden'));

  $('rulesOk').addEventListener('click', () => {
    rulesModal.classList.add('hidden');
    landing.classList.add('hidden');
    chat.classList.remove('hidden');
    startSession();
    input.focus();
  });

  function startSession() {
    startTime = Date.now();
    phase = 'talk1';
    tickTimer = setInterval(tick, 200);
  }

  /* ==========================================================
     Session clock + phases
     ========================================================== */
  function tick() {
    const elapsed = Date.now() - startTime;

    if (elapsed >= TOTAL) return endSession();

    const next = elapsed < PHASE_TALK1 ? 'talk1'
               : elapsed < PHASE_TALK1 + PHASE_GHOST ? 'ghost'
               : 'talk2';

    if (next !== phase) {
      phase = next;
      if (phase === 'ghost') beginGhosting();
      if (phase === 'talk2') beginComeback();
    }
  }

  // Bot stops replying: cancel anything in progress, loop the typing bubble.
  function beginGhosting() {
    cancelPending();
    showTyping();
  }

  // Bot is back: the bubble keeps going for a moment, then a message arrives.
  function beginComeback() {
    comebackPending = true;
    showTyping();
    later(() => {
      hideTyping();
      comebackPending = false;
      addBot(ghostMessages > 0
        ? "sorry, I got pulled away for a bit... did you say something?"
        : "hey, sorry. I'm back. where were we?");
    }, 2500 / SCALE);
  }

  function endSession() {
    clearInterval(tickTimer);
    phase = 'ended';
    cancelPending();
    hideTyping();
    input.disabled = true;
    input.placeholder = 'This conversation has ended.';
    endModal.classList.remove('hidden');
  }

  $('endOk').addEventListener('click', () => {
    endModal.classList.add('hidden');
    tabForum.disabled = false;
    switchTab('forum');
    openCommentModal(true); // mandatory the first time
  });

  /* ==========================================================
     Sending messages
     ========================================================== */
  composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  });

  function send() {
    const text = input.value.trim();
    if (!text || phase === 'idle' || phase === 'ended') return;

    input.value = '';
    input.style.height = 'auto';
    chat.classList.remove('is-new');

    addUser(text);
    userMessageCount++;
    markRead();

    if (phase === 'ghost') { ghostMessages++; return; } // read, but never answered
    if (comebackPending) return;                        // the comeback message covers it
    queueReply(text);
  }

  function addUser(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;
    messages.appendChild(el);
    scrollDown();
  }

  function addBot(text) {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.textContent = text;
    // keep the typing bubble (if any) as the last item
    if (typingEl && typingEl.parentNode) messages.insertBefore(el, typingEl);
    else messages.appendChild(el);
    scrollDown();
  }

  // "Read" label under the participant's latest message
  function markRead() {
    setTimeout(() => {
      if (readEl) readEl.remove();
      readEl = document.createElement('div');
      readEl.className = 'read';
      readEl.textContent = 'Read';
      const lastUser = [...messages.querySelectorAll('.msg.user')].pop();
      if (lastUser) lastUser.after(readEl);
      scrollDown();
    }, 900 / SCALE);
  }

  /* ==========================================================
     Typing bubble
     ========================================================== */
  function showTyping() {
    if (typingEl && typingEl.parentNode) return;
    typingEl = document.createElement('div');
    typingEl.className = 'typing';
    typingEl.setAttribute('aria-label', 'Typing');
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    messages.appendChild(typingEl);
    scrollDown();
  }
  function hideTyping() {
    if (typingEl) typingEl.remove();
    typingEl = null;
  }

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  /* ==========================================================
     Reply scheduling
     ========================================================== */
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    pendingTimers.push(id);
    return id;
  }
  function cancelPending() {
    pendingTimers.forEach(clearTimeout);
    pendingTimers = [];
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  function queueReply(userText) {
    cancelPending();           // several quick messages -> one reply to the last
    hideTyping();
    const reply = getBotReply(userText);

    const readDelay = rand(800, 1600) / SCALE;              // "reading"
    const typeDelay = Math.min(1200 + reply.length * 45, 4200) / SCALE; // "typing"

    later(() => {
      showTyping();
      later(() => { hideTyping(); addBot(reply); }, typeDelay);
    }, readDelay);
  }

  /* ==========================================================
     Chatbot brain (scripted, easy to swap)
     ----------------------------------------------------------
     getBotReply(text) -> string
     To connect a real AI later, replace the body of this function
     (it can return a Promise if you also `await` it in queueReply).
     ========================================================== */
  const used = new Set();
  function pick(list) {
    const fresh = list.filter((x) => !used.has(x));
    const pool = fresh.length ? fresh : list;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    used.add(choice);
    return choice;
  }

  const RULES = [
    [/(are you|r u|you a).*(bot|ai|human|real|robot|person|machine)|who are you|what are you/i,
      ["does it matter? 🙂 I'm just here to chat. what's on your mind?",
       "haha why do you ask? I'm just someone to talk to right now"]],
    [/your name|what.?s your name|call you/i,
      ["I'd rather not say, kinda like it better this way. what should I call you?"]],
    [/\b(hi|hello|hey|yo|sup)\b/i,
      ["hey 🙂 how's it going?"]],
    [/\b(thank you|thanks|thx)\b/i,
      ["no worries 🙂"]],
    [/\b(tired|exhausted|sleepy|drained)\b/i,
      ["same, honestly. long day?", "ugh, I feel that. did you get any rest at all?"]],
    [/\b(sad|bad|stress|stressed|anxious|angry|awful|terrible|hate|upset|worst)\b/i,
      ["that sounds rough. do you want to talk about it?", "I'm sorry, that doesn't sound easy. what happened?"]],
    [/\b(happy|great|good|amazing|love|fun|nice|awesome|fine)\b/i,
      ["that's nice to hear. what made it good?", "love that for you 🙂 anything in particular?"]],
    [/\b(lol|haha|hehe|lmao)\b/i,
      ["haha 😄", "😄 okay that made me smile"]],
    [/\bwhy\b/i,
      ["hmm, good question. I'm not sure I have a clear answer. what do you think?"]],
  ];

  const QUESTION = [
    "hmm, hard to say. what makes you ask?",
    "honestly I'm not sure. what do you think?",
    "ha, good question. I'd say it depends",
  ];
  const SHORT = ["mm. go on?", "tell me more", "yeah?", "and?"];
  const GENERIC = [
    "I see. tell me more?",
    "that's interesting, how did that feel?",
    "yeah, I get that sometimes",
    "huh. what happened after that?",
    "do you ever think about that kind of thing?",
    "mm, I know what you mean",
    "and then what?",
    "that's kind of how it goes sometimes, right?",
  ];

  function getBotReply(text) {
    // first answer to "How is your day !"
    if (userMessageCount <= 1) {
      if (/\b(bad|tired|awful|terrible|stress|stressed|boring|sad|exhausted|worst|meh)\b/i.test(text))
        return "ah, sorry to hear that. want to tell me what happened?";
      return "oh nice, glad to hear it. mine's been kind of slow honestly. what did you get up to today?";
    }
    for (const [re, replies] of RULES) {
      if (re.test(text)) return pick(replies);
    }
    if (/\?\s*$/.test(text)) return pick(QUESTION);
    if (text.split(/\s+/).length <= 3) return pick(SHORT);
    return pick(GENERIC);
  }

  /* ==========================================================
     Forum
     ========================================================== */
  // Sample comments so the forum is not empty on day one.
  // Replace / delete these as you like.
  const SEED = [
    { name: 'Mia',       ts: new Date(2026, 9, 24, 14, 32).getTime(),
      text: 'It felt strange when they stopped replying. I kept staring at the dots waiting for something to happen.' },
    { name: 'Jason',     ts: new Date(2026, 9, 24, 16, 5).getTime(),
      text: "I didn't think I'd care that much. Two minutes felt like forever though." },
    { name: 'Anonymous', ts: new Date(2026, 9, 25, 11, 48).getTime(),
      text: 'At first it was just a normal chat. Then silence. I typed three more messages and none got an answer.' },
    { name: 'Chloe',     ts: new Date(2026, 9, 25, 15, 20).getTime(),
      text: "When they came back I didn't know whether to be angry or relieved." },
  ];

  function loadComments() {
    try {
      if (params.has('clear')) localStorage.removeItem(STORAGE_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* storage unavailable */ }
    return SEED.slice();
  }
  function saveComments() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(comments)); } catch (_) {}
  }

  let comments = loadComments();

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function formatTime(ts) {
    const d = new Date(ts);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${ordinal(d.getDate())}, ${d.getFullYear()} ${hh}:${mm}`;
  }

  function renderComments() {
    commentList.innerHTML = '';
    [...comments].sort((a, b) => b.ts - a.ts).forEach((c) => {
      const li = document.createElement('li');
      const p = document.createElement('p');
      p.className = 'comment-text';
      p.textContent = c.text;
      const meta = document.createElement('div');
      meta.className = 'comment-meta';
      const n = document.createElement('span'); n.textContent = c.name || 'Anonymous';
      const t = document.createElement('span'); t.textContent = formatTime(c.ts);
      meta.append(n, t);
      li.append(p, meta);
      commentList.appendChild(li);
    });
  }

  function openCommentModal(mandatory) {
    commentCancel.classList.toggle('hidden', !!mandatory);
    commentText.value = '';
    commentPost.disabled = true;
    commentModal.classList.remove('hidden');
    commentText.focus();
  }

  commentText.addEventListener('input', () => {
    commentPost.disabled = commentText.value.trim().length === 0;
  });
  commentCancel.addEventListener('click', () => commentModal.classList.add('hidden'));
  $('addCommentBtn').addEventListener('click', () => openCommentModal(false));

  commentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = commentText.value.trim();
    if (!text) return;
    comments.push({ name: commentName.value.trim() || 'Anonymous', ts: Date.now(), text });
    saveComments();
    renderComments();
    commentModal.classList.add('hidden');
    firstCommentDone = true;
  });

  // Block closing the mandatory popup with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !firstCommentDone && phase === 'ended' && !commentModal.classList.contains('hidden')) {
      e.preventDefault();
    }
  });

  renderComments();
})();