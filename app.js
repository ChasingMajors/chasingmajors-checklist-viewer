const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbz25GxN79WE7PFzb1vT0bsXZBuMp11Qs2vvhJAnH3r3qOrYzYNwp_14n420ml4Bu5t_/exec";

/**
 * UX behavior:
 * - If query is likely a set name, load Set View and show Base checklist by default (higher initial load).
 * - Otherwise, show player search results list (non-clickable).
 *
 * NOTE: Set detection is:
 *   1) Try Products route first. If it returns anything, pick best match and open that code.
 *   2) If Products is empty, but query looks like a code (contains underscore), treat as code.
 *   3) Fallback to player search.
 */

const state = {
  apiBase: "",
  sport: "baseball",

  // search
  q: "",
  searchOffset: 0,
  searchLimit: 25,
  searchHasMore: false,
  searchShown: 0,

  // set view
  setCode: "",
  setSummary: null,
  activeTab: "Base",
  // for Base checklist paging
  baseOffset: 0,
  baseLimit: 150,          // higher initial load for product search
  baseTotal: 0,
};

const TAB_ORDER = ["Base", "Base Parallels", "Inserts", "Autographs", "Relics", "Variations"];

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

function showSearchUI() {
  $("setView").style.display = "none";
  $("searchResults").style.display = "block";
  $("backToSearch").style.display = "none";
}

function showSetUI() {
  $("setView").style.display = "block";
  $("searchResults").style.display = "none";
  $("moreSearch").style.display = "none";
  $("countPill").style.display = "none";
  $("backToSearch").style.display = "inline-flex";
}

/* ---------------------------
   SEARCH: player results list
---------------------------- */

function renderSearchRows(rows, append) {
  const box = $("searchResults");
  if (!append) box.innerHTML = "";

  const html = rows.map(r => {
    const cardNo = escapeHtml(r.card_no || "");
    const player = escapeHtml(r.player || "");
    const team = escapeHtml(r.team || "");
    const badges = tagsToBadges(r.tags);
    return `
      <div class="r">
        <div class="rTop">${cardNo} ${player} — ${team}${badges}</div>
      </div>
    `;
  }).join("");

  if (append) box.insertAdjacentHTML("beforeend", html);
  else box.innerHTML = html;
}

function setSearchPills() {
  $("countPill").style.display = "inline-flex";
  $("countPill").textContent = `${state.searchShown} results`;
  $("moreSearch").style.display = state.searchHasMore ? "inline-flex" : "none";
}

async function searchCardsPage(append) {
  const j = await fetchJson("search_cards", {
    sport: state.sport,
    q: state.q,
    limit: state.searchLimit,
    offset: state.searchOffset
  });

  if (!j.ok) {
    $("searchResults").style.display = "block";
    $("searchResults").innerHTML = `<div class="r"><div class="rTop">Search failed</div><div class="rSub">${escapeHtml(j.error || "Unknown error")}</div></div>`;
    state.searchHasMore = false;
    $("moreSearch").style.display = "none";
    return;
  }

  const items = j.items || [];
  if (!append) state.searchShown = 0;

  if (!items.length && !append) {
    $("searchResults").style.display = "block";
    $("searchResults").innerHTML = `<div class="r"><div class="rTop">No results</div><div class="rSub">Try a player name (Judge) or a product code (2026_topps_series1).</div></div>`;
    state.searchHasMore = false;
    $("countPill").style.display = "none";
    $("moreSearch").style.display = "none";
    return;
  }

  $("searchResults").style.display = "block";
  renderSearchRows(items, append);

  state.searchShown += items.length;
  state.searchHasMore = !!j.has_more;
  setSearchPills();
}

async function doMoreSearch() {
  state.searchOffset += state.searchLimit;
  await searchCardsPage(true);
}

/* ---------------------------
   SET VIEW
---------------------------- */

function secCount(sectionName) {
  const sec = (state.setSummary?.sections || []).find(x => x.section === sectionName);
  return sec ? (sec.count || 0) : 0;
}

