(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const CARDS = (window.CARDS || []).map((c, i) => ({ ...c, id: c.id || "c" + i }));
  const QUIZ = window.QUIZ || [];
  const TRACKS = window.MUSIC_TRACKS || [];

  /* ---------- storage (safe) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bcoach:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bcoach:" + k, JSON.stringify(v)); } catch {} },
  };
  let known = new Set(store.get("known", []));
  const settings = Object.assign(
    { rate: 0.85, voice: "", natural: true, speed: 1, think: 8, autoSpeak: false, showEs: false, vol: 0.35, duck: true },
    store.get("settings", {})
  );
  const saveSettings = () => store.set("settings", settings);
  const saveKnown = () => { store.set("known", [...known]); updateProgress(); };

  /* ---------- speech ---------- */
  const AUDIO = window.AUDIO || {};
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    const sel = $("voiceSel");
    sel.innerHTML = "";
    if (!voices.length) { sel.innerHTML = "<option>Default English voice</option>"; return; }
    const rank = (v) => (/(google|natural|enhanced|premium|samantha|daniel|serena)/i.test(v.name) ? 0 : 1) + (/en-(US|GB)/i.test(v.lang) ? 0 : 1);
    voices.sort((a, b) => rank(a) - rank(b));
    voices.forEach((v) => { const o = document.createElement("option"); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); });
    if (!settings.voice || !voices.some((v) => v.name === settings.voice)) settings.voice = voices[0].name;
    sel.value = settings.voice;
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

  // Device voice (backup when a natural recording is missing)
  function tts(text) {
    return new Promise((resolve) => {
      if (!synth) { resolve(); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find((x) => x.name === settings.voice);
      if (v) u.voice = v;
      u.lang = v ? v.lang : "en-US";
      u.rate = settings.rate;
      let done = false;
      const end = () => { if (!done) { done = true; resolve(); } };
      u.onend = end; u.onerror = end;
      synth.speak(u);
      setTimeout(() => { if (!synth.speaking) end(); }, 400 + text.length * 120 / settings.rate);
    });
  }

  // Natural recordings (pre-generated neural voice in /audio)
  const voiceEl = new Audio();
  voiceEl.preload = "auto";
  let curDone = null;
  function playFile(f, rate) {
    return new Promise((resolve) => {
      const done = (ok) => { if (curDone !== done) return; curDone = null; voiceEl.onended = voiceEl.onerror = null; resolve(ok); };
      curDone = done;
      voiceEl.defaultPlaybackRate = rate;
      const VD = window.VOICE_DATA || {};
      voiceEl.src = VD[f] || ("audio/" + f + ".mp3");
      voiceEl.playbackRate = rate;
      voiceEl.preservesPitch = true; voiceEl.webkitPreservesPitch = true; voiceEl.mozPreservesPitch = true;
      voiceEl.onended = () => done(true);
      voiceEl.onerror = () => done(false);
      voiceEl.play().catch(() => done(false));
    });
  }
  const natural = (t) => settings.natural && AUDIO[t];

  let token = 0, speakingBtn = null;
  function markBtn(btn) {
    if (speakingBtn) speakingBtn.classList.remove("speaking");
    speakingBtn = btn || null;
    if (btn) btn.classList.add("speaking");
  }
  function stopRaw() {
    try { voiceEl.pause(); } catch {}
    if (curDone) curDone(false);
    if (synth) synth.cancel();
  }
  function stopSpeak() { token++; stopRaw(); markBtn(null); duck(false); clearPh(); }

  async function say(text, file) {
    const my = token;
    let ok = false;
    if (file && settings.natural) ok = await playFile(file, settings.speed);
    if (!ok && my === token) await tts(text);
    return my === token;
  }
  // Speak one full text. Resolves true if it finished (not interrupted).
  async function speak(text, btn) {
    token++; stopRaw(); clearPh(); markBtn(btn); duck(true);
    const my = token;
    const n = natural(text);
    await say(text, n && n.f);
    if (my !== token) return false;
    markBtn(null); duck(false); return true;
  }

  // Phrases of an answer (from the recordings, or split locally)
  function phrasesOf(text) {
    const n = AUDIO[text];
    if (n && n.p && n.p.length) return n.p;
    return text.split(/(?<=[.?!,:;])\s+/).filter(Boolean).map((t) => ({ t }));
  }
  function renderPhrases(el, text) {
    el.innerHTML = phrasesOf(text).map((p, i) => `<span class="ph" data-i="${i}">${esc(p.t)}</span>`).join(" ");
    el.dataset.text = text;
  }
  let phEl = null;
  function clearPh() { if (phEl) phEl.querySelectorAll(".ph").forEach((x) => x.classList.remove("on", "turn")); }
  function markPh(el, i, cls) {
    el.querySelectorAll(".ph").forEach((x, j) => { x.classList.toggle("on", j === i && cls === "on"); x.classList.toggle("turn", j === i && cls === "turn"); });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Listen-and-repeat: phrase, pause for you to repeat, next phrase.
  async function repeatAfterMe(el, btn) {
    const text = el.dataset.text; if (!text) return false;
    token++; stopRaw(); markBtn(btn); duck(true);
    const my = token; phEl = el;
    const ph = phrasesOf(text);
    for (let i = 0; i < ph.length; i++) {
      markPh(el, i, "on");
      const t0 = performance.now();
      if (!(await say(ph[i].t, ph[i].f))) return false;
      const dur = performance.now() - t0;
      markPh(el, i, "turn");
      await sleep(Math.min(9000, dur * 1.25 + 900));
      if (my !== token) return false;
    }
    clearPh(); markBtn(null); duck(false); return true;
  }
  // Tap a single phrase to hear it
  async function playPhrase(el, i) {
    const ph = phrasesOf(el.dataset.text)[i]; if (!ph) return;
    token++; stopRaw(); markBtn(null); duck(true);
    const my = token; phEl = el;
    markPh(el, i, "on");
    await say(ph.t, ph.f);
    if (my !== token) return;
    clearPh(); duck(false);
  }
  document.addEventListener("click", (e) => {
    const s = e.target.closest(".ph"); if (!s) return;
    playPhrase(s.parentElement, +s.dataset.i);
  });

  /* ---------- music ---------- */
  const bgm = $("bgm");
  let track = 0;
  bgm.volume = settings.vol;
  let actx = null, bgGain = null;
  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume().catch(() => {}); return; }
    if (location.protocol === "file:" || window.NO_WEBAUDIO) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = new AC();
      bgGain = actx.createGain(); bgGain.gain.value = settings.vol;
      actx.createMediaElementSource(bgm).connect(bgGain).connect(actx.destination);
      bgm.volume = 1;
    } catch { actx = null; bgGain = null; }
  }
  document.addEventListener("pointerdown", initAudio);
  function setBg(v) { if (bgGain) bgGain.gain.setTargetAtTime(v, actx.currentTime, 0.15); else bgm.volume = v; }
  function duck(on) { setBg(on && settings.duck ? settings.vol * 0.3 : settings.vol); }
  function loadTrack(i) { if (!TRACKS.length) return; track = (i + TRACKS.length) % TRACKS.length; bgm.src = TRACKS[track]; }
  bgm.addEventListener("ended", () => { loadTrack(track + 1); bgm.play().catch(() => {}); });
  bgm.loop = TRACKS.length === 1;
  function musicUI() {
    const playing = !bgm.paused;
    $("musicPlay").textContent = playing ? "❚❚ Pause" : "▶ Play";
    $("musicBtn").classList.toggle("on", playing);
    $("musicHint").textContent = TRACKS.length
      ? `Track ${track + 1} of ${TRACKS.length}: ${TRACKS[track].split("/").pop()}`
      : "No tracks yet. Upload MP3 files to the /music folder and list them in music/tracks.js.";
  }
  $("musicPlay").onclick = () => {
    if (!TRACKS.length) return musicUI();
    if (!bgm.src) loadTrack(0);
    if (bgm.paused) bgm.play().catch(() => {}); else bgm.pause();
  };
  $("musicNext").onclick = () => { if (!TRACKS.length) return; loadTrack(track + 1); bgm.play().catch(() => {}); };
  bgm.addEventListener("play", musicUI); bgm.addEventListener("pause", musicUI);
  $("musicVol").value = settings.vol;
  $("musicVol").oninput = (e) => { settings.vol = +e.target.value; setBg(settings.vol); saveSettings(); };
  $("duck").checked = settings.duck;
  $("duck").onchange = (e) => { settings.duck = e.target.checked; setBg(settings.vol); saveSettings(); };

  /* ---------- sheets ---------- */
  function openSheet(id) { $(id).hidden = false; if (id === "musicSheet") musicUI(); }
  document.querySelectorAll(".sheet").forEach((s) => {
    s.addEventListener("click", (e) => { if (e.target === s || e.target.hasAttribute("data-close")) s.hidden = true; });
  });
  $("musicBtn").onclick = () => openSheet("musicSheet");
  $("settingsBtn").onclick = () => openSheet("settingsSheet");

  $("voiceSel").onchange = (e) => { settings.voice = e.target.value; saveSettings(); stopSpeak(); tts("Hello. My name is Estela. I am your Blacklane chauffeur."); };
  $("natural").checked = settings.natural;
  $("natural").onchange = (e) => { settings.natural = e.target.checked; saveSettings(); };
  const speedLbl = (v) => v.toFixed(2) + "×" + (v <= 0.85 ? " · very slow" : v <= 1.0 ? " · A1 pace" : " · natural");
  $("speed").value = settings.speed; $("speedVal").textContent = speedLbl(settings.speed);
  $("speed").oninput = (e) => { settings.speed = +e.target.value; $("speedVal").textContent = speedLbl(settings.speed); saveSettings(); };
  $("speedTest").onclick = (e) => { const c = CARDS[0]; if (c) speak(c.a, e.currentTarget); };
  $("rate").value = settings.rate; $("rateVal").textContent = settings.rate.toFixed(2);
  $("rate").oninput = (e) => { settings.rate = +e.target.value; $("rateVal").textContent = settings.rate.toFixed(2); saveSettings(); };
  $("thinkSec").value = settings.think; $("thinkVal").textContent = settings.think + " s";
  $("thinkSec").oninput = (e) => { settings.think = +e.target.value; $("thinkVal").textContent = settings.think + " s"; saveSettings(); };
  $("autoSpeak").checked = settings.autoSpeak;
  $("autoSpeak").onchange = (e) => { settings.autoSpeak = e.target.checked; saveSettings(); };
  $("showEs").checked = settings.showEs;
  $("showEs").onchange = (e) => { settings.showEs = e.target.checked; saveSettings(); renderCard(); };
  let resetArmed = false;
  $("resetBtn").onclick = () => {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = "Tap again to confirm"; return; }
    known = new Set(); saveKnown(); resetArmed = false;
    $("resetBtn").textContent = "Reset progress"; $("resetMsg").hidden = false; renderCard(); renderList();
  };

  /* ---------- progress ---------- */
  function updateProgress() {
    const n = CARDS.filter((c) => known.has(c.id)).length;
    $("progFill").style.width = (CARDS.length ? (n / CARDS.length) * 100 : 0) + "%";
    $("progTxt").textContent = `${n} / ${CARDS.length} known`;
  }

  /* ---------- tabs ---------- */
  const tabs = document.querySelectorAll(".tabs button");
  function show(view) {
    tabs.forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    ["study", "exam", "quiz", "list"].forEach((v) => ($("view-" + v).hidden = v !== view));
    if (view !== "exam") stopExam();
    stopSpeak();
    if (view === "list") renderList();
    store.set("view", view);
    window.scrollTo(0, 0);
  }
  tabs.forEach((b) => (b.onclick = () => show(b.dataset.view)));

  /* ---------- study ---------- */
  const cats = [...new Set(CARDS.map((c) => c.cat))];
  const catSel = $("catSel");
  catSel.innerHTML = `<option value="">All topics (${CARDS.length})</option>` +
    cats.map((c) => `<option value="${c}">${c} (${CARDS.filter((x) => x.cat === c).length})</option>`).join("");
  let deck = [], pos = 0, onlyReview = false, revealed = false;

  function buildDeck(keepId) {
    const cat = catSel.value;
    deck = CARDS.filter((c) => (!cat || c.cat === cat) && (!onlyReview || !known.has(c.id)));
    pos = keepId ? Math.max(0, deck.findIndex((c) => c.id === keepId)) : 0;
    renderCard();
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function renderCard() {
    stopSpeak();
    revealed = false;
    const c = deck[pos];
    $("ansBox").hidden = true; $("revealBtn").hidden = false;
    if (!c) {
      $("cVis").textContent = "🏁"; $("cKey").textContent = "All done";
      $("cCat").textContent = ""; $("cMine").hidden = true; $("cCount").textContent = "";
      $("cQ").textContent = onlyReview ? "No cards left to review here. Great work, Estela!" : "No cards in this topic.";
      $("playQ").hidden = true; $("revealBtn").hidden = true;
      return;
    }
    $("playQ").hidden = false;
    $("cVis").textContent = c.vis || "🚘";
    $("cKey").textContent = c.key || "";
    $("cCat").textContent = c.cat;
    $("cMine").hidden = !c.mine;
    $("cCount").textContent = `${pos + 1} / ${deck.length}${known.has(c.id) ? " · ✓" : ""}`;
    $("cQ").textContent = c.q;
    renderPhrases($("cA"), c.a);
    $("cEs").textContent = c.es || "";
    $("cEs").hidden = !settings.showEs;
    store.set("pos", { id: c.id });
  }
  function reveal() {
    const c = deck[pos]; if (!c) return;
    revealed = true;
    $("ansBox").hidden = false; $("revealBtn").hidden = true;
    if (settings.autoSpeak) speak(c.a, $("playA"));
  }
  function step(d) { if (!deck.length) return; pos = (pos + d + deck.length) % deck.length; renderCard(); }

  $("revealBtn").onclick = reveal;
  $("playQ").onclick = () => deck[pos] && speak(deck[pos].q, $("playQ"));
  $("playA").onclick = () => deck[pos] && speak(deck[pos].a, $("playA"));
  $("repeatBtn").onclick = (e) => repeatAfterMe($("cA"), e.currentTarget);
  $("esBtn").onclick = () => ($("cEs").hidden = !$("cEs").hidden);
  $("nextBtn").onclick = () => step(1);
  $("prevBtn").onclick = () => step(-1);
  $("gotBtn").onclick = () => {
    const c = deck[pos]; if (!c) return;
    known.add(c.id); saveKnown();
    if (onlyReview) { deck.splice(pos, 1); if (pos >= deck.length) pos = 0; renderCard(); } else step(1);
  };
  $("againBtn").onclick = () => {
    const c = deck[pos]; if (!c) return;
    known.delete(c.id); saveKnown();
    // see it again in 3 cards
    deck.splice(pos, 1);
    deck.splice(Math.min(pos + 3, deck.length), 0, c);
    if (pos >= deck.length) pos = 0;
    renderCard();
  };
  catSel.onchange = () => buildDeck();
  $("onlyReview").onclick = (e) => { onlyReview = !onlyReview; e.currentTarget.setAttribute("aria-pressed", onlyReview); buildDeck(); };
  $("shuffleBtn").onclick = () => { shuffle(deck); pos = 0; renderCard(); };

  // swipe left/right on the card
  let sx = null;
  $("card").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("card").addEventListener("touchend", (e) => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  });

  /* ---------- examiner ---------- */
  let examOn = false, examTimer = null, examPool = [], examCard = null, wake = null;
  const wait = (ms) => new Promise((r) => { examTimer = setTimeout(r, ms); });
  async function examLoop() {
    while (examOn) {
      if (!examPool.length) {
        examPool = shuffle(CARDS.filter((c) => !$("examReview").checked || !known.has(c.id)));
        if (!examPool.length) { $("eQ").textContent = "Nothing to review. Uncheck the filter."; stopExam(); return; }
      }
      examCard = examPool.pop();
      const c = examCard;
      $("eVis").textContent = "🎙️"; $("eKey").textContent = "Listen";
      $("eCat").textContent = c.cat; $("eQ").textContent = c.q; $("eA").hidden = true;
      $("think").hidden = true; $("thinkLbl").hidden = true;
      if (!(await speak(c.q)) || !examOn || examCard !== c) return;
      // thinking time
      $("eKey").textContent = "Your turn";
      $("think").hidden = false; $("thinkLbl").hidden = false;
      const bar = $("thinkFill");
      bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      void bar.offsetWidth;
      bar.style.transition = `transform ${settings.think}s linear`; bar.style.transform = "scaleX(0)";
      await wait(settings.think * 1000);
      if (!examOn || examCard !== c) return;
      $("think").hidden = true; $("thinkLbl").hidden = true;
      $("eVis").textContent = c.vis; $("eKey").textContent = c.key;
      renderPhrases($("eA"), c.a); $("eA").hidden = false;
      if (!(await speak(c.a)) || !examOn || examCard !== c) return;
      if ($("examRepeat").checked) {
        await sleep(800);
        if (!examOn || examCard !== c) return;
        $("eKey").textContent = "Repeat after me";
        if (!(await repeatAfterMe($("eA"))) || !examOn || examCard !== c) return;
      }
      await wait(2500);
    }
  }
  function startExam() {
    examOn = true; $("examStart").textContent = "❚❚ Pause";
    if (TRACKS.length && bgm.paused) { if (!bgm.src) loadTrack(0); bgm.play().catch(() => {}); }
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => (wake = w)).catch(() => {});
    examLoop();
  }
  function stopExam() {
    examOn = false; clearTimeout(examTimer); stopSpeak(); examCard = null;
    $("examStart").textContent = "▶ Start";
    if (wake) { wake.release().catch(() => {}); wake = null; }
  }
  $("examStart").onclick = () => (examOn ? stopExam() : startExam());
  $("examNext").onclick = () => { stopExam(); startExam(); };
  $("examReview").onchange = () => { examPool = []; };

  /* ---------- quiz ---------- */
  let qOrder = [], qi = 0, score = 0, answered = false;
  function startQuiz() { qOrder = shuffle(QUIZ.map((_, i) => i)); qi = 0; score = 0; renderQuiz(); }
  function renderQuiz() {
    stopSpeak(); answered = false;
    $("qzNext").disabled = true; $("qzWhy").hidden = true;
    $("qzScore").textContent = `Score ${score}`;
    if (qi >= qOrder.length) {
      $("qzCount").textContent = "Finished";
      $("qzQ").textContent = `Estela, you got ${score} of ${qOrder.length} (${Math.round((score / qOrder.length) * 100)}%). ${score / qOrder.length >= 0.8 ? "Excellent, you are ready!" : "Press Restart and try again."}`;
      $("qzOpts").innerHTML = ""; $("qzPlay").hidden = true; return;
    }
    $("qzPlay").hidden = false;
    const item = QUIZ[qOrder[qi]];
    $("qzCount").textContent = `Question ${qi + 1} / ${qOrder.length}`;
    $("qzQ").textContent = item.q;
    const box = $("qzOpts"); box.innerHTML = "";
    item.o.forEach((txt, i) => {
      const b = document.createElement("button");
      b.textContent = txt;
      b.onclick = () => {
        if (answered) return; answered = true;
        const right = i === item.a;
        if (right) score++;
        [...box.children].forEach((el, j) => { if (j === item.a) el.classList.add("ok"); else if (j === i) el.classList.add("bad"); });
        $("qzWhy").textContent = (right ? "Correct. " : "Not quite. ") + item.why;
        $("qzWhy").hidden = false; $("qzNext").disabled = false;
        $("qzScore").textContent = `Score ${score}`;
      };
      box.appendChild(b);
    });
  }
  $("qzPlay").onclick = () => { const it = QUIZ[qOrder[qi]]; if (it) speak(natural(it.q) ? it.q : it.q + " " + it.o.join(". "), $("qzPlay")); };
  $("qzNext").onclick = () => { qi++; renderQuiz(); };
  $("qzRestart").onclick = startQuiz;

  /* ---------- list ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }
  function renderList() {
    const term = $("search").value.trim().toLowerCase();
    const out = [];
    cats.forEach((cat) => {
      const items = CARDS.filter((c) => c.cat === cat && (!term || (c.q + c.a + c.es + c.key).toLowerCase().includes(term)));
      if (!items.length) return;
      out.push(`<section class="group"><h3>${esc(cat)}</h3>` + items.map((c) => `
        <div class="item${known.has(c.id) ? " known" : ""}">
          <div class="ie" aria-hidden="true">${esc(c.vis)}</div>
          <div class="iq">${esc(c.q)}</div>
          <div class="ia">${esc(c.a)}</div>
          <div class="ik">${esc(c.key)}</div>
          <button class="play" data-say="${c.id}">▶ Listen</button>
        </div>`).join("") + "</section>");
    });
    $("list").innerHTML = out.join("") || `<p class="hint">No results for “${esc(term)}”.</p>`;
  }
  $("search").oninput = renderList;
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]"); if (!b) return;
    const c = CARDS.find((x) => x.id === b.dataset.say);
    if (c) speak(c.q, b).then((ok) => { if (ok) speak(c.a, b); });
  });

  /* ---------- boot ---------- */
  updateProgress();
  buildDeck((store.get("pos", {}) || {}).id);
  startQuiz();
  const v = store.get("view", "study");
  show(["study", "exam", "quiz", "list"].includes(v) ? v : "study");
})();
