const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbyZbd_9POsLRLA4jydnDrSTibj7L_BE2zmS9ia0eCSG76LFLojXd8ZBp9E5Y-5DmvJm/exec";

const state = {
  apiBase: "",
  sport: "baseball",
  mode: "products",

  // product viewer state
  code: "",
  summary: null,
  section: "",
  subset: "[Base]",
  player: "",
  tag: "",
  limit: 100,
  offset: 0,
  total: 0,

  // global cards search pagination
  globalOffset: 0
};

const $ = (id) => document.getElementById(id);

function normalizeApiBase(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return s.endsWith("/exec") ? s : s.replace(/\/+$/, "");
}

function qs(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    const s = String(v);
    if (s === "") return;
    sp.set(k, s);
  });
  return sp.toString();
}

async function fetchJson(route, params) {
  const url = `${state.apiBase}?${qs({ route, ...params })}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function setApi(ok, text) {
  const el = $("apiPill");
  el.textContent = text;
  el.style.borderColor = ok ? "#10b981" : "#ef4444";
}

async function checkHealth() {
  try {
    const j = await fetchJson("health", {});
    setApi(!!j.ok, j.ok ? "API: OK" : "API: error");
  } catch {
    setApi(false, "API: offline");
  }
}

function saveLocal() {
  localStorage.setItem("cm_api_base", state.apiBase);
  localStorage.setItem("cm_sport", state.sport);
}

function loadLocal() {
  state.apiBase = normalizeApiBase(localStorage.getItem("cm_api_base") || DEFAULT_API_BASE);
  state.sport = localStorage.getItem("cm_sport") || "baseball";
  $("apiBase").value = state.apiBase;
  $("sport").value = state.sport;
}

function showResults(items, renderer) {
  const box = $("searchResults");
  if (!items.length) {
    box.style.display = "block";
    box.innerHTML = `<div class="r"><div class="rTop">No results</div><div class="rSub">Try different keywords.</div></div>`;
    return;
  }
  box.style.display = "block";
  box.innerHTML = items.map(renderer).join("");
}

function hideResults() {
  const box = $("searchResults");
  box.style.display = "none";
  box.innerHTML = "";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function tagsToBadges(tagsCell) {
  const t = String(tagsCell || "").trim();
  if (!t) return "";
  const tags = t.split("|").map(x => x.trim().toUpperCase()).filter(Boolean);
  return tags.map(x => `<span class="badge">${escapeHtml(x)}</span>`).join("");
}

function setViewerVisible(on) {
  $("viewer").style.display = on ? "block" : "none";
  $("emptyViewer").style.display = on ? "none" : "block";
}

function setViewerHeader() {
  const secObj = (state.summary?.sections || []).find(x => x.section === state.section);
  const secCount = secObj?.count || 0;

  $("viewerTitle").textContent = `${state.section} Checklist`;
  $("viewerSub").textContent = `${secCount} Cards`;
  $("viewerCode").textContent = state.code;
}

function renderTabs() {
  const el = $("sectionTabs");
  el.innerHTML = "";
  (state.summary?.sections || []).forEach(s => {
    const b = document.createElement("button");
    b.className = "tab" + (s.section === state.section ? " active" : "");
    b.textContent = `${s.section}`;
    b.onclick = async () => {
      state.section = s.section;
      state.offset = 0;
      state.subset = "[Base]"; // default; will be replaced if not present
      renderTabs();
      renderSubset();
      setViewerHeader();
      await loadParallels();
      await loadCards();
    };
    el.appendChild(b);
  });
}

function renderSubset() {
  const sel = $("subset");
  sel.innerHTML = "";

  const secObj = (state.summary?.sections || []).find(x => x.section === state.section);
  const subsets = secObj?.subsets || [];

  // If [Base] exists, default to it; otherwise default to first subset
  const hasBase = subsets.some(x => x.subset === "[Base]");
  const defaultSubset = hasBase ? "[Base]" : (subsets[0]?.subset || "[Base]");
  if (!state.subset) state.subset = defaultSubset;

  subsets.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.subset;
    opt.textContent = `${s.subset} (${s.count})`;
    sel.appendChild(opt);
  });

  sel.value = state.subset;
  sel.onchange = async () => {
    state.subset = sel.value;
    state.offset = 0;
    await loadParallels();
    await loadCards();
  };
}

async function loadParallels() {
  const ul = $("parallels");
  ul.innerHTML = "<li>Loading…</li>";

  const j = await fetchJson("parallels", {
    sport: state.sport,
    code: state.code,
    section: state.section,
    subset: state.subset
  });

  if (!j.ok) {
    ul.innerHTML = "<li>No parallels found.</li>";
    return;
  }

  const items = j.items || [];
  if (!items.length) {
    ul.innerHTML = "<li>None listed.</li>";
    return;
  }

  ul.innerHTML = items.map(p => {
    const name = escapeHtml(p.parallel_name || "");
    const sn = escapeHtml(p.serial_no || "");
    return `<li>${sn ? `${name} ${sn}` : name}</li>`;
  }).join("");
}

function setPaging() {
  const page = Math.floor(state.offset / state.limit) + 1;
  const totalPages = Math.max(1, Math.ceil((state.total || 0) / state.limit));
  $("pageMeta").textContent = `Page ${page} of ${totalPages}`;
  $("resultsMeta").textContent = `Results: ${state.total}`;
  $("prev").disabled = state.offset <= 0;
  $("next").disabled = state.offset + state.limit >= (state.total || 0);
}

async function loadCards() {
  const ul = $("cards");
  ul.innerHTML = "<li>Loading…</li>";

  const j = await fetchJson("cards", {
    sport: state.sport,
    code: state.code,
    section: state.section,
    subset: state.subset,
    player: state.player,
    tag: state.tag,
    limit: state.limit,
    offset: state.offset
  });

  if (!j.ok) {
    ul.innerHTML = `<li>Load failed.</li>`;
    return;
  }

  state.total = j.total || 0;
  setPaging();

  const items = j.items || [];
  if (!items.length) {
    ul.innerHTML = `<li>No results.</li>`;
    return;
  }

  ul.innerHTML = items.map(it => {
    const cardNo = escapeHtml(it.card_no || "");
    const player = escapeHtml(it.player || "");
    const team = escapeHtml(it.team || "");
    const badge = tagsToBadges(it.tags);
    return `<li><div class="line">${cardNo} ${player} — ${team}${badge}</div></li>`;
  }).join("");
}

async function loadProductByCode(code) {
  state.code = code;
  state.offset = 0;
  state.player = "";
  state.tag = "";
  $("playerFilter").value = "";
  $("tag").value = "";

  const j = await fetchJson("summary", { sport: state.sport, code: state.code });
  if (!j.ok) throw new Error(j.error || "summary error");

  state.summary = j;
  state.section = j.sections?.[0]?.section || "Base";

  setViewerVisible(true);
  setViewerHeader();
  renderTabs();
  renderSubset();
  await loadParallels();
  await loadCards();
}

/* -----------------------
   SEARCH
----------------------- */

async function searchProducts(q) {
  // Uses your existing route=products (in your sport workbook)
  const j = await fetchJson("products", { sport: state.sport, q });
  if (!j.ok) return [];

  // Prefer items that have release_name. Fallback to code.
  return (j.items || []).slice(0, 20).map(x => ({
    code: x.code,
    title: x.release_name || x.product || x.code,
    sub: [x.year, x.manufacturer, x.product].filter(Boolean).join(" • ")
  }));
}

async function searchCardsGlobal(q) {
  // NEW route=search_cards
  const j = await fetchJson("search_cards", { sport: state.sport, q, limit: 25, offset: state.globalOffset });
  if (!j.ok) return { items: [], has_more: false };

  const items = (j.items || []).map(x => ({
    code: x.code,
    line: `${x.card_no} ${x.player} — ${x.team}`,
    sub: `${x.section} • ${x.subset}`,
    tags: x.tags || ""
  }));

  return { items, has_more: !!j.has_more };
}

async function doSearch() {
  hideResults();

  state.sport = $("sport").value;
  state.mode = $("mode").value;
  state.apiBase = normalizeApiBase($("apiBase").value);
  saveLocal();

  if (!state.apiBase) return;

  const q = $("search").value.trim();
  if (!q) return;

  await checkHealth();

  if (state.mode === "products") {
    const items = await searchProducts(q);
    showResults(items, (it, idx) => `
      <div class="r" data-idx="${idx}">
        <div class="rTop">${escapeHtml(it.title)}</div>
        <div class="rSub">${escapeHtml(it.sub)} • code=${escapeHtml(it.code)}</div>
      </div>
    `);

    // click handler
    $("searchResults").onclick = async (ev) => {
      const row = ev.target.closest(".r");
      if (!row) return;
      const idx = Number(row.getAttribute("data-idx"));
      const pick = items[idx];
      if (!pick) return;
      hideResults();
      await loadProductByCode(pick.code);
    };

    return;
  }

  // cards mode (global)
  state.globalOffset = 0;
  const { items, has_more } = await searchCardsGlobal(q);

  showResults(items, (it, idx) => `
    <div class="r" data-idx="${idx}">
      <div class="rTop">${escapeHtml(it.line)}${tagsToBadges(it.tags)}</div>
      <div class="rSub">${escapeHtml(it.sub)} • code=${escapeHtml(it.code)}</div>
    </div>
  `);

  $("searchResults").onclick = async (ev) => {
    const row = ev.target.closest(".r");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    const pick = items[idx];
    if (!pick) return;

    hideResults();

    // Jump into the product, and auto-filter player (best-effort)
    await loadProductByCode(pick.code);
    const parts = pick.line.split("—")[0].trim(); // "1 Aaron Judge"
    const maybeName = parts.replace(/^\S+\s+/, "").trim(); // remove card_no
    $("playerFilter").value = maybeName;
    state.player = maybeName;
    state.offset = 0;
    await loadCards();
  };

  // If there are more results, add a "load more" row
  if (has_more) {
    const box = $("searchResults");
    const more = document.createElement("div");
    more.className = "r";
    more.innerHTML = `<div class="rTop">Load more results…</div><div class="rSub">Continue searching in this sport.</div>`;
    more.onclick = async () => {
      state.globalOffset += 25;
      const next = await searchCardsGlobal(q);
      const existing = box.innerHTML;
      box.innerHTML = existing + next.items.map((it, idx) => `
        <div class="r" data-idx="${items.length + idx}">
          <div class="rTop">${escapeHtml(it.line)}${tagsToBadges(it.tags)}</div>
          <div class="rSub">${escapeHtml(it.sub)} • code=${escapeHtml(it.code)}</div>
        </div>
      `).join("");
      items.push(...next.items);
    };
    box.appendChild(more);
  }
}

/* -----------------------
   Viewer actions
----------------------- */

function wire() {
  $("apiBase").addEventListener("change", async () => {
    state.apiBase = normalizeApiBase($("apiBase").value);
    saveLocal();
    await checkHealth();
  });

  $("go").onclick = doSearch;

  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  $("apply").onclick = async () => {
    state.player = $("playerFilter").value.trim();
    state.tag = $("tag").value.trim();
    state.offset = 0;
    await loadCards();
  };

  $("prev").onclick = async () => {
    state.offset = Math.max(0, state.offset - state.limit);
    await loadCards();
  };

  $("next").onclick = async () => {
    state.offset = state.offset + state.limit;
    await loadCards();
  };
}

/* -----------------------
   Init + PWA
----------------------- */

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./sw.js"); } catch {}
}

(async function init() {
  loadLocal();
  state.apiBase = normalizeApiBase($("apiBase").value);
  saveLocal();
  wire();
  await checkHealth();
  await registerSW();
})();