function setSetHeader() {
  $("setTitle").textContent = `${state.activeTab === "Base Parallels" ? "Base Parallels" : state.activeTab} — ${state.activeTab === "Base Parallels" ? "" : ""}`.trim();
  $("setCode").textContent = state.setCode;

  // For Base: show total base cards for the product (from summary/Base section count)
  if (state.activeTab === "Base" || state.activeTab === "Base Parallels") {
    $("setMeta").textContent = `${secCount("Base")} Cards`;
  } else {
    $("setMeta").textContent = `${secCount(state.activeTab)} Cards`;
  }
}

function renderSetTabs() {
  const el = $("setTabs");
  el.innerHTML = "";

  TAB_ORDER.forEach(t => {
    const b = document.createElement("button");
    b.className = "tab" + (t === state.activeTab ? " active" : "");
    b.textContent = t;
    b.onclick = async () => {
      state.activeTab = t;
      renderSetTabs();
      setSetHeader();
      await renderActiveTab();
    };
    el.appendChild(b);
  });
}

function formatParallelLine(p) {
  const name = String(p.parallel_name || "").trim();
  const sn = String(p.serial_no || "").trim();
  return sn ? `${name} ${sn}` : name;
}

async function fetchParallelsFor(section, subset /* optional */) {
  const j = await fetchJson("parallels", {
    sport: state.sport,
    code: state.setCode,
    section,
    subset: subset || ""
  });
  if (!j.ok) return [];
  return j.items || [];
}

async function fetchAllCardsForSection(section) {
  // Pull all pages (limit capped to 500 server-side)
  const all = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const j = await fetchJson("cards", {
      sport: state.sport,
      code: state.setCode,
      section,
      limit,
      offset
    });

    if (!j.ok) break;

    const items = j.items || [];
    all.push(...items);

    const total = j.total || 0;
    offset += limit;
    if (all.length >= total) break;

    // Safety: don’t spin forever if sheet has weird totals
    if (offset > 20000) break;
  }

  return all;
}

function groupBySubset(items) {
  const map = new Map();
  items.forEach(it => {
    const subset = String(it.subset || "[Unspecified]").trim() || "[Unspecified]";
    if (!map.has(subset)) map.set(subset, []);
    map.get(subset).push(it);
  });

  // Stable-ish ordering:
  // - Put [Base] first if present (for Base section), otherwise alpha
  const keys = Array.from(map.keys());
  keys.sort((a, b) => {
    if (a === "[Base]") return -1;
    if (b === "[Base]") return 1;
    return a.localeCompare(b);
  });

  return keys.map(k => ({ subset: k, items: map.get(k) }));
}

function renderSubsetBlock(subsetName, cards, parallels) {
  const count = cards.length;

  // Cards list: for non-base sections, usually player-only is best.
  // If card_no exists and is meaningful, include it.
  const playersHtml = cards.map(c => {
    const player = String(c.player || "").trim();
    const cardNo = String(c.card_no || "").trim();
    const tags = tagsToBadges(c.tags);

    const line = (cardNo && cardNo !== "0")
      ? `${escapeHtml(cardNo)} ${escapeHtml(player)}${tags}`
      : `${escapeHtml(player)}${tags}`;

    return `<li>${line}</li>`;
  }).join("");

  const parallelsHtml = parallels.length
    ? `<div class="parTitle">Parallels:</div><ul class="par">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle">Parallels:</div><ul class="par"><li>None listed.</li></ul>`;

  return `
    <div class="sectionBlock">
      <div class="subsetTitle">${escapeHtml(subsetName)}</div>
      <div class="subsetMeta">${count} Cards</div>
      ${parallelsHtml}
      <ul class="players">${playersHtml || "<li>No cards found.</li>"}</ul>
    </div>
  `;
}

