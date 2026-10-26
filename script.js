/* ==========================================================
   Read Receipt - interactive logic
   ----------------------------------------------------------
   Session timeline (5 min total, starts when rules are accepted):
     0:00 - 2:00   chatbot replies normally
     2:00 - 4:00   chatbot ghosts (typing bubble loops, stays online)
     4:00 - 5:00   chatbot comes back and replies normally
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
  const commentList = $('commentList');
  const sendBtn = $('sendBtn');
  const replyView = $('replyView');
  const replyTarget = $('replyTarget');
  const replyForm = $('replyForm');
  const replyText = $('replyText');
  const replyPost = $('replyPost');
  const replyBack = $('replyBack');

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
  let participantName = 'Anonymous';
  let replyingTo = null;

  /* ==========================================================
     Tabs
     ========================================================== */
  function switchTab(name) {
    const forum = name === 'forum';
    if (!forum) closeReply();
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
    updateSendBtn();
    endModal.classList.remove('hidden');
  }

  $('endOk').addEventListener('click', () => {
    endModal.classList.add('hidden');
    tabForum.disabled = false;
    switchTab('forum');
    openCommentModal(); // mandatory, one comment per participant
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
    updateSendBtn();
  });

  // The arrow is dimmed until there is something to send
  function updateSendBtn() {
    sendBtn.disabled = input.disabled || input.value.trim() === '';
  }

  function send() {
    const text = input.value.trim();
    if (!text || phase === 'idle' || phase === 'ended') return;

    input.value = '';
    input.style.height = 'auto';
    updateSendBtn();
    input.focus();
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
    keepTypingLast();
    scrollDown();
  }

  function addBot(text) {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.textContent = text;
    messages.appendChild(el);
    keepTypingLast();
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
      keepTypingLast();
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
  // The typing bubble always sits at the very bottom, below every message
  function keepTypingLast() {
    if (typingEl && typingEl.parentNode) messages.appendChild(typingEl);
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
      ["does it matter? \u{1F642} I'm just here to chat. what's on your mind?",
       "haha why do you ask? I'm just someone to talk to right now"]],
    [/your name|what.?s your name|call you/i,
      ["I'd rather not say, kinda like it better this way. what should I call you?"]],
    [/\b(hi|hello|hey|yo|sup)\b/i,
      ["hey \u{1F642} how's it going?"]],
    [/\b(thank you|thanks|thx)\b/i,
      ["no worries \u{1F642}"]],
    [/\b(tired|exhausted|sleepy|drained)\b/i,
      ["same, honestly. long day?", "ugh, I feel that. did you get any rest at all?"]],
    [/\b(sad|bad|stress|stressed|anxious|angry|awful|terrible|hate|upset|worst)\b/i,
      ["that sounds rough. do you want to talk about it?", "I'm sorry, that doesn't sound easy. what happened?"]],
    [/\b(happy|great|good|amazing|love|fun|nice|awesome|fine)\b/i,
      ["that's nice to hear. what made it good?", "love that for you \u{1F642} anything in particular?"]],
    [/\b(lol|haha|hehe|lmao)\b/i,
      ["haha \u{1F604}", "\u{1F604} okay that made me smile"]],
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
     - each participant writes ONE comment (mandatory, no "add comment" later)
     - every comment has a bubble icon: click it to reply
     ========================================================== */
  const BUBBLE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3A9 9 0 1 0 17.5 19.2L21.5 21.5L19.6 17.1A9 9 0 0 0 12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  // Sample comments so the forum is not empty on day one.
  // Replace / delete these as you like.
  const SEED = [
    { id: 's1', name: 'Mia', ts: new Date(2026, 9, 24, 14, 32).getTime(),
      text: 'It felt strange when they stopped replying. I kept staring at the dots waiting for something to happen.',
      replies: [
        { name: 'Jason', ts: new Date(2026, 9, 24, 17, 10).getTime(), text: 'Same here. I almost typed an apology.' }
      ] },
    { id: 's2', name: 'Jason', ts: new Date(2026, 9, 24, 16, 5).getTime(),
      text: "I didn't think I'd care that much. Two minutes felt like forever though.", replies: [] },
    { id: 's3', name: 'Anonymous', ts: new Date(2026, 9, 25, 11, 48).getTime(),
      text: 'At first it was just a normal chat. Then silence. I typed three more messages and none got an answer.', replies: [] },
    { id: 's4', name: 'Chloe', ts: new Date(2026, 9, 25, 15, 20).getTime(),
      text: "When they came back I didn't know whether to be angry or relieved.", replies: [] },
  ];

  function loadComments() {
    let data = null;
    try {
      if (params.has('clear')) localStorage.removeItem(STORAGE_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!Array.isArray(data)) data = JSON.parse(JSON.stringify(SEED));
    data.forEach((c, i) => {
      if (!c.id) c.id = 'c' + i + '-' + c.ts;
      if (!Array.isArray(c.replies)) c.replies = [];
    });
    return data;
  }
  function saveComments() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(comments)); } catch (e) { /* ignore */ }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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
    return month + ' ' + ordinal(d.getDate()) + ', ' + d.getFullYear() + ' ' + hh + ':' + mm;
  }

  function textEl(item) {
    const p = document.createElement('p');
    p.className = 'comment-text';
    p.textContent = item.text;
    return p;
  }
  function metaEl(item) {
    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const n = document.createElement('span'); n.textContent = item.name || 'Anonymous';
    const t = document.createElement('span'); t.textContent = formatTime(item.ts);
    meta.append(n, t);
    return meta;
  }

  function renderComments() {
    commentList.innerHTML = '';
    [...comments].sort((a, b) => b.ts - a.ts).forEach((c) => {
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'comment-row';
      const main = document.createElement('div');
      main.className = 'comment-main';
      main.append(textEl(c), metaEl(c));

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reply-btn';
      btn.setAttribute('aria-label', 'Reply to this comment');
      btn.innerHTML = BUBBLE_SVG + (c.replies.length ? '<span class="reply-count">' + c.replies.length + '</span>' : '');
      btn.addEventListener('click', () => openReply(c.id));

      row.append(main, btn);
      li.appendChild(row);

      if (c.replies.length) {
        const ul = document.createElement('ul');
        ul.className = 'replies';
        c.replies.forEach((r) => {
          const rli = document.createElement('li');
          rli.append(textEl(r), metaEl(r));
          ul.appendChild(rli);
        });
        li.appendChild(ul);
      }
      commentList.appendChild(li);
    });
  }

  /* ---- First (mandatory) comment ---- */
  function openCommentModal() {
    commentText.value = '';
    commentPost.disabled = true;
    commentModal.classList.remove('hidden');
    commentText.focus();
  }

  commentText.addEventListener('input', () => {
    commentPost.disabled = commentText.value.trim().length === 0;
  });

  commentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = commentText.value.trim();
    if (!text) return;
    participantName = commentName.value.trim() || 'Anonymous';
    comments.push({ id: uid(), name: participantName, ts: Date.now(), text: text, replies: [] });
    saveComments();
    renderComments();
    commentModal.classList.add('hidden');
  });

  /* ---- Replying: one comment in focus, the forum blurred behind ---- */
  function openReply(id) {
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    replyingTo = id;
    replyTarget.innerHTML = '';
    replyTarget.append(textEl(c), metaEl(c));
    replyText.value = '';
    replyPost.disabled = true;
    replyView.classList.remove('hidden');
    replyText.focus();
  }
  function closeReply() {
    replyingTo = null;
    replyView.classList.add('hidden');
  }

  replyBack.addEventListener('click', closeReply);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyingTo) closeReply();
  });
  replyText.addEventListener('input', () => {
    replyPost.disabled = replyText.value.trim().length === 0;
  });
  replyText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); replyForm.requestSubmit(); }
  });
  replyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = replyText.value.trim();
    const c = comments.find((x) => x.id === replyingTo);
    if (!text || !c) return;
    c.replies.push({ name: participantName, ts: Date.now(), text: text });
    saveComments();
    renderComments();
    closeReply();
  });

  renderComments();
})();
