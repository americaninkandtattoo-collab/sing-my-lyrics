// intentionally minimal
/* =========================
FILE: app.js
SML LIGHT — SINGLE JS FOR ALL PAGES
========================= */

const SML = (() => {
  const KEY = {
    profile: "sml_profile_v1",
    library: "sml_library_v1",
    trash: "sml_trash_v1",
    ui: "sml_ui_v1"
  };

  // ---------- helpers ----------
  const nowISO = () => new Date().toISOString();
  const fmtDate = (iso) => {
    try{
      const d = new Date(iso);
      return d.toLocaleString();
    }catch{ return iso; }
  };
  const safeText = (s) => (typeof s === "string" ? s.trim() : "");
  const uid = () => Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);

  const readJSON = (k, fallback) => {
    try{
      const raw = localStorage.getItem(k);
      if(!raw) return fallback;
      return JSON.parse(raw);
    }catch{ return fallback; }
  };
  const writeJSON = (k, v) => {
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch{}
  };

  const getProfile = () => {
    const p = readJSON(KEY.profile, null);
    if(p && p.name) return p;
    const seed = { name: "YOU", credits: 7537 };
    writeJSON(KEY.profile, seed);
    return seed;
  };

  const setProfileName = (name) => {
    const p = getProfile();
    p.name = safeText(name) || "YOU";
    writeJSON(KEY.profile, p);
  };

  const getLibrary = () => readJSON(KEY.library, []);
  const setLibrary = (arr) => writeJSON(KEY.library, Array.isArray(arr) ? arr : []);

  const getTrash = () => readJSON(KEY.trash, []);
  const setTrash = (arr) => writeJSON(KEY.trash, Array.isArray(arr) ? arr : []);

  const purgeOldTrash = () => {
    // simulated 30 days retention
    const MS_30D = 30 * 24 * 60 * 60 * 1000;
    const t = getTrash();
    const now = Date.now();
    const keep = t.filter(x => {
      const del = new Date(x.deletedAt || x.createdAt || nowISO()).getTime();
      return (now - del) <= MS_30D;
    });
    if(keep.length !== t.length) setTrash(keep);
  };

  const getStats = () => {
    purgeOldTrash();
    return {
      libraryCount: getLibrary().length,
      trashCount: getTrash().length
    };
  };

  // ---------- UI base ----------
  const initBaseUI = () => {
    // sidebar name
    const p = getProfile();
    const nameEl = document.getElementById("profileNameSidebar");
    if(nameEl) nameEl.textContent = p.name || "YOU";

    // credits sidebar
    const cEl = document.getElementById("creditsSidebar");
    if(cEl) cEl.textContent = Number(p.credits || 7537).toLocaleString();

    // sidebar toggle
    const btn = document.getElementById("toggleSidebar");
    const sidebar = document.querySelector(".sidebar");
    if(btn && sidebar){
      btn.addEventListener("click", () => {
        // mobile: hide/unhide
        if(window.matchMedia("(max-width: 980px)").matches){
          sidebar.classList.toggle("hidden");
          return;
        }
        // desktop: collapse
        sidebar.classList.toggle("collapsed");
        writeJSON(KEY.ui, { collapsed: sidebar.classList.contains("collapsed") });
      });

      // restore collapse state
      const ui = readJSON(KEY.ui, {});
      if(ui && ui.collapsed && !window.matchMedia("(max-width: 980px)").matches){
        sidebar.classList.add("collapsed");
      }
    }

    // on mobile start hidden? no. keep visible.
  };

  // ---------- download helpers ----------
  const downloadTextFile = (filename, text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  // ---------- Tone preview engine ----------
  // Simple WebAudio oscillator preview, duration ~12s, “influenced” by sliders
  let audioCtx = null;
  let osc = null;
  let gain = null;
  let playing = false;
  let startAt = 0;
  let durSec = 12;
  let tickTimer = null;

  const stopTone = () => {
    try{
      if(tickTimer){ clearInterval(tickTimer); tickTimer = null; }
      if(osc){ osc.stop(); osc.disconnect(); osc = null; }
      if(gain){ gain.disconnect(); gain = null; }
      playing = false;
    }catch{}
  };

  const playTone = (opts, onTick) => {
    stopTone();
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    gain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(audioCtx.destination);

    osc = audioCtx.createOscillator();
    const base = 120 + (opts.audioInfluence || 60) * 4; // 120..520
    const wobble = 0.08 + (opts.artSeed || 40) / 600;   // 0.08..0.24
    osc.type = (opts.audioInfluence || 60) > 60 ? "sawtooth" : "square";
    osc.frequency.value = base;
    osc.connect(gain);

    // ramp in
    const t0 = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.25);

    // subtle frequency drift
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 4;
    lfoGain.gain.value = base * wobble;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    osc.start();
    playing = true;
    startAt = performance.now();

    // stop automatically
    setTimeout(() => {
      try{
        const t1 = audioCtx.currentTime;
        gain.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.12);
        setTimeout(() => {
          try{ lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); }catch{}
          stopTone();
        }, 180);
      }catch{ stopTone(); }
    }, durSec * 1000);

    // tick UI
    tickTimer = setInterval(() => {
      const elapsed = (performance.now() - startAt) / 1000;
      const pct = Math.max(0, Math.min(1, elapsed / durSec));
      if(typeof onTick === "function") onTick(elapsed, pct);
      if(elapsed >= durSec) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }, 120);
  };

  // ---------- Create Page ----------
  const createPageInit = () => {
    purgeOldTrash();

    const elTitle = document.getElementById("songTitle");
    const elLyrics = document.getElementById("lyrics");
    const elStyle = document.getElementById("style");

    const elAI = document.getElementById("audioInfluence");
    const elAIVal = document.getElementById("audioInfluenceVal");
    const elAS = document.getElementById("artSeed");
    const elASVal = document.getElementById("artSeedVal");

    const btnGen = document.getElementById("btnGenerate");
    const btnSave = document.getElementById("btnSave");
    const btnClear = document.getElementById("btnClear");

    const pTitle = document.getElementById("previewTitle");
    const pMeta = document.getElementById("previewMeta");
    const btnPlay = document.getElementById("btnPlay");
    const btnStop = document.getElementById("btnStop");
    const bar = document.getElementById("timelineBar");
    const timeText = document.getElementById("timeText");

    const btnExportLyrics = document.getElementById("btnExportLyrics");
    const btnGoLibrary = document.getElementById("btnGoLibrary");

    const setRangeLabels = () => {
      if(elAIVal) elAIVal.textContent = ${Number(elAI.value)}%;
      if(elASVal) elASVal.textContent = ${Number(elAS.value)}%;
    };
    if(elAI) elAI.addEventListener("input", setRangeLabels);
    if(elAS) elAS.addEventListener("input", setRangeLabels);
    setRangeLabels();

    let generated = null;

    const resetPreviewUI = () => {
      generated = null;
      if(pTitle) pTitle.textContent = "No preview yet";
      if(pMeta) pMeta.textContent = "Fill in lyrics + style, then Generate.";
      if(btnSave) btnSave.disabled = true;
      if(btnPlay) btnPlay.disabled = true;
      if(btnStop) btnStop.disabled = true;
      if(btnExportLyrics) btnExportLyrics.disabled = true;
      if(bar) bar.style.width = "0%";
      if(timeText) timeText.textContent = "0:00";
      stopTone();
    };

    const validate = () => {
      const lyrics = safeText(elLyrics.value);
      const style = safeText(elStyle.value);
      return lyrics.length > 0 && style.length > 0;
    };

    if(btnGoLibrary){
      btnGoLibrary.addEventListener("click", () => location.href = "./library.html");
    }

    if(btnClear){
      btnClear.addEventListener("click", () => {
        if(elTitle) elTitle.value = "";
        if(elLyrics) elLyrics.value = "";
        if(elStyle) elStyle.value = "";
        resetPreviewUI();
      });
    }

    if(btnGen){
      btnGen.addEventListener("click", () => {
        if(!validate()){
          alert("Lyrics and Style are required.");
          return;
        }

        const t = safeText(elTitle.value) || "Untitled";
        const lyrics = safeText(elLyrics.value);
        const style = safeText(elStyle.value);
        const audioInfluence = Number(elAI.value || 60);
        const artSeed = Number(elAS.value || 40);

        generated = {
          id: uid(),
          title: t,
          lyrics,
          style,
          audioInfluence,
          artSeed,
          createdAt: nowISO(),
          preview: {
            type: "tone",
            durationSec: durSec
          }
        };

        if(pTitle) pTitle.textContent = t;
        if(pMeta) pMeta.textContent = Style: ${style} • Influence: ${audioInfluence}% • Seed: ${artSeed}%;

        if(btnSave) btnSave.disabled = false;
        if(btnPlay) btnPlay.disabled = false;
        if(btnStop) btnStop.disabled = false;
        if(btnExportLyrics) btnExportLyrics.disabled = false;

        if(bar) bar.style.width = "0%";
        if(timeText) timeText.textContent = "0:00";
      });
    }

    if(btnPlay){
      btnPlay.addEventListener("click", async () => {
        if(!generated) return;
        // Play tone “preview”
        playTone(
          { audioInfluence: generated.audioInfluence, artSeed: generated.artSeed },
          (elapsed, pct) => {
            if(bar) bar.style.width = ${Math.floor(pct * 100)}%;
            if(timeText){
              const s = Math.floor(elapsed);
              const mm = Math.floor(s / 60);
              const ss = String(s % 60).padStart(2, "0");
              timeText.textContent = ${mm}:${ss};
            }
          }
        );
      });
    }

    if(btnStop){
      btnStop.addEventListener("click", () => {
        stopTone();
        if(bar) bar.style.width = "0%";
        if(timeText) timeText.textContent = "0:00";
      });
    }

    if(btnExportLyrics){
      btnExportLyrics.addEventListener("click", () => {
        if(!generated) return;
        const file = ${(generated.title || "lyrics").replace(/[^\w\-]+/g,"_")}_lyrics.txt;
        const txt =
`SML Light — Export Lyrics

Title: ${generated.title}
Style: ${generated.style}
Ownership: 100% You
No AI Lyrics: true
Created: ${fmtDate(generated.createdAt)}

--- LYRICS ---
${generated.lyrics}
`;
        downloadTextFile(file, txt);
      });
    }

    if(btnSave){
      btnSave.addEventListener("click", () => {
        if(!generated) return;
        const lib = getLibrary();
        lib.unshift(generated);
        setLibrary(lib);
        alert("Saved to Library.");
        // keep the generated object but allow another save with new id
        // (no auto-clear)
      });
    }

    resetPreviewUI();
  };

  // ---------- Library Page ----------
  const libraryPageInit = () => {
    purgeOldTrash();

    const search = document.getElementById("search");
    const list = document.getElementById("trackList");
    const emptyNote = document.getElementById("emptyNote");
    const btnRefresh = document.getElementById("btnRefresh");

    const detailsEmpty = document.getElementById("detailsEmpty");
    const details = document.getElementById("details");
    const dTitle = document.getElementById("dTitle");
    const dStyle = document.getElementById("dStyle");
    const dDate = document.getElementById("dDate");
    const dLyrics = document.getElementById("dLyrics");

    const btnPlay = document.getElementById("btnPlay");
    const btnStop = document.getElementById("btnStop");
    const btnExport = document.getElementById("btnExport");
    const btnTrash = document.getElementById("btnTrash");

    let selectedId = null;

    const getFiltered = () => {
      const q = safeText(search.value).toLowerCase();
      const lib = getLibrary();
      if(!q) return lib;
      return lib.filter(t =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.style || "").toLowerCase().includes(q)
      );
    };

    const setDetailsVisible = (isOn) => {
      if(detailsEmpty) detailsEmpty.style.display = isOn ? "none" : "block";
      if(details) details.style.display = isOn ? "block" : "none";
    };

    const renderList = () => {
      stopTone();
      setDetailsVisible(false);
      selectedId = null;

      const data = getFiltered();
      if(!list) return;

      list.innerHTML = "";
      if(emptyNote) emptyNote.style.display = data.length ? "none" : "block";

      data.forEach(t => {
        const item = document.createElement("div");
        item.className = "item";
        item.dataset.id = t.id;

        const title = document.createElement("div");
        title.className = "item-title";
        title.textContent = t.title || "Untitled";

        const sub = document.createElement("div");
        sub.className = "item-sub";
        const left = document.createElement("span");
        left.textContent = (t.style || "").slice(0, 50) || "No style";
        const right = document.createElement("span");
        right.textContent = new Date(t.createdAt || nowISO()).toLocaleDateString();

        sub.appendChild(left);
        sub.appendChild(right);

        item.appendChild(title);
        item.appendChild(sub);

        item.addEventListener("click", () => {
          // highlight
          [...list.querySelectorAll(".item")].forEach(x => x.classList.remove("active"));
          item.classList.add("active");
          selectedId = t.id;

          // details
          setDetailsVisible(true);
          if(dTitle) dTitle.textContent = t.title || "Untitled";
          if(dStyle) dStyle.textContent = t.style || "-";
          if(dDate) dDate.textContent = fmtDate(t.createdAt || nowISO());
          if(dLyrics) dLyrics.value = t.lyrics || "";

          // buttons
          if(btnPlay) btnPlay.disabled = false;
          if(btnStop) btnStop.disabled = false;
          if(btnExport) btnExport.disabled = false;
          if(btnTrash) btnTrash.disabled = false;

          // store current track for playback
          btnPlay._track = t;
          btnExport._track = t;
        });

        list.appendChild(item);
      });

      // disable buttons until select
      if(btnPlay) btnPlay.disabled = true;
      if(btnStop) btnStop.disabled = true;
      if(btnExport) btnExport.disabled = true;
      if(btnTrash) btnTrash.disabled = true;
    };

    if(btnRefresh) btnRefresh.addEventListener("click", renderList);
    if(search) search.addEventListener("input", renderList);

    if(btnPlay){
      btnPlay.addEventListener("click", () => {
        const t = btnPlay._track;
        if(!t) return;
        playTone({ audioInfluence: t.audioInfluence || 60, artSeed: t.artSeed || 40 });
      });
    }
    if(btnStop){
      btnStop.addEventListener("click", () => stopTone());
    }
    if(btnExport){
      btnExport.addEventListener("click", () => {
        const t = btnExport._track;
        if(!t) return;
        const file = ${(t.title || "lyrics").replace(/[^\w\-]+/g,"_")}_lyrics.txt;
        const txt =
`SML Light — Export Lyrics

Title: ${t.title}
Style: ${t.style}
Ownership: 100% You
No AI Lyrics: true
Created: ${fmtDate(t.createdAt)}

--- LYRICS ---
${t.lyrics || ""}
`;
        downloadTextFile(file, txt);
      });
    }
    if(btnTrash){
      btnTrash.addEventListener("click", () => {
        if(!selectedId) return;
        const lib = getLibrary();
        const idx = lib.findIndex(x => x.id === selectedId);
        if(idx === -1) return;

        const [removed] = lib.splice(idx, 1);
        removed.deletedAt = nowISO();

        const tr = getTrash();
        tr.unshift(removed);

        setLibrary(lib);
        setTrash(tr);

        alert("Moved to Trash.");
        renderList();
      });
    }

    renderList();
  };

  // ---------- Trash Page ----------
  const trashPageInit = () => {
    purgeOldTrash();

    const list = document.getElementById("trashList");
    const emptyNote = document.getElementById("trashEmptyNote");
    const btnEmptyAll = document.getElementById("btnEmptyAll");

    const tEmpty = document.getElementById("tEmpty");
    const tDetails = document.getElementById("tDetails");
    const tTitle = document.getElementById("tTitle");
    const tDeleted = document.getElementById("tDeleted");
    const btnRestore = document.getElementById("btnRestore");
    const btnDeleteForever = document.getElementById("btnDeleteForever");

    let selectedId = null;

    const setDetailsVisible = (on) => {
      if(tEmpty) tEmpty.style.display = on ? "none" : "block";
      if(tDetails) tDetails.style.display = on ? "block" : "none";
    };

    const render = () => {
      purgeOldTrash();
      const tr = getTrash();
      if(list) list.innerHTML = "";
      selectedId = null;
      setDetailsVisible(false);

      if(emptyNote) emptyNote.style.display = tr.length ? "none" : "block";

      tr.forEach(item => {
        const row = document.createElement("div");
        row.className = "item";
        row.dataset.id = item.id;

        const title = document.createElement("div");
        title.className = "item-title";
        title.textContent = item.title || "Untitled";

        const sub = document.createElement("div");
        sub.className = "item-sub";
        const left = document.createElement("span");
        left.textContent = "Deleted";
        const right = document.createElement("span");
        right.textContent = new Date(item.deletedAt || item.createdAt || nowISO()).toLocaleDateString();
        sub.appendChild(left);
        sub.appendChild(right);

        row.appendChild(title);
        row.appendChild(sub);

        row.addEventListener("click", () => {
          [...list.querySelectorAll(".item")].forEach(x => x.classList.remove("active"));
          row.classList.add("active");

          selectedId = item.id;
          setDetailsVisible(true);
          if(tTitle) tTitle.textContent = item.title || "Untitled";
          if(tDeleted) tDeleted.textContent = fmtDate(item.deletedAt || nowISO());

          btnRestore._item = item;
          btnDeleteForever._item = item;
        });

        if(list) list.appendChild(row);
      });
    };

    if(btnRestore){
      btnRestore.addEventListener("click", () => {
        const it = btnRestore._item;
        if(!it) return;

        // remove from trash
        const tr = getTrash().filter(x => x.id !== it.id);
        setTrash(tr);

        // add back to library
        const lib = getLibrary();
        const restored = { ...it };
        delete restored.deletedAt;
        lib.unshift(restored);
        setLibrary(lib);

        alert("Restored to Library.");
        render();
      });
    }

    if(btnDeleteForever){
      btnDeleteForever.addEventListener("click", () => {
        const it = btnDeleteForever._item;
        if(!it) return;
        if(!confirm("Delete forever? This cannot be undone.")) return;

        const tr = getTrash().filter(x => x.id !== it.id);
        setTrash(tr);
        alert("Deleted forever.");
        render();
      });
    }

    if(btnEmptyAll){
      btnEmptyAll.addEventListener("click", () => {
        if(!confirm("Empty entire trash forever?")) return;
        setTrash([]);
        alert("Trash emptied.");
        render();
      });
    }

    render();
  };

  // ---------- Profile Page ----------
  const profilePageInit = () => {
    purgeOldTrash();

    const elName = document.getElementById("displayName");
    const btnSave = document.getElementById("btnSaveName");
    const btnReset = document.getElementById("btnResetName");

    const pCredits = document.getElementById("pCredits");
    const pTracks = document.getElementById("pTracks");
    const pTrash = document.getElementById("pTrash");

    const refreshStats = () => {
      const p = getProfile();
      const stats = getStats();
      if(pCredits) pCredits.textContent = Number(p.credits || 7537).toLocaleString();
      if(pTracks) pTracks.textContent = String(stats.libraryCount);
      if(pTrash) pTrash.textContent = String(stats.trashCount);

      // also reflect sidebar name
      const nameEl = document.getElementById("profileNameSidebar");
      if(nameEl) nameEl.textContent = p.name || "YOU";
    };

    const p = getProfile();
    if(elName) elName.value = p.name || "YOU";

    if(btnSave){
      btnSave.addEventListener("click", () => {
        setProfileName(elName.value);
        alert("Saved.");
        refreshStats();
      });
    }

    if(btnReset){
      btnReset.addEventListener("click", () => {
        setProfileName("YOU");
        if(elName) elName.value = "YOU";
        alert("Reset.");
        refreshStats();
      });
    }

    refreshStats();
  };

  return {
    initBaseUI,
    createPageInit,
    libraryPageInit,
    trashPageInit,
    profilePageInit,
    getStats
  };
})();