async function renderBaseChecklist() {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading Base checklist…</div><div class="rSub">Pulling cards…</div></div>`;

  // Base checklist: show [Base] subset within Base section, with higher initial load
  state.baseOffset = 0;

  const j = await fetchJson("cards", {
    sport: state.sport,
    code: state.setCode,
    section: "Base",
    subset: "[Base]",
    limit: state.baseLimit,
    offset: state.baseOffset
  });

  if (!j.ok) {
    body.innerHTML = `<div class="r"><div class="rTop">Failed to load Base</div><div class="rSub">${escapeHtml(j.error || "")}</div></div>`;
    return;
  }

  state.baseTotal = j.total || 0;
  const items = j.items || [];

  // Base parallels list comes from Parallels tab for section=Base subset=[Base]
  const parallels = await fetchParallelsFor("Base", "[Base]");

  const parallelsHtml = parallels.length
    ? `<div class="parTitle">Parallels:</div><ul class="par">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle">Parallels:</div><ul class="par"><li>None listed.</li></ul>`;

  const listHtml = items.map(it => {
    const cardNo = escapeHtml(it.card_no || "");
    const player = escapeHtml(it.player || "");
    const team = escapeHtml(it.team || "");
    const tags = tagsToBadges(it.tags);
    return `<div class="r"><div class="rTop">${cardNo} ${player} — ${team}${tags}</div></div>`;
  }).join("");

  const moreBtn = (state.baseLimit + state.baseOffset < state.baseTotal)
    ? `<div class="btnRow"><button id="moreBase" class="btnGhost">Show more Base cards</button><div class="pill">${items.length} / ${state.baseTotal}</div></div>`
    : `<div class="btnRow"><div class="pill">${items.length} / ${state.baseTotal}</div></div>`;

  body.innerHTML = `
    <div class="setHeaderSub">Base Checklist</div>
    <div class="setHeaderSub">${state.baseTotal} Cards</div>
    ${parallelsHtml}
    <div class="resultsBox" style="margin-top:12px;">${listHtml || `<div class="r"><div class="rTop">No cards found.</div></div>`}</div>
    ${moreBtn}
  `;

  const more = document.getElementById("moreBase");
  if (more) {
    more.onclick = async () => {
      state.baseOffset += state.baseLimit;

      const j2 = await fetchJson("cards", {
        sport: state.sport,
        code: state.setCode,
        section: "Base",
        subset: "[Base]",
        limit: state.baseLimit,
        offset: state.baseOffset
      });

      if (!j2.ok) return;

      const items2 = j2.items || [];
      const addHtml = items2.map(it => {
        const cardNo = escapeHtml(it.card_no || "");
        const player = escapeHtml(it.player || "");
        const team = escapeHtml(it.team || "");
        const tags = tagsToBadges(it.tags);
        return `<div class="r"><div class="rTop">${cardNo} ${player} — ${team}${tags}</div></div>`;
      }).join("");

      const box = body.querySelector(".resultsBox");
      box.insertAdjacentHTML("beforeend", addHtml);

      const shown = Math.min(state.baseOffset + state.baseLimit, state.baseTotal);
      const pill = body.querySelector(".btnRow .pill");
      if (pill) pill.textContent = `${shown} / ${state.baseTotal}`;

      if (shown >= state.baseTotal) {
        more.remove();
      }
    };
  }
}

async function renderBaseParallelsOnly() {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading Base parallels…</div></div>`;

  const parallels = await fetchParallelsFor("Base", "[Base]");

  body.innerHTML = parallels.length
    ? `<div class="parTitle">Parallels:</div><ul class="par">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle">Parallels:</div><ul class="par"><li>None listed.</li></ul>`;
}

