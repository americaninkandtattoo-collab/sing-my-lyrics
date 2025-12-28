
<!-- =========================
FILE: app.js
========================= -->
/* global jspdf */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ===== Keys =====
  const KEY_TRACKS = "sml_tracks_v3";
  const KEY_TRASH  = "sml_trash_v3";

  // ===== Helpers =====
  const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
  const fmtTime = (sec)=>`${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
  const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const now = () => Date.now();

  function toast(msg, kind="ok"){
    const t = $("#toast");
    if(!t) return;
    $("#toastText").textContent = msg;
    $("#toastDot").className = "dot" + (kind==="warn" ? " warn" : kind==="bad" ? " bad" : "");
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(()=>t.classList.remove("show"), 1400);
  }

  function load(){
    let tracks=[], trash=[];
    try{ tracks = JSON.parse(localStorage.getItem(KEY_TRACKS) || "[]"); }catch{ tracks=[]; }
    try{ trash  = JSON.parse(localStorage.getItem(KEY_TRASH)  || "[]"); }catch{ trash=[]; }
    return { tracks, trash };
  }
  function save(tracks, trash){
    localStorage.setItem(KEY_TRACKS, JSON.stringify(tracks));
    localStorage.setItem(KEY_TRASH, JSON.stringify(trash));
  }

  function purgeTrash(trash){
    const cutoff = now() - 30*24*60*60*1000;
    return trash.filter(t => (t.deletedAt || 0) >= cutoff);
  }

  // ===== Fake “song generation” audio (noise/osc) =====
  function makeFakeStream(){
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dst = ctx.createMediaStreamDestination();

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 110 + Math.random()*220;

    const gain = ctx.createGain();
    gain.gain.value = 0.08;

    // add some “texture”
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6 + Math.random()*1.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    osc.connect(gain);
    gain.connect(dst);

    osc.start();
    lfo.start();

    return { stream: dst.stream, ctx };
  }

  // ===== PDF (optional) =====
  function safeName(name){
    return (name||"file").replace(/[^a-z0-9\-_ ]/gi,"").trim().slice(0,40) || "file";
  }
  function downloadLyricsPDF(title, style, lyrics){
    if(!window.jspdf && !window.jspdf?.jsPDF && !window.jspdf?.default){
      toast("jsPDF missing","bad");
      return;
    }
    const jsPDF = window.jspdf.jsPDF || window.jspdf.default?.jsPDF || window.jspdf.jsPDF;
    const doc = new jsPDF({ unit:"pt", format:"letter" });

    const margin = 48;
    let y = 64;

    doc.setFont("helvetica","bold");
    doc.setFontSize(16);
    doc.text(title || "Sing My Lyrics", margin, y);
    y += 18;

    doc.setFont("helvetica","normal");
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(`Style: ${style || "—"}`, margin, y);
    y += 18;

    doc.setTextColor(30);
    doc.setFontSize(12);

    const body = (lyrics || "").trim() || "(No lyrics provided)";
    const lines = doc.splitTextToSize(body, 520);

    lines.forEach(line => {
      if(y > 740){
        doc.addPage();
        y = 64;
      }
      doc.text(line, margin, y);
      y += 16;
    });

    doc.save(`${safeName(title)}-lyrics.pdf`);
    toast("Lyrics PDF downloaded","ok");
  }

  function downloadSheetPDF(title){
    const jsPDF = window.jspdf.jsPDF || window.jspdf.default?.jsPDF || window.jspdf.jsPDF;
    const doc = new jsPDF({ unit:"pt", format:"letter" });

    doc.setFont("helvetica","bold");
    doc.setFontSize(16);
    doc.text("Sheet Music PDF (placeholder)", 48, 64);

    doc.setFont("helvetica","normal");
    doc.setFontSize(12);
    doc.text(`Title: ${title || "Untitled"}`, 48, 92);

    let y = 140;
    for(let staff=0; staff<6; staff++){
      for(let i=0; i<5; i++){
        doc.setDrawColor(40);
        doc.line(48, y + i*10, 560, y + i*10);
      }
      y += 80;
    }

    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("Placeholder staff. Real notation will be wired later.", 48, 740);

    doc.save(`${safeName(title)}-sheet.pdf`);
    toast("Sheet PDF downloaded","ok");
  }

  // ===== Shared state =====
  let { tracks, trash } = load();
  trash = purgeTrash(trash);
  save(tracks, trash);

  let nowId = null;
  let isPlaying = false;
  let sec = 0;
  let timer = null;
  let audioCtx = null;
  let audioStreamObj = null;

  // ===== Sidebar collapse =====
  function syncSidebarArrow(){
    const collapsed = document.body.classList.contains("collapsed");
    const btn = $("#toggleSidebar");
    if(!btn) return;
    btn.textContent = collapsed ? "▶" : "◀";
    btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  function bindGlobalUI(){
    // collapse
    const tbtn = $("#toggleSidebar");
    if(tbtn){
      tbtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        document.body.classList.toggle("collapsed");
        syncSidebarArrow();
      });
      syncSidebarArrow();
    }

    // profile click
    const p = $("#btnProfile");
    if(p){
      p.addEventListener("click",()=> toast("Profile (Soon)","warn"));
    }

    // trash count
    const tc = $("#trashCount");
    if(tc) tc.textContent = String(trash.length);

    // close menus
    document.addEventListener("click",()=>{
      $$(".more-menu.open").forEach(m=>{
        m.classList.remove("open");
        m.style.top = "";
        m.style.left = "";
      });
    });
  }

  // ===== Player =====
  function setPlaying(on){
    isPlaying = !!on;
    const btn = $("#btnPlay");
    if(btn) btn.textContent = isPlaying ? "❚❚" : "▶";

    if(isPlaying){
      if(!nowId){
        if(tracks[0]?.id){
          selectTrack(tracks[0].id, true);
          return;
        }
        toast("No track","warn");
        isPlaying = false;
        if(btn) btn.textContent = "▶";
        return;
      }
      if(!audioStreamObj){
        audioStreamObj = makeFakeStream();
        audioCtx = audioStreamObj.ctx;
        const audio = $("#audio");
        if(audio){
          audio.srcObject = audioStreamObj.stream;
          audio.play?.().catch(()=>{});
        }
      }
      if(!timer){
        timer = setInterval(()=>{
          if(!isPlaying) return;
          sec += 1;
          updateProgress();
        }, 1000);
      }
    }
  }

  function updateProgress(){
    const dur = 180;
    const pct = clamp((sec/dur)*100, 0, 100);
    const fill = $("#fill");
    if(fill) fill.style.width = pct + "%";
    const time = $("#time");
    if(time) time.textContent = fmtTime(sec);
  }

  function seekFromBar(barEl, clientX){
    const r = barEl.getBoundingClientRect();
    const pct = clamp((clientX - r.left)/r.width, 0, 1);
    sec = Math.floor(pct * 180);
    updateProgress();
  }

  function nextTrack(dir){
    if(!tracks.length){ toast("No tracks","warn"); return; }
    const idx = tracks.findIndex(x=>x.id===nowId);
    const next = (idx===-1) ? 0 : (idx + dir + tracks.length) % tracks.length;
    selectTrack(tracks[next].id, true);
  }

  // ===== Track selection =====
  function selectTrack(id, autoPlay){
    nowId = id;
    sec = 0;
    updateProgress();
    renderList();
    renderRight();
    renderPlayerNow();
    if(autoPlay) setPlaying(true);
    else setPlaying(false);
  }

  function renderPlayerNow(){
    const t = tracks.find(x=>x.id===nowId);
    const pt = $("#playerTitle");
    const ps = $("#playerSub");
    if(pt) pt.textContent = t ? t.title : "No track selected";
    if(ps) ps.textContent = t ? (t.style || "—") : "—";
  }

  // ===== Create logic (Create page) =====
  const STYLE_POOL = [
    "industrial rock, punchy drums, gritty bass",
    "cinematic, massive chorus, dramatic build",
    "ska-punk, bright horns, fast upbeat",
    "electro-industrial, mechanical pulse, dark synth",
    "alt rock, stadium anthem, hooky chorus",
    "reggae-rock, laid back groove, warm guitar",
    "metal, tight palm-mutes, big breakdown",
    "synthwave, neon leads, nostalgic",
    "trap-rock, heavy 808, distorted guitars",
    "dark pop, glossy synths, emotional vocal"
  ];

  const PRESETS = [
    "industrial rock","electro-industrial","ska-punk","alt rock","metal","synthwave",
    "cinematic","reggae-rock","trap-rock","ambient cinematic"
  ];

  const INSPO = [
    "punchy drums","gritty bass","anthem hook","dark synth","choir lift",
    "industrial hits","cinematic drops","tight guitars","neon leads","bridge breakdown",
    "spoken vocal","older/gritty vocal","big chorus","whisper verse","fast upbeat"
  ];

  function mountSlot(slotId, items){
    const slot = $(slotId);
    if(!slot) return;
    slot.innerHTML = "";
    items.forEach(txt=>{
      const c = document.createElement("div");
      c.className = "chip";
      c.textContent = txt;
      slot.appendChild(c);
    });
  }

  function bindSlot(slotId, mode){
    const slot = $(slotId);
    if(!slot) return;
    slot.addEventListener("click",(e)=>{
      const c = e.target.closest(".chip");
      if(!c) return;

      // preset: toggle adds tag (but keeps STYLE single-line readable via style textarea)
      if(mode==="preset"){
        c.classList.toggle("on");
        applyStyleFromSelections();
        return;
      }

      // inspo: single selection
      if(mode==="inspo"){
        $$(slotId+" .chip.on").forEach(x=>{ if(x!==c) x.classList.remove("on"); });
        c.classList.toggle("on");
        applyStyleFromSelections();
        return;
      }
    });
  }

  function applyStyleFromSelections(){
    const styleEl = $("#styleText");
    if(!styleEl) return;

    const presetOn = [...$$("#presetSlot .chip.on")].map(x=>x.textContent.trim());
    const inspoOn = [...$$("#inspoSlot .chip.on")].map(x=>x.textContent.trim());

    // build ONE style string (clean, readable)
    let s = "";
    if(presetOn.length) s += presetOn.join(", ");
    if(inspoOn.length) s += (s ? " • " : "") + inspoOn[0];

    // If user typed their own style, keep it as the base and append selection once
    const userBase = styleEl.value.trim();
    const base = userBase.split(" • ")[0].trim(); // keep what they typed before chips “•”
    const final = s ? (base ? (base + " • " + (inspoOn[0] || "")).trim() : s) : base;

    styleEl.value = final.trim();
  }

  function diceOneStyle(){
    const styleEl = $("#styleText");
    if(!styleEl) return;
    const pick = STYLE_POOL[Math.floor(Math.random()*STYLE_POOL.length)];
    styleEl.value = pick; // ONE ONLY
    toast("Dice 🎲","ok");
  }

  function createSong(){
    const titleEl = $("#songTitle");
    const lyricsEl = $("#lyrics");
    const styleEl = $("#styleText");

    if(!lyricsEl) return;
    const lyrics = (lyricsEl.value || "").trim();
    if(!lyrics){
      toast("Lyrics required","bad");
      return;
    }

    const title = (titleEl?.value || "").trim() || "Untitled";
    const style = (styleEl?.value || "").trim();

    const styleInf = Number($("#styleInfluence")?.value || 50);
    const audioInf = Number($("#audioInfluence")?.value || 50);

    const t = {
      id: uuid(),
      title,
      lyrics,
      style,
      visibility: "private",
      createdAt: now(),
      plays: 0,
      likes: 0,
      dislikes: 0,
      styleInfluence: styleInf,
      audioInfluence: audioInf,
      // simple “generated image seed” for consistent cover-ish variation
      artSeed: Math.floor(Math.random()*1e9)
    };

    tracks.unshift(t);
    save(tracks, trash);
    toast("Created","ok");

    // clear inputs (NO draft saving)
    if(titleEl) titleEl.value = "";
    lyricsEl.value = "";
    if(styleEl) styleEl.value = "";

    // clear chips
    $$("#presetSlot .chip.on").forEach(x=>x.classList.remove("on"));
    $$("#inspoSlot .chip.on").forEach(x=>x.classList.remove("on"));

    // go to library/workspace view depends on page:
    renderList();
    selectTrack(t.id, true);
  }

  // ===== List rendering (Library + Create right-side list panel) =====
  function renderList(){
    const box = $("#tracks");
    if(!box) return;

    box.innerHTML = "";
    tracks.forEach(t=>{
      const row = document.createElement("div");
      row.className = "track" + (t.id===nowId ? " active" : "");
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = t.title || "Untitled";

      const moreWrap = document.createElement("div");
      moreWrap.className = "more-wrap";

      const btnMore = document.createElement("button");
      btnMore.className = "iconbtn";
      btnMore.textContent = "⋯";
      btnMore.title = "More";

      const mm = document.createElement("div");
      mm.className = "more-menu";

      const mk = (label, fn, cls="")=>{
        const b = document.createElement("button");
        b.textContent = label;
        if(cls) b.className = cls;
        b.addEventListener("click",(e)=>{ e.stopPropagation(); mm.classList.remove("open"); fn(); });
        return b;
      };

      mm.appendChild(mk("Remaster (Soon)", ()=>toast("Remaster (Soon)","warn")));
      mm.appendChild(mk("Restart (Soon)", ()=>toast("Restart (Soon)","warn")));
      mm.appendChild(document.createElement("hr"));

      mm.appendChild(mk("Download Lyrics PDF", ()=>downloadLyricsPDF(t.title, t.style, t.lyrics)));
      mm.appendChild(mk("Download Sheet Music PDF", ()=>downloadSheetPDF(t.title)));
      mm.appendChild(document.createElement("hr"));

      mm.appendChild(mk("Report Bad Quality (Soon)", ()=>toast("Report (Soon)","warn")));
      mm.appendChild(document.createElement("hr"));

      mm.appendChild(mk(t.visibility==="public" ? "Make Private" : "Make Public", ()=>{
        t.visibility = (t.visibility==="public" ? "private" : "public");
        save(tracks, trash);
        renderRight();
        toast("Visibility updated","ok");
      }));

      mm.appendChild(mk("Delete (30 days)", ()=>softDelete(t.id), "danger"));

      btnMore.addEventListener("click",(e)=>{
        e.stopPropagation();
        $$(".more-menu.open").forEach(x=>{ if(x!==mm) x.classList.remove("open"); });

        const willOpen = !mm.classList.contains("open");
        if(!willOpen){
          mm.classList.remove("open");
          return;
        }

        const r = btnMore.getBoundingClientRect();
        const top = Math.min(r.bottom + 8, window.innerHeight - 260);
        const left = Math.min(r.right - 240, window.innerWidth - 250);

        mm.style.top = `${Math.max(8, top)}px`;
        mm.style.left = `${Math.max(8, left)}px`;
        mm.classList.add("open");
      });

      moreWrap.appendChild(btnMore);
      moreWrap.appendChild(mm);

      row.appendChild(title);
      row.appendChild(moreWrap);

      row.addEventListener("click", ()=>{
        selectTrack(t.id, false);
      });

      box.appendChild(row);
    });

    // sidebar trash count
    const tc = $("#trashCount");
    if(tc) tc.textContent = String(trash.length);
  }

  // ===== Right panel rendering =====
  function artGradient(seed){
    // deterministic-ish from seed
    const a = (seed % 360);
    const b = (seed * 7) % 360;
    return `linear-gradient(135deg, hsl(${a} 90% 60%), hsl(${b} 90% 55%))`;
  }

  function renderRight(){
    const card = $("#rightCard");
    if(!card) return;

    const t = tracks.find(x=>x.id===nowId);
    if(!t){
      card.innerHTML = `
        <div class="rightCard">
          <div class="coverArt"></div>
          <div class="bigTitle">No track selected</div>
          <div class="subline">Pick a song from your workspace.</div>
          <div class="statRow">
            <div class="statPill">▶ Plays: <b>—</b></div>
            <div class="statPill">👍 Likes: <b>—</b></div>
            <div class="statPill">👎 Dislikes: <b>—</b></div>
          </div>
        </div>
      `;
      return;
    }

    const created = new Date(t.createdAt).toLocaleString();

    card.innerHTML = `
      <div class="rightCard">
        <div class="coverArt" id="coverArt"></div>

        <div class="bigTitle">${escapeHtml(t.title || "Untitled")}</div>
        <div class="subline">${escapeHtml(t.style || "—")}</div>

        <div class="metaGrid">
          <div class="mcell"><b>Visibility</b>${t.visibility === "public" ? "Public" : "Private"}</div>
          <div class="mcell"><b>Created</b>${escapeHtml(created)}</div>
          <div class="mcell"><b>Style Influence</b>${Number(t.styleInfluence || 50)}%</div>
          <div class="mcell"><b>Audio Influence</b>${Number(t.audioInfluence || 50)}%</div>
        </div>

        <div class="statRow">
          <div class="statPill">▶ Plays: <b>${t.plays||0}</b></div>
          <div class="statPill">👍 Likes: <b>${t.likes||0}</b></div>
          <div class="statPill">👎 Dislikes: <b>${t.dislikes||0}</b></div>
        </div>

        <div class="field-label" style="margin-top:14px">Lyrics (preview)</div>
        <div style="white-space:pre-wrap;background:#0b1220;border:1px solid var(--stroke);border-radius:14px;padding:10px;font-size:12px;color:#cfe1ff;max-height:160px;overflow:auto">
          ${escapeHtml((t.lyrics||"(no lyrics)").slice(0,1200))}
        </div>

        <div class="stack" style="margin-top:12px">
          <button class="btn-wide export" id="btnLikeRight" type="button">👍 Like</button>
          <button class="btn-wide export" id="btnDisRight" type="button">👎 Dislike</button>
        </div>
      </div>
    `;

    const art = $("#coverArt");
    if(art){
      art.style.background = `radial-gradient(circle at 25% 25%, #ffffff2a, #0000 50%), ${artGradient(t.artSeed||0)}`;
    }

    const bl = $("#btnLikeRight");
    const bd = $("#btnDisRight");
    if(bl) bl.addEventListener("click",()=>{
      t.likes = (t.likes||0) + 1;
      save(tracks, trash);
      renderRight();
      toast("Liked","ok");
    });
    if(bd) bd.addEventListener("click",()=>{
      t.dislikes = (t.dislikes||0) + 1;
      save(tracks, trash);
      renderRight();
      toast("Disliked","ok");
    });
  }

  function escapeHtml(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ===== Soft delete / Restore =====
  function softDelete(id){
    const t = tracks.find(x=>x.id===id);
    if(!t) return;
    tracks = tracks.filter(x=>x.id!==id);
    trash.unshift({ ...t, deletedAt: now() });
    trash = purgeTrash(trash);

    if(nowId === id){
      nowId = null;
      setPlaying(false);
      renderRight();
      renderPlayerNow();
    }

    save(tracks, trash);
    renderList();
    renderTrash();
    toast("Moved to Trash (30 days)","warn");
  }

  function restoreFromTrash(id){
    const t = trash.find(x=>x.id===id);
    if(!t) return;
    trash = trash.filter(x=>x.id!==id);
    delete t.deletedAt;
    tracks.unshift(t);
    save(tracks, trash);
    renderTrash();
    renderList();
    toast("Restored","ok");
  }

  // ===== Trash page UI =====
  function remainingDays(deletedAt){
    const end = deletedAt + 30*24*60*60*1000;
    const ms = end - now();
    return Math.max(0, Math.ceil(ms / (24*60*60*1000)));
  }

  function renderTrash(){
    const list = $("#trashList");
    if(!list) return;

    trash = purgeTrash(trash);
    save(tracks, trash);

    list.innerHTML = "";
    if(!trash.length){
      list.innerHTML = `<div class="muted">Trash is empty.</div>`;
    } else {
      trash.forEach(t=>{
        const row = document.createElement("div");
        row.className = "track";
        row.style.cursor = "default";

        const ttl = document.createElement("div");
        ttl.className = "title";
        ttl.textContent = t.title || "Untitled";

        const days = document.createElement("div");
        days.className = "badge";
        days.style.background = "#ffffff18";
        days.style.color = "#cfe1ff";
        days.style.border = "1px solid #ffffff22";
        days.textContent = `${remainingDays(t.deletedAt)}d`;

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "iconbtn";
        restoreBtn.textContent = "↩";
        restoreBtn.title = "Restore";
        restoreBtn.addEventListener("click",()=>restoreFromTrash(t.id));

        row.appendChild(ttl);
        row.appendChild(days);
        row.appendChild(restoreBtn);

        list.appendChild(row);
      });
    }

    const tc = $("#trashCount");
    if(tc) tc.textContent = String(trash.length);
  }

  // ===== Page-specific bindings =====
  function bindCreatePage(){
    if(!$("#createPage")) return;

    // mount slots
    mountSlot("#presetSlot", PRESETS);
    mountSlot("#inspoSlot", INSPO);
    bindSlot("#presetSlot","preset");
    bindSlot("#inspoSlot","inspo");

    // arrows + dice near slot machine (NO huge dice buttons)
    $("#presetLeft")?.addEventListener("click",()=>$("#presetSlot")?.scrollBy({left:-220,behavior:"smooth"}));
    $("#presetRight")?.addEventListener("click",()=>$("#presetSlot")?.scrollBy({left:220,behavior:"smooth"}));
    $("#inspoLeft")?.addEventListener("click",()=>$("#inspoSlot")?.scrollBy({left:-220,behavior:"smooth"}));
    $("#inspoRight")?.addEventListener("click",()=>$("#inspoSlot")?.scrollBy({left:220,behavior:"smooth"}));

    $("#diceStyle")?.addEventListener("click", diceOneStyle);
    $("#diceInspo")?.addEventListener("click", ()=>{
      // pick ONE inspo chip and ONLY that one
      const pick = INSPO[Math.floor(Math.random()*INSPO.length)];
      const chips = [...$$("#inspoSlot .chip")];
      chips.forEach(c=>c.classList.toggle("on", c.textContent.trim()===pick));
      applyStyleFromSelections();
      toast("Inspiration 🎲","ok");
    });

    // sliders
    const si = $("#styleInfluence");
    const ai = $("#audioInfluence");
    if(si){
      const out = $("#styleInfluenceVal");
      const sync = ()=>{ if(out) out.textContent = `${si.value}%`; };
      si.addEventListener("input", sync); sync();
    }
    if(ai){
      const out = $("#audioInfluenceVal");
      const sync = ()=>{ if(out) out.textContent = `${ai.value}%`; };
      ai.addEventListener("input", sync); sync();
    }

    // create
    $("#btnCreate")?.addEventListener("click", createSong);

    // quick select first track
    renderList();
    renderRight();
    renderPlayerNow();
  }

  function bindLibraryPage(){
    if(!$("#libraryPage")) return;
    renderList();
    renderRight();
    renderPlayerNow();
  }

  function bindHomePage(){
    if(!$("#homePage")) return;
    $("#goCreate")?.addEventListener("click",()=>{ window.location.href="create.html"; });
    $("#goLibrary")?.addEventListener("click",()=>{ window.location.href="library.html"; });
    $("#goTrash")?.addEventListener("click",()=>{ window.location.href="trash.html"; });
  }

  function bindTrashPage(){
    if(!$("#trashPage")) return;
    renderTrash();
  }

  function bindPlayer(){
    const bar = $("#progress");
    if(bar) bar.addEventListener("click",(e)=> seekFromBar(e.currentTarget, e.clientX));

    $("#btnPrev")?.addEventListener("click",()=> nextTrack(-1));
    $("#btnNext")?.addEventListener("click",()=> nextTrack(1));
    $("#btnPlay")?.addEventListener("click",()=>{
      if(nowId){
        // count plays when you hit play from paused -> playing
        if(!isPlaying){
          const t = tracks.find(x=>x.id===nowId);
          if(t){
            t.plays = (t.plays||0) + 1;
            save(tracks, trash);
            renderRight();
          }
        }
      }
      setPlaying(!isPlaying);
    });

    // keep audio element (hidden) alive if present
    const audio = $("#audio");
    if(audio) audio.volume = 0.8;
  }

  // ===== Seed (only if empty) =====
  function seedIfEmpty(){
    if(tracks.length) return;
    tracks = [
      {
        id: uuid(),
        title:"Where you look",
        lyrics:"Where you look\nI follow\nIn the dark\nWe glow",
        style:"industrial rock, cinematic, punchy drums",
        visibility:"private",
        createdAt: now() - 1000*60*20,
        plays: 12,
        likes: 5,
        dislikes: 1,
        styleInfluence: 60,
        audioInfluence: 40,
        artSeed: 123456789
      }
    ];
    save(tracks, trash);
  }

  // ===== Start =====
  seedIfEmpty();
  bindGlobalUI();
  bindPlayer();
  bindCreatePage();
  bindLibraryPage();
  bindHomePage();
  bindTrashPage();

  // default select first song (no autoplay)
  if(tracks[0]?.id){
    nowId = tracks[0].id;
    renderList();
    renderRight();
    renderPlayerNow();
    setPlaying(false);
  }
})();
