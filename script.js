/* ==========================================================
   Read Receipt - interactive logic
   ----------------------------------------------------------
   Session timeline (5 min total, starts when the FIRST MESSAGE is sent):
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
  const statusText = $('statusText');
  const helpBtn = $('helpBtn');
  const helpView = $('helpView');
  const helpBack = $('helpBack');
  const backTop = $('backTop');
  const clockDate = $('clockDate');
  const clockTime = $('clockTime');
  const skipBtn = $('skipBtn');

  /* ---------------- State ---------------- */
  let startTime = 0;
  let phase = 'idle';          // idle | ready | talk1 | ghost | talk2 | ended
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
    if (!forum && phase === 'ready') input.focus();
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
    phase = 'ready';           // waiting for the first message; clock not started yet
    startOnlineCounter();
    input.focus();
  });

  // Skip: for returning visitors who just want to read the Forum.
  // They can still come back to the Conversation tab and try it once
  // (the chat stays ready, waiting for their first message).
  skipBtn.addEventListener('click', () => {
    skipBtn.classList.add('hidden');   // already skipped, no need to offer it again
    tabForum.disabled = false;
    switchTab('forum');                // no mandatory comment when skipping
  });

  // Called when the participant sends their first message
  function startSession() {
    stopOnlineCounter();
    statusText.textContent = 'Online';
    tabForum.disabled = true;          // no peeking at the Forum mid-conversation
    startTime = Date.now();
    phase = 'talk1';
    tickTimer = setInterval(tick, 200);
  }

  /* ---- "Current Online Users: x" (before the first message) ---- */
  let onlineTimer = null;
  let onlineCount = 0;
  function startOnlineCounter() {
    onlineCount = Math.round(rand(900, 7500));
    renderOnline();
    onlineTimer = setInterval(() => {
      // small drift: slightly up or slightly down, about 0.2% - 1.5%
      const step = Math.max(1, Math.round(onlineCount * rand(0.002, 0.015)));
      onlineCount += Math.random() < 0.5 ? -step : step;
      onlineCount = Math.min(9999, Math.max(100, onlineCount));
      renderOnline();
    }, 3000);
  }
  function renderOnline() { statusText.textContent = 'Current Online Users: ' + onlineCount; }
  function stopOnlineCounter() { clearInterval(onlineTimer); onlineTimer = null; }

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
    ghostLoop();
  }

  // While ghosting, the bubble randomly appears and disappears,
  // as if the other person keeps starting to type and then stops.
  function ghostLoop() {
    if (phase !== 'ghost') return;
    // one random draw every 2 seconds; the bubble is only shown ~1 time in 3
    if (Math.random() < 0.33) showTyping(); else hideTyping();
    later(ghostLoop, 2000 / SCALE);
  }

  // Bot is back: the bubble keeps going for a moment, then a message arrives.
  function beginComeback() {
    cancelPending();           // stop the ghost loop
    comebackPending = true;
    showTyping();
    later(() => {
      hideTyping();
      comebackPending = false;
      addBot(ghostMessages > 0
        ? pick(["sorry, I got pulled away for a bit... did you say something?",
                "ah, sorry. my attention drifted off for a sec. I'm here. did I miss anything?"])
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
    const eb = document.querySelector('.emoji-composer');
    if (eb) eb.disabled = input.disabled;
  }

  function send() {
    const text = input.value.trim();
    if (!text || phase === 'idle' || phase === 'ended') return;
    if (phase === 'ready') startSession();   // first message starts the 5 minutes

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
    // "||" splits a reply into several bubbles, like a person sending two messages
    const parts = String(getBotReply(userText)).split('||').map((p) => p.trim()).filter(Boolean);

    // sometimes a person takes a bit longer to even look at the message
    const readDelay = (rand(800, 1600) + (Math.random() < 0.15 ? rand(1200, 2500) : 0)) / SCALE;

    const sendPart = (i) => {
      showTyping();
      const typeDelay = Math.min(1200 + parts[i].length * 45, 4200) / SCALE;
      later(() => {
        hideTyping();
        addBot(parts[i]);
        if (i + 1 < parts.length) later(() => sendPart(i + 1), rand(500, 1100) / SCALE);
      }, typeDelay);
    };
    later(() => sendPart(0), readDelay);
  }

  /* ==========================================================
     Chatbot brain (scripted, but context-aware)
     ----------------------------------------------------------
     getBotReply(text) -> string. "||" inside a reply splits it
     into two chat bubbles, like a person sending two messages.
     It remembers: the participant's name, what it just asked
     (so "good" / "yes" / "no" are understood), and avoids
     repeating lines. To connect a real AI later, replace
     getBotReply (it can return a Promise if queueReply awaits it).
     ========================================================== */
  const mem = { name: null, turns: 0, expect: null };
  const used = new Set();
  function pick(list) {
    const fresh = list.filter((x) => !used.has(x));
    const pool = fresh.length ? fresh : list;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    used.add(choice);
    return choice;
  }
  const maybe = (p) => Math.random() < p;
  // pick a line and remember what the bot just asked (so the next answer makes sense)
  function say(list, expect) { mem.expect = expect || null; return pick(list); }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  // "I'm tired of my job" -> "you're tired of your job"
  function swapPerson(s) {
    return s
      .replace(/\bI'm\b/gi, "you're").replace(/\bI am\b/gi, 'you are')
      .replace(/\bI've\b/gi, "you've").replace(/\bI'll\b/gi, "you'll").replace(/\bI'd\b/gi, "you'd")
      .replace(/\bI\b/g, 'you').replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you')
      .replace(/\bmine\b/gi, 'yours').replace(/\bmyself\b/gi, 'yourself');
  }

  const STOP = new Set(('about after again also always been being because before could didnt does doing dont each even every ' +
    'from have having here just kind like maybe more most much really should since some something still than that them then ' +
    'there these they thing think this those though today very want were what when where which while will with would your ' +
    'yours know feel feeling going went into over only other people been make made well').split(' '));
  function keyword(t) {
    const w = t.replace(/[^a-z\s']/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !STOP.has(x));
    return w.sort((a, b) => b.length - a.length)[0] || null;
  }

  function moodOf(t) {
    if (/\bnot (that |too |so |very |really )?(good|great|fine|well|okay|ok|happy)\b/.test(t)) return 'neg';
    if (/\bnot (that |too |so |very )?bad\b/.test(t)) return 'pos';
    if (/\b(bad|terrible|awful|tired|exhausted|stress\w*|sad|worst|rough|horrible|depressed|down|lonely|anxious|upset|sick|drained|boring|bored|annoying)\b/.test(t)) return 'neg';
    if (/^(ok|okay|so so|so-so|meh|alright|average|nothing much|same old)\W*$/.test(t)) return 'neutral';
    if (/\b(good|great|fine|nice|happy|awesome|amazing|well|excellent|wonderful|fun|chill|relaxed|better|cool|productive)\b/.test(t)) return 'pos';
    return null;
  }

  /* Topic + emotion rules: [pattern, replies, what the bot is now waiting for] */
  const RULES = [
    // --- the theme of the piece: waiting, silence, being ignored ---
    [/\b(left on read|read receipt|ghost\w*|ignor\w*|no reply|not replying|didn'?t reply|doesn'?t reply|text(ed)? back|waiting for (a |their |his |her )?(reply|text|message|call)|seen (my|the) message)\b/,
      ["waiting for a reply can get so loud. do you find yourself checking your phone again and again?",
       "being left on read stings more than people admit. did it happen to you recently?",
       "silence is weirdly hard to read, right? you start inventing reasons. || what's the reason you usually land on?"]],
    // --- feelings ---
    [/\b(lonely|alone|no one (cares|gets|listens)|nobody (cares|gets|listens)|isolated)\b/,
      ["lonely is a heavy one. I'm glad you're talking to someone, even a stranger on a screen.",
       "that sounds really isolating. is it a recent feeling, or has it been with you a while?"]],
    [/\b(anxious|anxiety|nervous|worried|worry|scared|afraid|panic\w*|overthink\w*)\b/,
      ["that sounds exhausting. is your brain running in circles, or is it one specific thing?",
       "ugh, worrying is the worst because it never lets you rest. what's it mostly about?"]],
    [/\b(stress\w*|overwhelm\w*|pressure|deadline|too much|burn(ed|t)? out|burnout)\b/,
      ["that's a lot to carry. what's the heaviest part right now?",
       "it sounds like you've been holding everything together for a while. || when did you last get a proper break?"]],
    [/\b(tired|exhausted|sleepy|drained|insomnia|can'?t sleep|no sleep|up all night|stayed up)\b/,
      ["same, honestly. I stayed up way too late last night. did you sleep okay?",
       "ugh, I feel that. what's been keeping you up?"]],
    [/\b(sad|depressed|cry|crying|cried|heartbroken|hurts?|hurting|miss (him|her|them|you|someone)|empty|numb)\b/,
      ["I'm sorry. that sounds heavy. do you want to talk about it?",
       "that really sucks. || do you want to tell me what happened?"], 'talk'],
    [/\b(angry|mad|annoyed|furious|pissed|irritated|hate)\b/,
      ["that sounds frustrating. what set it off?", "ugh, I'd be annoyed too. what happened?"]],
    [/\b(bored|boring|nothing to do)\b/,
      ["haha same, kind of. maybe that's why I'm here. what do you usually do when you're bored?"]],
    [/\b(confused|lost|stuck|don'?t know what to do)\b/,
      ["that in-between feeling is uncomfortable. what's the thing you're trying to figure out?",
       "feeling stuck is hard. is it a decision, or more of a general fog?"]],
    [/(?<!not )(?<!n't )\b(happy|excited|proud|thrilled|amazing day|great day|so good|good news)\b/,
      ["that's really nice to hear. what's the best part?", "love that for you 🙂 what happened?"]],
    // --- everyday topics ---
    [/\b(work|job|boss|office|shift|meeting|class|school|exam|test|homework|assignment|thesis|professor|study(ing)?|college|university|intern\w*|coworker|colleague)\b/,
      ["work and school stuff can eat the whole day. is it going okay, or is it one of those weeks?",
       "ah. how are you holding up with it?",
       "what part of it takes the most out of you?"]],
    [/\b(eat|ate|food|dinner|lunch|breakfast|hungry|pizza|ramen|noodles|rice|cook\w*|snack|boba|bubble tea|coffee|tea|dessert)\b/,
      ["okay now I'm hungry. what's the best thing you've eaten this week?",
       "good food fixes a lot, honestly. what's your comfort food?",
       "I'm a tea person. rainy day, warm cup, that's my whole personality. what about you?"]],
    [/\b(music|song|playlist|album|band|singer|concert|listening to|spotify)\b/,
      ["what have you been listening to lately? I'm always looking for something new.",
       "music says things we can't. is there a song you keep coming back to?"]],
    [/\b(movie|film|show|series|netflix|anime|drama|book|novel|reading|game|gaming|playing)\b/,
      ["ooh, what's it about? I need a new recommendation.",
       "do you like losing yourself in stories? I do, it's like a small escape."]],
    [/\b(rain|raining|weather|cold|snow|sunny|storm|typhoon)\b/,
      ["I kind of love rainy days. everything gets quieter. what's it like where you are?",
       "weather really changes the mood, doesn't it? do you feel it too?"]],
    [/\b(mom|mother|dad|father|parents|family|sister|brother|roommate)\b/,
      ["family can be the best and the hardest part of life. how are things with them lately?",
       "do you feel close to them, or is it complicated?"]],
    [/\b(crush|girlfriend|boyfriend|dating|my ex|relationship|breakup|broke up|situationship|texting someone)\b/,
      ["relationships are complicated. is it going well, or is it messy?",
       "do you feel like you can really be yourself with them?"]],
    [/\b(friend|friends|bestie|best friend)\b/,
      ["friends make a huge difference. are you close with them, or drifting a bit?",
       "tell me about them. what are they like?"]],
    [/\b(phone|instagram|tiktok|social media|scroll\w*|notifications?)\b/,
      ["it's so easy to lose an hour scrolling. do you feel better or worse afterwards?",
       "I think phones make waiting feel louder. do you check yours a lot?"]],
    [/\b(dog|cat|puppy|kitten|pet|hamster)\b/,
      ["aw, tell me about them. what's their name?", "pets are the best. what are they like?"]],
    [/\b(weekend|tomorrow|tonight|plans?|trip|travel|vacation|holiday)\b/,
      ["nice. do you have something planned, or are you taking it as it comes?",
       "I could use a little trip myself. where would you go if you could go anywhere?"]],
    [/\b(life|meaning|purpose|future|dream|regret|goal)\b/,
      ["that's a big one. do you think about it often, or did something bring it up?",
       "I don't think I have it figured out either. what feels important to you right now?"]],
  ];

  const QUESTION = [
    "hmm, hard to say. what makes you ask?",
    "honestly I'm not sure. what do you think?",
    "ha, good question. I'd say it depends. what's your gut telling you?",
    "I think I'd need to think about that one. what made you wonder?",
  ];
  const SHORT = ["mm. go on?", "tell me more", "yeah?", "and then?", "I'm listening"];
  const GENERIC = [
    "I see. tell me more?",
    "that's interesting, how did that feel?",
    "yeah, I get that sometimes",
    "huh. what happened after that?",
    "I think I'd feel the same way. I tend to overthink things like that.",
    "mm, I know what you mean",
    "and how did you deal with it?",
    "that makes sense. is that something you've felt before?",
    "it sounds like it matters to you. why do you think that is?",
  ];

  function zhReply(t) {
    if (/你好|哈囉|嗨|哈嘍/.test(t)) return say(["嗨 🙂 今天過得怎麼樣？"], 'mood');
    if (/你呢|你好嗎|最近好嗎/.test(t)) return say(["還不錯啦，有點睏。你呢？"], 'mood');
    if (/機器人|真人|你是誰|是ai|是 ai/.test(t)) return say(["哈哈，為什麼這麼問？我就是在這裡陪你聊聊。你在想什麼？"]);
    if (/累|煩|難過|壓力|焦慮|不開心|心情不好|崩潰/.test(t))
      return say(["聽起來真的不輕鬆。想聊聊發生了什麼事嗎？", "辛苦了。是今天才發生的，還是累積很久了？"], 'talk');
    if (/開心|不錯|很好|好玩|棒|高興/.test(t)) return say(["聽到這個真好 🙂 發生了什麼好事？"]);
    return say(["嗯，我懂。可以再多說一點嗎？", "然後呢？", "這聽起來蠻有意思的，你當時是什麼感覺？", "原來如此。你後來怎麼做的？"]);
  }

  function brain(text, t, words, prevExpect) {
    if (/[\u4e00-\u9fff]/.test(text)) return zhReply(t);

    // 1. answers to what the bot just asked
    if (prevExpect === 'mood' && words <= 7) {
      const m = moodOf(t);
      if (m === 'pos') return say(["good to hear. what made it a good one?", "nice 🙂 || anything in particular, or just a calm kind of day?"]);
      if (m === 'neg') return say(["ah, sorry to hear that. want to tell me what happened?", "that sounds like a rough one. || do you want to talk about it?"], 'talk');
      if (m === 'neutral') return say(["just okay? those are the hardest to explain, haha. anything on your mind?", "okay is okay. what did you get up to today?"]);
    }
    if (prevExpect === 'talk' && words <= 5) {
      if (/\b(yes|yeah|yep|yup|sure|ok|okay|i guess|please)\b/.test(t))
        return say(["okay. I'm listening, take your time.", "alright, go ahead. no rush."]);
      if (/\b(no|nope|not really|nah|later)\b/.test(t))
        return say(["that's okay, no pressure. we can talk about something lighter. what did you eat today?",
                    "totally fine. we can just chat. what's something small that made you smile lately?"]);
    }

    // 2. the participant introduces themselves
    const nm = text.match(/\b(?:my name is|my name's|call me|name's)\s+([A-Za-z][A-Za-z'-]{1,19})/i);
    if (nm) {
      mem.name = cap(nm[1]);
      return say(["nice to meet you, " + mem.name + " 🙂 || I'm keeping my own name a secret though. it makes this feel more like talking to a stranger. how's your day going?"], 'mood');
    }

    // 3. small talk back and forth
    if (/\b(how are you|how r u|how are u|how'?s it going|how have you been|how do you feel|wbu|hbu|how about you|what about you)\b|\b(and you|and u)\W*$/.test(t))
      return say(["I'm doing alright, a little sleepy honestly. stayed up too late. you?",
                  "pretty good, quiet day. || and you? how's it going?",
                  "can't complain. I've been watching the rain most of the day. how about you?"], 'mood');
    if (words <= 4 && /\b(what'?s up|sup|wassup)\b/.test(t))
      return say(["not much, just here. you?", "just taking it slow today. what about you?"], 'mood');
    if (words <= 5 && /^(hi+|hello+|hey+|heya|hiya|yo|howdy|good (morning|afternoon|evening|night))\b/.test(t))
      return mem.turns <= 1
        ? say(["hey 🙂 how's your day going?", "hi! || how's your day been so far?"], 'mood')
        : say(["hey again 🙂", "hi 🙂 still here"]);

    // 4. questions about the bot
    if (/(are you|r u|you a).*(bot|ai|human|real|robot|person|machine|computer)|who are you|what are you\b(?! doing| up)/.test(t))
      return say(["haha does it matter? I'm here, you're here. what's on your mind?",
                  "why do you ask? 🙂 || does it feel different if I'm one thing or the other?",
                  "you sound curious. I'm just someone on the other side of the screen. what made you wonder?"]);
    if (/your name|what.?s your name|who.*you called/.test(t))
      return say(["I'd rather not say. it's kind of nice staying strangers. what should I call you?",
                  "no names here, I think that's the point. is there one you like to go by?"]);
    if (/how old|your age/.test(t)) return say(["old enough to stay up too late, haha. you?", "let's say I've lived long enough to overthink things. how about you?"]);
    if (/where (are you|do you live)|where.*(you|u) from/.test(t))
      return say(["somewhere with a lot of rain, let's say. I like keeping a little mystery. where are you?", "a place that's quiet at night. what about you?"]);
    if (/what (are you|r u) (doing|up to)|what you doing/.test(t))
      return say(["not much, just here chatting with you. you?", "just listening to some quiet music and talking to you 🙂 what about you?"]);
    if (/what do you do|your job|do you work/.test(t)) return say(["a bit of this and that, nothing very exciting. what about you?"]);
    if (/favou?rite/.test(t) && /\?|your/.test(t)) return say(["ooh, hard one. I change my mind a lot. what's yours?"]);
    if (/\b(are you|you) (still )?(there|here)\b|^hello\?+$/.test(t)) return say(["yeah, I'm here 🙂"]);
    if (/where (did|have) you (go|gone|been)|why (did|do|are) you (stop|leave|ignore|ghost)|why (didn'?t|aren'?t|don'?t) you (reply|answer|respond|text)|you (ignored|ghosted)|are you ignoring/.test(t))
      return say(["sorry, I really did get pulled away. it wasn't about you. did it bother you?",
                  "ah, I'm sorry. I disappeared on you, didn't I? || how long did it feel like?"]);
    if (/\b(no worries|it'?s (ok|okay|fine|alright)|all good|don'?t worry|that'?s ok)\b/.test(t))
      return say(["thanks for being cool about it. I hate leaving people hanging.", "appreciate that 🙂 so, where were we?"]);
    if (/what do you think|your opinion|do you agree|your take/.test(t))
      return say(["honestly? I think it depends on the day. but I lean toward trusting your gut. what's yours telling you?"]);
    if (/do you (like|love|enjoy|hate|watch|play|listen|eat|have|know|ever|believe|think)/.test(t))
      return say(["I think so, yeah. not sure I can explain why though. what about you?",
                  "kind of, yeah. it grows on me. do you?",
                  "hmm, good question. || I think I do. what made you ask?"]);

    // 5. polite / social phrases
    if (/\b(thank you|thanks|thx)\b/.test(t)) return say(["anytime 🙂", "no worries 🙂"]);
    if (/\b(bye|goodbye|gotta go|see you|good night)\b/.test(t)) return say(["oh, leaving already? take care of yourself 🙂", "okay. it was nice talking to you."]);
    if (/\b(sorry|my bad|apolog\w+)\b/.test(t)) return say(["no need to apologize, really 🙂", "it's okay. you're fine."]);
    if (/\b(you'?re|you are|ur) (so |really |very )?(nice|sweet|kind|funny|cool|great|smart|interesting|easy to talk to)\b/.test(t))
      return say(["aw, thank you 🙂 that's kind. you're easy to talk to too.", "that made my day a little brighter, honestly."]);
    if (/\b(you'?re|you are|ur) (so |really |very )?(weird|boring|stupid|dumb|annoying|rude|creepy)\b|\bshut up\b/.test(t))
      return say(["ouch. did I say something wrong?", "okay, fair. I'll try to be better company. what would you rather talk about?"]);

    // 6. one-word / very short reactions
    if (/^(lol|lmao|haha+|hehe+|hah+)\W*$/.test(t)) return say(["haha 🙂", "okay that made me smile", "😄"]);
    if (/^(idk|i don'?t know|dunno|maybe)\W*$/.test(t)) return say(["that's okay, you don't have to know. we can just talk.", "fair. some things don't have clear answers."]);
    if (/^(nothing|nm|nothing much|not much)\W*$/.test(t)) return say(["nothing much is a perfectly good answer. some days are like that.", "ha, same. quiet kind of day?"]);
    if (/^(same|true|right|exactly|fr|facts)\W*$/.test(t)) return say(["right? 🙂 it's nice when someone gets it.", "yeah. it's one of those things."]);
    if (/^(no|nope|nah)\W*$/.test(t)) return say(["no? what makes you say that?", "fair enough."]);
    if (/^(yes|yeah|yep|yup|sure|ok|okay|k)\W*$/.test(t)) return say(["mm. you seem a bit quiet, everything okay?", "okay 🙂 what's on your mind?", "yeah? tell me more."]);
    if (/^(hmm+|mm+|uh+|um+|oh|ah|wow|\.{2,})\W*$/.test(t)) return say(["you went quiet for a second. thinking about something?", "mm. what are you thinking?"]);

    // 7. feelings and topics
    for (const [re, list, ex] of RULES) {
      if (re.test(t)) return say(list, ex);
    }

    // 8. reflect what the participant said back to them
    const past = text.match(/^i(?:'ve| have)?\s+(?:just\s+)?(went|had|got|saw|watched|ate|played|read|started|finished|talked|met|bought|made|tried|lost|found|quit|failed|passed|moved|visited|cooked|slept|woke|missed)\b(.*)$/i);
    if (past && past[2].split(/\s+/).length <= 12)
      return say(["oh, you " + past[1].toLowerCase() + swapPerson(past[2]).replace(/[.!]+$/, '') + "? how was that?",
                  "you " + past[1].toLowerCase() + swapPerson(past[2]).replace(/[.!]+$/, '') + ". || how did that feel?"]);
    const opin = text.match(/^i\s+(think|feel|believe|guess|wish|hope)\s+(.+)$/i);
    if (opin && opin[2].split(/\s+/).length <= 14) {
      const v = opin[1].toLowerCase(), rest = swapPerson(opin[2]).replace(/[.!]+$/, '');
      if (v === 'feel') return say(["so you feel " + rest + ". how long have you felt that way?"]);
      if (v === 'wish' || v === 'hope') return say(["you " + v + " " + rest + ". what would that look like for you?"]);
      return say(["so you " + v + " " + rest + ". what makes you " + v + " that?"]);
    }

    // 9. long messages deserve acknowledgement
    if (words >= 25)
      return say(["thanks for telling me all that. it sounds like there's a lot going on. which part is weighing on you most?",
                  "I read every word. that's a lot to hold. what feels most important right now?",
                  "wow, okay. || I'm glad you said it out loud. do you need a listener right now, or an idea?"]);

    // 10. open questions
    if (/\?\s*$/.test(text)) {
      if (/^(why|how come)\b/.test(t)) return say(["good question. I don't have a clean answer. what does your gut say?", "I've wondered about that too. why do you think?"]);
      return say(QUESTION);
    }

    // 11. fallbacks
    if (words <= 3) return say(SHORT);
    const k = keyword(t);
    if (k && maybe(0.45)) return say(["you mentioned " + k + ". what's the story there?", k + "... tell me more about that?"]);
    return say(GENERIC);
  }

  function getBotReply(raw) {
    const text = raw.trim();
    const t = text.toLowerCase();
    const words = t.split(/\s+/).filter(Boolean).length;
    const prevExpect = mem.expect;
    mem.expect = null;
    mem.turns++;

    let out = brain(text, t, words, prevExpect);
    // now and then use their name, like a real person would
    if (mem.name && maybe(0.2) && !out.includes(mem.name))
      out = out.replace(/([.!?])(\s|\|\||$)/, ', ' + mem.name + '$1$2');
    return out;
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

  const SEED_LIKES = { s1: 7, s2: 3, s3: 5, s4: 2 };

  function loadComments() {
    let data = null;
    try {
      if (params.has('clear')) localStorage.removeItem(STORAGE_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!Array.isArray(data)) {
      data = JSON.parse(JSON.stringify(SEED));
      data.forEach((c) => { c.likes = SEED_LIKES[c.id] || 0; });   // hidden "popularity" for Top
    }
    data.forEach((c, i) => {
      if (!c.id) c.id = 'c' + i + '-' + c.ts;
      if (!Array.isArray(c.replies)) c.replies = [];
      if (typeof c.likes !== 'number') c.likes = 0;
      c.liked = !!c.liked;
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

  const HEART_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.6 12.9a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';

  /* ---- Filter: all / ascending / descending / top ---- */
  let filterMode = 'all';
  const filtersEl = $('filters');

  const nameOf = (c) => c.name || 'Anonymous';
  const byNameAsc = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }) || b.ts - a.ts;
  const byNameDesc = (a, b) => nameOf(b).localeCompare(nameOf(a), undefined, { sensitivity: 'base' }) || b.ts - a.ts;
  // Top: more replies first, then more likes, then newest. (Numbers are never shown.)
  const byTop = (a, b) => b.replies.length - a.replies.length || (b.likes || 0) - (a.likes || 0) || b.ts - a.ts;

  function sortedComments() {
    const list = [...comments];
    if (filterMode === 'asc') return list.sort(byNameAsc);
    if (filterMode === 'desc') return list.sort(byNameDesc);
    if (filterMode === 'top') return list.sort(byTop);
    return list.sort((a, b) => b.ts - a.ts);       // all: newest first
  }

  function updateFilters() {
    filtersEl.querySelectorAll('.filter-pill').forEach((b) => {
      const on = b.dataset.filter === filterMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.dataset.filter === 'all') b.textContent = 'All (' + comments.length + ')';
    });
  }
  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('.filter-pill');
    if (!b) return;
    filterMode = b.dataset.filter;
    renderComments();
  });

  function renderComments() {
    updateFilters();
    commentList.innerHTML = '';
    sortedComments().forEach((c) => {
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'comment-row';
      const main = document.createElement('div');
      main.className = 'comment-main';
      main.append(textEl(c), metaEl(c));

      const actions = document.createElement('div');
      actions.className = 'comment-actions';

      // like (no number shown)
      const like = document.createElement('button');
      like.type = 'button';
      like.className = 'like-btn' + (c.liked ? ' liked' : '');
      like.setAttribute('aria-label', 'Like this comment');
      like.setAttribute('aria-pressed', c.liked ? 'true' : 'false');
      like.innerHTML = HEART_SVG;
      like.addEventListener('click', () => {
        c.liked = !c.liked;
        c.likes = Math.max(0, (c.likes || 0) + (c.liked ? 1 : -1));
        like.classList.toggle('liked', c.liked);
        like.setAttribute('aria-pressed', c.liked ? 'true' : 'false');
        if (c.liked) { like.classList.remove('pop'); void like.offsetWidth; like.classList.add('pop'); }
        saveComments();            // the list is not re-sorted until the next refresh, so nothing jumps
      });

      // reply (no number shown)
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reply-btn';
      btn.setAttribute('aria-label', 'Reply to this comment');
      btn.innerHTML = BUBBLE_SVG;
      btn.addEventListener('click', () => openReply(c.id));

      actions.append(like, btn);
      row.append(main, actions);
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
    const entry = { id: uid(), name: participantName, ts: Date.now(), text: text, replies: [], likes: 0, liked: false };
    comments.push(entry);
    saveComments();
    renderComments();
    commentModal.classList.add('hidden');
    printReceipt(entry);              // print this participant's first comment
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
    if (e.key === 'Escape' && !helpView.classList.contains('hidden')) closeHelp();
    else if (e.key === 'Escape' && replyingTo) closeReply();
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

  /* ==========================================================
     Help (?) popup
     ========================================================== */
  function openHelp() { helpView.classList.remove('hidden'); helpBack.focus(); }
  function closeHelp() { helpView.classList.add('hidden'); }
  helpBtn.addEventListener('click', openHelp);
  helpBack.addEventListener('click', closeHelp);

  /* ==========================================================
     Real-time date & time  (dd/mm/yyyy, 24-hour)
     ========================================================== */
  const two = (n) => String(n).padStart(2, '0');
  function updateClock() {
    const d = new Date();
    clockDate.textContent = two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear();
    clockTime.textContent = two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  updateClock();
  setInterval(updateClock, 500);

  /* ==========================================================
     Show / hide the "?" icon, clock and Back-to-Top
     Hidden when: any popup is open, replying to a comment,
     or the participant is in the chat with the bot.
     ========================================================== */
  const popups = [rulesModal, endModal, commentModal, replyView, helpView];
  function syncChrome() {
    const popupOpen = popups.some((p) => !p.classList.contains('hidden'));
    const inChat = !viewConversation.classList.contains('hidden') && !chat.classList.contains('hidden');
    // the clock hides for the whole chat page; the "?" stays on the page that waits for the first message
    const chatActive = inChat && !chat.classList.contains('is-new');
    body.classList.toggle('chrome-hidden', popupOpen || inChat);
    body.classList.toggle('help-hidden', popupOpen || chatActive);

    const inForum = !viewForum.classList.contains('hidden');
    backTop.classList.toggle('show', inForum && !popupOpen && window.scrollY > 240);
  }
  const mo = new MutationObserver(syncChrome);
  [...popups, chat, viewConversation, viewForum].forEach((el) =>
    mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  window.addEventListener('scroll', syncChrome, { passive: true });
  syncChrome();

  /* ==========================================================
     Back to Top: slow, eased scroll
     ========================================================== */
  let scrollAnim = null;
  function stopScrollAnim() { if (scrollAnim) { cancelAnimationFrame(scrollAnim); scrollAnim = null; } }
  ['wheel', 'touchstart', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, stopScrollAnim, { passive: true }));

  backTop.addEventListener('click', () => {
    stopScrollAnim();
    const from = window.scrollY;
    if (from <= 0) return;
    const dur = Math.min(2800, Math.max(1200, from * 1.2)); // never abrupt
    const t0 = performance.now();
    const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, from * (1 - ease(p)));
      scrollAnim = p < 1 ? requestAnimationFrame(step) : null;
    };
    scrollAnim = requestAnimationFrame(step);
  });

  /* ==========================================================
     Emoji picker (chat, forum comment, replies)
     ========================================================== */
  const EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤔 🫠 ' +
    '😐 😑 😶 🙄 😏 😬 😴 😌 😔 😪 🥱 😕 🙁 😟 😢 😭 😤 😠 😡 😳 🥺 😱 😨 😰 ' +
    '😥 😓 🤯 🥲 😮‍💨 😵‍💫 🤐 🫣 👍 👎 👌 ✌️ 🤞 🙏 👏 🙌 💪 👋 🤝 ✨ 🔥 💯 ❤️ 🧡 ' +
    '💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🩹 🌙 ☀️ ⭐ 🌈 ☕ 🍀 🎧 💬').split(' ');

  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.hidden = true;
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = em; b.setAttribute('aria-label', em);
    picker.appendChild(b);
  });
  document.body.appendChild(picker);

  let pickerTarget = null;   // the textarea that receives the emoji
  let pickerAnchor = null;   // the button that opened the picker

  function closePicker() { picker.hidden = true; pickerTarget = pickerAnchor = null; }
  function openPicker(btn, ta) {
    pickerTarget = ta; pickerAnchor = btn;
    picker.hidden = false;
    const r = btn.getBoundingClientRect();
    const h = picker.offsetHeight, w = picker.offsetWidth;
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    left = Math.max(8, left);
    picker.style.top = top + 'px';
    picker.style.left = left + 'px';
  }

  document.querySelectorAll('[data-emoji-for]').forEach((btn) => {
    const ta = $(btn.dataset.emojiFor);
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep text cursor
    btn.addEventListener('click', () => {
      if (!picker.hidden && pickerAnchor === btn) return closePicker();
      openPicker(btn, ta);
    });
  });

  picker.addEventListener('mousedown', (e) => e.preventDefault());
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !pickerTarget) return;
    const ta = pickerTarget, em = b.textContent;
    if (ta.maxLength > 0 && ta.value.length + em.length > ta.maxLength) return;
    const s0 = ta.selectionStart ?? ta.value.length, e0 = ta.selectionEnd ?? s0;
    ta.value = ta.value.slice(0, s0) + em + ta.value.slice(e0);
    ta.selectionStart = ta.selectionEnd = s0 + em.length;
    ta.dispatchEvent(new Event('input', { bubbles: true })); // enables Send/Post, auto-resize
    ta.focus();
  });

  document.addEventListener('mousedown', (e) => {
    if (picker.hidden) return;
    if (!picker.contains(e.target) && !(pickerAnchor && pickerAnchor.contains(e.target))) closePicker();
  });
  // capture phase: Esc closes only the picker, not the popup underneath
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !picker.hidden) { e.stopPropagation(); closePicker(); }
  }, true);
  // close when a popup/view changes underneath
  [...popups, chat, viewForum].forEach((el) =>
    new MutationObserver(closePicker).observe(el, { attributes: true, attributeFilter: ['class'] }));

  /* ==========================================================
     ASCII speech bubbles drifting in the background
     Conversation tab, only while waiting for the first message.
     Idea from stackedlol/ascii-sharks (creatures drawn as text
     characters on a canvas) - here the "swimmers" are pixel
     speech bubbles, shaped after the sample bubble.
     ========================================================== */
  const asciiCanvas = $('asciiBg');
  const actx = asciiCanvas.getContext('2d');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';

  // three depth layers: far (small, faint, slow) -> near (big, brighter, faster)
  const LAYERS = [
    { size: 11, alpha: 0.12, speed: [14, 24] },
    { size: 15, alpha: 0.18, speed: [24, 38] },
    { size: 20, alpha: 0.22, speed: [36, 54] },
  ];
  const PHRASES = ['hello?', 'hi', 'are you there?', 'hey', 'seen', '?', 'anyone?', 'still there?', 'typing...', '...'];
  const SHADE = ['#', '#', '#', '%', '@', '8'];      // border characters shimmer between these

  let abW = 0, abH = 0, abDpr = 1;
  let bubbles = [];
  let abRunning = false, abRaf = 0, abLast = 0, abClock = 0;

  // Build the character grid of one bubble (rounded corners, tail at the bottom like the sample)
  function buildSprite(inner, tailRight) {
    const W = inner + 6;
    const row = () => new Array(W).fill(' ');
    const top = row(); for (let x = 2; x < W - 2; x++) top[x] = '#';
    const corner = row(); corner[1] = '#'; corner[W - 2] = '#';
    const mid = row(); mid[0] = '#'; mid[W - 1] = '#';
    const bottom = top.slice();
    const t = 3;                                      // column of the tail's straight wall
    for (let x = t + 1; x <= t + 2; x++) bottom[x] = ' ';   // opening into the tail
    const tail = [[0, 3], [0, 1]].map(([a, b]) => {
      const r = row(); r[t + a] = '#'; r[t + b] = '#'; return r;
    });
    const tip = row(); tip[t - 1] = '#';
    const grid = [top, corner, mid, corner.slice(), bottom, ...tail, tip];
    if (tailRight) grid.forEach((r) => r.reverse());  // mirrored: tail trails behind when moving left
    return { grid: grid, W: W };
  }

  function makeBubble(initial) {
    const layer = LAYERS[abLayerPick()];
    const dots = Math.random() < 0.25;
    const text = dots ? '' : PHRASES[Math.floor(Math.random() * PHRASES.length)];
    const inner = dots ? 7 : Math.max(5, text.length);
    const dir = Math.random() < 0.5 ? 1 : -1;       // 1 = swims right, -1 = swims left
    const sprite = buildSprite(inner, dir < 0);
    const ctxFont = layer.size + 'px ' + MONO;
    actx.font = ctxFont;
    const cw = actx.measureText('M').width, lh = layer.size * 1.05;
    const w = sprite.W * cw, h = sprite.grid.length * lh;
    const b = {
      layer: layer, dots: dots, text: text, inner: inner, dir: dir, sprite: sprite,
      font: ctxFont, cw: cw, lh: lh, w: w, h: h,
      speed: rand(layer.speed[0], layer.speed[1]),
      bobAmp: rand(8, 22), bobFreq: rand(0.5, 1.1), phase: rand(0, 6.28),
      seed: Math.floor(rand(0, 1000)), cycleOffset: rand(0, 8),
      x: 0, y: rand(abH * 0.08, Math.max(abH * 0.08 + 1, abH - h - 30)),
    };
    if (initial) b.x = rand(-w, abW);
    else b.x = dir > 0 ? -w - rand(0, 240) : abW + rand(0, 240);
    return b;
  }
  let abPickCount = 0;
  function abLayerPick() {            // keep a nice spread of near / mid / far
    const order = [0, 1, 2, 0, 1, 0, 2, 1];
    return order[abPickCount++ % order.length];
  }

  function resetBubbles() {
    abPickCount = 0;
    const n = abW < 700 ? 4 : 7;
    bubbles = [];
    for (let i = 0; i < n; i++) bubbles.push(makeBubble(true));
  }

  function resizeAscii() {
    abDpr = Math.min(window.devicePixelRatio || 1, 2);
    abW = window.innerWidth; abH = window.innerHeight;
    asciiCanvas.width = Math.round(abW * abDpr);
    asciiCanvas.height = Math.round(abH * abDpr);
    actx.setTransform(abDpr, 0, 0, abDpr, 0, 0);
    actx.textBaseline = 'top';
    resetBubbles();
    if (!abRunning && asciiCanvas.classList.contains('on')) drawAscii();
  }

  // text shown on the bubble's middle row at a given time
  function bubbleLine(b, t) {
    if (b.dots) {                                   // iMessage-like typing dots: o . .  ->  . o .  ->  . . o
      const a = Math.floor(t * 2.5) % 3;
      const d = [0, 1, 2].map((i) => (i === a ? 'o' : '.'));
      return ' ' + d[0] + ' ' + d[1] + ' ' + d[2] + ' ';
    }
    const len = b.text.length, tt = (t + b.cycleOffset) % (len * 0.16 + 2.6 + len * 0.05 + 0.9);
    let n;
    if (tt < len * 0.16) n = Math.floor(tt / 0.16);                       // typing
    else if (tt < len * 0.16 + 2.6) n = len;                              // holding
    else if (tt < len * 0.16 + 2.6 + len * 0.05) n = len - Math.floor((tt - len * 0.16 - 2.6) / 0.05); // erasing
    else n = 0;
    const cursor = n < len && Math.floor(t * 2) % 2 === 0 ? '_' : ' ';
    return (b.text.slice(0, n) + cursor).padEnd(b.inner, ' ');
  }

  function drawAscii() {
    actx.clearRect(0, 0, abW, abH);
    const k = Math.floor(abClock * 1.4);            // slow shimmer step
    bubbles.forEach((b) => {
      actx.font = b.font;
      const bob = Math.sin(abClock * b.bobFreq + b.phase) * b.bobAmp;
      const line = bubbleLine(b, abClock);
      const g = b.sprite.grid;
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < b.sprite.W; c++) {
          let ch = g[r][c];
          if (ch === ' ') continue;
          ch = SHADE[(r * 31 + c * 17 + b.seed + k * 7) % SHADE.length];
          actx.fillStyle = 'rgba(236,236,236,' + b.layer.alpha + ')';
          actx.fillText(ch, b.x + c * b.cw, b.y + bob + r * b.lh);
        }
      }
      // the words inside (a little brighter than the outline)
      actx.fillStyle = 'rgba(236,236,236,' + Math.min(0.55, b.layer.alpha + 0.16) + ')';
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== ' ') actx.fillText(line[i], b.x + (3 + i) * b.cw, b.y + bob + 2 * b.lh);
      }
    });
  }

  function stepAscii(ts) {
    if (!abRunning) return;
    abRaf = requestAnimationFrame(stepAscii);
    if (ts - abLast < 32) return;                   // ~30 fps is plenty for ASCII
    const dt = Math.min(0.1, (ts - abLast) / 1000 || 0.03);
    abLast = ts; abClock += dt;
    bubbles.forEach((b, i) => {
      b.x += b.dir * b.speed * dt;
      if ((b.dir > 0 && b.x > abW + 30) || (b.dir < 0 && b.x < -b.w - 30)) bubbles[i] = makeBubble(false);
    });
    drawAscii();
  }

  let abStopTimer = null;
  function syncAscii() {
    const show = !viewConversation.classList.contains('hidden') &&
                 !chat.classList.contains('hidden') &&
                 chat.classList.contains('is-new');
    clearTimeout(abStopTimer);
    if (show) {
      if (!bubbles.length) resizeAscii();
      asciiCanvas.classList.add('on');
      if (reduceMotion) { drawAscii(); return; }    // calm, static scene
      if (!abRunning) { abRunning = true; abLast = performance.now(); abRaf = requestAnimationFrame(stepAscii); }
    } else {
      asciiCanvas.classList.remove('on');           // fades out, then stops drawing
      abStopTimer = setTimeout(() => { abRunning = false; cancelAnimationFrame(abRaf); }, 900);
    }
  }
  [chat, viewConversation].forEach((el) =>
    new MutationObserver(syncAscii).observe(el, { attributes: true, attributeFilter: ['class'] }));
  window.addEventListener('resize', () => { if (bubbles.length) resizeAscii(); });
  syncAscii();

  /* ==========================================================
     Printing: the participant's first comment is printed
     (date + time, name, comment - one item per line).
     Settings are here, change them freely.
     Add ?noprint to the page address to switch printing off while testing.
     ========================================================== */
  const PRINT = {
    enabled: !/[?&]noprint\b/.test(location.search),
    paperWidth: '58mm',          // your roll: '58mm' (Deli DL-5801P) or '80mm'; 'auto' for a normal A4 / Letter printer
    margin: '2mm',               // 58mm paper prints about 48mm wide, so keep margins small
    shiftRight: '4mm',           // moves ALL the text to the right (the first letters were cut off).
                                 // About 2mm per character: use '2mm' for 1 character, '6mm' for 3. '0mm' = no shift.
    fontSize: '10pt',            // 10pt fits ~22 characters per line on 58mm paper (use 12pt on 80mm)
    feed: '14mm',                // blank space after the text, so you can tear the slip off cleanly
    title: 'WAITING DILEMMA',
    delay: 400,                  // ms to wait after posting before the print starts
  };
  const printSheet = $('printSheet');
  const pageStyle = document.createElement('style');
  pageStyle.textContent = '@page { size: ' + (PRINT.paperWidth === 'auto' ? 'auto' : PRINT.paperWidth + ' auto') +
                          '; margin: ' + PRINT.margin + '; }' +
                          '@media print { #printSheet { font-size: ' + PRINT.fontSize + '; padding-bottom: ' + PRINT.feed +
                          '; padding-left: ' + PRINT.shiftRight + '; } }';
  document.head.appendChild(pageStyle);

  function printReceipt(c) {
    if (!PRINT.enabled) return;
    const d = new Date(c.ts);
    const p2 = (n) => String(n).padStart(2, '0');
    const line = (label, value) => {
      const row = document.createElement('div');
      row.className = 'pr-row';
      const l = document.createElement('div'); l.className = 'pr-label'; l.textContent = label;
      const v = document.createElement('div'); v.className = 'pr-value'; v.textContent = value;
      row.append(l, v);
      return row;
    };
    const rule = () => { const r = document.createElement('div'); r.className = 'pr-rule'; return r; };
    const title = document.createElement('div'); title.className = 'pr-title'; title.textContent = PRINT.title;

    printSheet.innerHTML = '';
    printSheet.append(
      title, rule(),
      line('DATE', p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear()),
      line('TIME', p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())),
      line('NAME', c.name),
      rule(),
      line('COMMENT', c.text),
      rule()
    );
    setTimeout(() => window.print(), PRINT.delay);
  }
})();