async function renderGroupedSection(sectionName) {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading ${escapeHtml(sectionName)}…</div><div class="rSub">This may take a moment for large sections.</div></div>`;

  // Fetch all cards for that section (paged)
  const cards = await fetchAllCardsForSection(sectionName);

  // Fetch all parallels for that section (no subset filter)
  const parallelsAll = await fetchParallelsFor(sectionName, "");

  // Group cards by subset
  const grouped = groupBySubset(cards);

  // Group parallels by subset too
  const parBySubset = new Map();
  parallelsAll.forEach(p => {
    const subset = String(p.applies_to_subset || p.subset || "[Unspecified]").trim() || "[Unspecified]";
    if (!parBySubset.has(subset)) parBySubset.set(subset, []);
    parBySubset.get(subset).push(p);
  });

  // Render blocks
  const html = grouped.map(g => {
    const pars = parBySubset.get(g.subset) || [];
    return renderSubsetBlock(g.subset, g.items, pars);
  }).join("");

  body.innerHTML = html || `<div class="r"><div class="rTop">No cards found in ${escapeHtml(sectionName)}.</div></div>`;
}

async function renderActiveTab() {
  if (!state.setCode) return;

  if (state.activeTab === "Base") return renderBaseChecklist();
  if (state.activeTab === "Base Parallels") return renderBaseParallelsOnly();

  // Other sections: group by subset and show parallels + players
  return renderGroupedSection(state.activeTab);
}

async function openSetByCode(code) {
  state.setCode = code;
  state.activeTab = "Base";
  $("setCode").textContent = code;

  showSetUI();
  $("setTitle").textContent = "Loading…";
  $("setMeta").textContent = "Loading…";
  $("setBody").innerHTML = "";

  const j = await fetchJson("summary", { sport: state.sport, code: state.setCode });
  if (!j.ok) {
    $("setBody").innerHTML = `<div class="r"><div class="rTop">Set load failed</div><div class="rSub">${escapeHtml(j.error || "")}</div></div>`;
    return;
  }

  state.setSummary = j;

  renderSetTabs();
  setSetHeader();
  await renderActiveTab();
}

/* ---------------------------
   PRODUCT detection
---------------------------- */

function looksLikeCode(q) {
  // very light heuristic
  const s = String(q || "").trim();
  return s.includes("_") && s.length >= 8;
}

async function tryOpenSetFromProducts(q) {
  // If Products tab isn't populated, this will return empty and we’ll fallback.
  const j = await fetchJson("products", { sport: state.sport, q });
  if (!j.ok) return false;

  const items = j.items || [];
  if (!items.length) return false;

  // pick first/best match
  const code = String(items[0].code || "").trim();
  if (!code) return false;

  await openSetByCode(code);
  return true;
}

/* ---------------------------
   SEARCH orchestrator
---------------------------- */

async function doSearch() {
  state.sport = $("sport").value;
  state.apiBase = normalizeApiBase($("apiBase").value);
  saveLocal();

  state.q = $("search").value.trim();
  if (!state.apiBase || !state.q) return;

  await checkHealth();

  // Reset search paging UI
  state.searchOffset = 0;
  state.searchShown = 0;
  state.searchHasMore = false;
  $("moreSearch").style.display = "none";
  $("countPill").style.display = "none";

  // Try set first (product name), then fallback
  $("searchResults").style.display = "block";
  $("searchResults").innerHTML = `<div class="r"><div class="rTop">Searching…</div><div class="rSub">${escapeHtml(state.q)}</div></div>`;

  const opened = await tryOpenSetFromProducts(state.q);

  if (!opened && looksLikeCode(state.q)) {
    // treat as code
    await openSetByCode(state.q);
    return;
  }

  if (opened) return;

  // Fallback: player search list
  showSearchUI();
  await searchCardsPage(false);
}

async function doBackToSearch() {
  $("setView").style.display = "none";
  $("searchResults").style.display = "block";
  $("backToSearch").style.display = "none";
}

/* ---------------------------
   Wire up
---------------------------- */

function wire() {
  $("apiBase").addEventListener("change", async () => {
    state.apiBase = normalizeApiBase($("apiBase").value);
    saveLocal();
    await checkHealth();
  });

  $("go").onclick = doSearch;
  $("search").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  $("moreSearch").onclick = doMoreSearch;

  $("backToSearch").onclick = () => {
    // just hides set view; leaves results as they were
    $("setView").style.display = "none";
    $("searchResults").style.display = "block";
    $("backToSearch").style.display = "none";
  };
}

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
