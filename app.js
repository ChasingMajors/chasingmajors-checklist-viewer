const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbz25GxN79WE7PFzb1vT0bsXZBuMp11Qs2vvhJAnH3r3qOrYzYNwp_14n420ml4Bu5t_/exec";

const state = {
  apiBase: DEFAULT_API_BASE,
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

  // base paging (client-side)
  baseOffset: 0,
  baseLimit: 150,
  baseAll: [],

  // tab visibility
  hasBaseParallels: true,

  // typeahead
  taTimer: null,
  taItems: [],
  taCache: new Map(),
  taAbort: null,
  taWarmStarted: false,

  // browse modal
  browse: {
    q: "",
    offset: 0,
    limit: 50,
    hasMore: false,
    shown: 0,
    debounce: null,
  },

  theme: "dark",
};

const TAB_ORDER = ["Base", "Base Parallels", "Inserts", "Autographs", "Relics", "Variations"];

const TAB_TO_SECTIONS = {
  "Base": ["Base"],
  "Inserts": ["Insert"],
  "Autographs": ["Autograph", "Auto Relic"],
  "Relics": ["Relic"],
  "Variations": ["Variation"],
};

const $ = (id) => document.getElementById(id);

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

async function fetchJson(route, params, opts = {}) {
  const url = `${state.apiBase}?${qs({ route, ...params })}`;
  const res = await fetch(url, { cache: "no-store", signal: opts.signal });
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

/* ---------------------------
   Theme toggle (mirrors Print Run Vault)
---------------------------- */

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("cm_theme", state.theme);

  // swap icon
  const icon = $("themeIcon");
  if (!icon) return;

  if (state.theme === "dark") {
    // moon
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
    // sun
    icon.innerHTML = `
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path><path d="M12 20v2"></path>
      <path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path>
      <path d="M2 12h2"></path><path d="M20 12h2"></path>
      <path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>
    `;
  }
}

function loadTheme() {
  const saved = localStorage.getItem("cm_theme");
  if (saved === "light" || saved === "dark") return setTheme(saved);

  // default dark
  setTheme("dark");
}

/* ---------------------------
   NATURAL SORTING
---------------------------- */

function naturalCompare(a, b) {
  const ax = String(a || "").toUpperCase().match(/(\d+|\D+)/g) || [];
  const bx = String(b || "").toUpperCase().match(/(\d+|\D+)/g) || [];
  const n = Math.max(ax.length, bx.length);

  for (let i = 0; i < n; i++) {
    const x = ax[i] ?? "";
    const y = bx[i] ?? "";
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);

    if (xNum && yNum) {
      const xi = parseInt(x, 10);
      const yi = parseInt(y, 10);
      if (xi !== yi) return xi - yi;
      if (x.length !== y.length) return x.length - y.length;
    } else {
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return 0;
}

function compareCardsByCardNo(a, b) {
  const ac = String(a?.card_no || "").trim();
  const bc = String(b?.card_no || "").trim();

  if (!ac && !bc) return 0;
  if (!ac) return 1;
  if (!bc) return -1;

  const c = naturalCompare(ac, bc);
  if (c !== 0) return c;

  const ap = String(a?.player || "").toUpperCase();
  const bp = String(b?.player || "").toUpperCase();
  if (ap !== bp) return ap < bp ? -1 : 1;

  return 0;
}

/* ---------------------------
   API status
---------------------------- */

function setApi(ok, text) {
  const el = $("apiPill");
  if (!el) return;
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

/* ---------------------------
   Local storage (sport only)
---------------------------- */

function saveLocal() {
  localStorage.setItem("cm_sport", state.sport);
}

function loadLocal() {
  state.sport = localStorage.getItem("cm_sport") || "baseball";
  const sportEl = $("sport");
  if (sportEl) sportEl.value = state.sport;
}

/* ---------------------------
   Typeahead (snappy)
---------------------------- */

function closeTypeahead() {
  const box = $("typeahead");
  if (!box) return;
  box.style.display = "none";
  box.innerHTML = "";
  state.taItems = [];
}

function openTypeahead(items) {
  const box = $("typeahead");
  if (!box) return;

  if (!items || !items.length) return closeTypeahead();

  state.taItems = items;

  const html = items.slice(0, 8).map((p, idx) => {
    const release = escapeHtml(p.release_name || p.product || p.code || "Unknown set");
    const year = escapeHtml(p.year || "");
    const manu = escapeHtml(p.manufacturer || "");
    const code = escapeHtml(p.code || "");
    const sub = [year, manu, code].filter(Boolean).join(" • ");
    return `
      <div class="typeaheadItem" data-idx="${idx}">
        <div class="typeaheadTitle">${release}</div>
        <div class="typeaheadSub">${sub}</div>
      </div>
    `;
  }).join("");

  box.innerHTML = html;
  box.style.display = "block";

  box.querySelectorAll(".typeaheadItem").forEach(el => {
    el.addEventListener("mousedown", async (e) => {
      const idx = parseInt(el.getAttribute("data-idx") || "0", 10);
      const item = state.taItems[idx];
      closeTypeahead();
      if (item?.code) {
        await openSetByCode(item.code);
        $("search").value = "";
      }
      e.preventDefault();
    });
  });
}

async function fetchProductSuggestions(q) {
  const key = `${state.sport}|${q.toLowerCase()}`;
  if (state.taCache.has(key)) return state.taCache.get(key);

  try { state.taAbort?.abort(); } catch {}
  state.taAbort = new AbortController();

  const j = await fetchJson("products", { sport: state.sport, q }, { signal: state.taAbort.signal });
  const items = j?.ok ? (j.items || []) : [];
  state.taCache.set(key, items);
  return items;
}

function scheduleTypeahead() {
  clearTimeout(state.taTimer);
  state.taTimer = setTimeout(async () => {
    const q = ($("search").value || "").trim();
    if (q.length < 2) return closeTypeahead();
    if (q.includes("_")) return closeTypeahead();

    try {
      const items = await fetchProductSuggestions(q);
      openTypeahead(items);
    } catch {
      closeTypeahead();
    }
  }, 90);
}

async function warmTypeaheadOnce() {
  if (state.taWarmStarted) return;
  state.taWarmStarted = true;
  try { await fetchProductSuggestions("topps"); } catch {}
}

/* ---------------------------
   Search results UX (grouped)
---------------------------- */

function setSearchPills() {
  const pill = $("countPill");
  if (!pill) return;
  pill.style.display = "inline-flex";
  pill.textContent = `${state.searchShown} results`;
  $("moreSearch").style.display = state.searchHasMore ? "inline-flex" : "none";
}

function groupSearchItems(items) {
  const byCode = new Map();

  items.forEach(it => {
    const code = String(it.code || "").trim() || "[Unknown set]";
    const subset = String(it.subset || "").trim() || "[Unspecified]";
    if (!byCode.has(code)) byCode.set(code, new Map());
    const bySubset = byCode.get(code);
    if (!bySubset.has(subset)) bySubset.set(subset, []);
    bySubset.get(subset).push(it);
  });

  const codes = Array.from(byCode.keys()).sort((a,b) => a.localeCompare(b));
  const out = [];

  for (const code of codes) {
    const bySubset = byCode.get(code);
    const subsets = Array.from(bySubset.keys()).sort((a,b) => a.localeCompare(b));
    for (const subset of subsets) {
      const arr = bySubset.get(subset) || [];
      arr.sort(compareCardsByCardNo);
      out.push({ code, subset, items: arr });
    }
  }

  return out;
}

function renderSearchGrouped(items, append) {
  const box = $("searchResults");
  if (!append) box.innerHTML = "";

  const groups = groupSearchItems(items);

  const html = groups.map(g => {
    const headerTitle = escapeHtml(g.subset === "[Unspecified]" ? g.code : `${g.code} • ${g.subset}`);
    const sec = String(g.items?.[0]?.section || "").trim();
    const meta = escapeHtml([sec, `${g.items.length} cards`].filter(Boolean).join(" • "));

    const rows = g.items.map(r => {
      const cardNo = escapeHtml(r.card_no || "");
      const player = escapeHtml(r.player || "");
      const team = escapeHtml(r.team || "");
      const tags = tagsToBadges(r.tags);
      return `<div class="r"><div class="rTop">${cardNo} ${player} — ${team}${tags}</div></div>`;
    }).join("");

    return `
      <div class="r">
        <div class="rTop" style="font-weight:950;">${headerTitle}</div>
        <div class="rSub">${meta}</div>
      </div>
      ${rows}
    `;
  }).join("");

  if (append) box.insertAdjacentHTML("beforeend", html);
  else box.innerHTML = html;
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
    $("searchResults").innerHTML =
      `<div class="r"><div class="rTop">Search failed</div><div class="rSub">${escapeHtml(j.error || "Unknown error")}</div></div>`;
    state.searchHasMore = false;
    $("moreSearch").style.display = "none";
    return;
  }

  const items = (j.items || []).slice();

  if (!append) state.searchShown = 0;

  if (!items.length && !append) {
    $("searchResults").style.display = "block";
    $("searchResults").innerHTML =
      `<div class="r"><div class="rTop">No results yet. Run a search.</div></div>`;
    state.searchHasMore = false;
    $("countPill").style.display = "none";
    $("moreSearch").style.display = "none";
    return;
  }

  $("searchResults").style.display = "block";
  renderSearchGrouped(items, append);

  state.searchShown += items.length;
  state.searchHasMore = !!j.has_more;
  setSearchPills();
}

async function doMoreSearch() {
  state.searchOffset += state.searchLimit;
  await searchCardsPage(true);
}

/* ---------------------------
   Set view + tabs (hide empty)
---------------------------- */

function secCountFromSummary(sectionName) {
  const sec = (state.setSummary?.sections || []).find(x => x.section === sectionName);
  return sec ? (sec.count || 0) : 0;
}

function countForTab(tabName) {
  if (tabName === "Base") return secCountFromSummary("Base");
  if (tabName === "Inserts") return secCountFromSummary("Insert");
  if (tabName === "Relics") return secCountFromSummary("Relic");
  if (tabName === "Variations") return secCountFromSummary("Variation");
  if (tabName === "Autographs") return secCountFromSummary("Autograph") + secCountFromSummary("Auto Relic");
  if (tabName === "Base Parallels") return state.hasBaseParallels ? 1 : 0;
  return 1;
}

function isTabVisible(tabName) {
  if (tabName === "Base") return true;
  if (tabName === "Base Parallels") return countForTab(tabName) > 0;
  if (tabName === "Inserts" || tabName === "Autographs" || tabName === "Relics" || tabName === "Variations") {
    return countForTab(tabName) > 0;
  }
  return true;
}

function setSetHeader(countOverride) {
  $("setCode").textContent = state.setCode;

  const title = (state.activeTab === "Base") ? "Base Checklist"
              : (state.activeTab === "Base Parallels") ? "Base Parallels"
              : `${state.activeTab}`;

  $("setTitle").textContent = title;

  if (typeof countOverride === "number") {
    $("setMeta").textContent = `${countOverride} Cards`;
    return;
  }

  if (state.activeTab === "Base Parallels") {
    $("setMeta").textContent = state.hasBaseParallels ? "Parallels" : "No parallels";
    return;
  }

  $("setMeta").textContent = `${countForTab(state.activeTab)} Cards`;
}

function renderSetTabs() {
  const el = $("setTabs");
  el.innerHTML = "";

  const visibleTabs = TAB_ORDER.filter(isTabVisible);
  if (!visibleTabs.includes(state.activeTab)) state.activeTab = "Base";

  visibleTabs.forEach(t => {
    const b = document.createElement("button");
    b.className = "tab" + (t === state.activeTab ? " active" : "");
    b.textContent = t;
    b.onclick = async () => {
      state.activeTab = t;
      renderSetTabs();
      $("setBody").innerHTML = `<div class="r"><div class="rTop">Loading…</div></div>`;
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

async function fetchParallelsFor(section, subset) {
  const j = await fetchJson("parallels", {
    sport: state.sport,
    code: state.setCode,
    section,
    subset: subset || ""
  });
  if (!j.ok) return [];
  return j.items || [];
}

async function fetchAllCardsForSection(sectionValue) {
  const all = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const j = await fetchJson("cards", {
      sport: state.sport,
      code: state.setCode,
      section: sectionValue,
      limit,
      offset
    });

    if (!j.ok) break;

    const items = j.items || [];
    all.push(...items);

    const total = j.total || 0;
    offset += limit;
    if (all.length >= total) break;
    if (offset > 30000) break;
  }

  return all;
}

function getTabSections(tabName) {
  if (tabName === "Base Parallels") return ["Base"];
  return TAB_TO_SECTIONS[tabName] || [tabName];
}

function groupBySubset(items) {
  const map = new Map();
  items.forEach(it => {
    const subset = String(it.subset || "[Unspecified]").trim() || "[Unspecified]";
    if (!map.has(subset)) map.set(subset, []);
    map.get(subset).push(it);
  });

  const keys = Array.from(map.keys()).sort((a,b) => a.localeCompare(b));
  return keys.map(k => {
    const arr = map.get(k) || [];
    arr.sort(compareCardsByCardNo);
    return { subset: k, items: arr };
  });
}

function renderSubsetBlock(subsetName, cards, parallels, opts = {}) {
  const count = cards.length;
  const isAutoTab = !!opts.isAutoTab;
  const subsetTitleSize = isAutoTab ? 18 : 16;

  const parallelsHtml = parallels.length
    ? `<div class="parTitle" style="margin-top:10px;">Parallels:</div>
       <ul class="par" style="margin-top:6px;">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle" style="margin-top:10px;">Parallels:</div>
       <ul class="par" style="margin-top:6px;"><li>None listed.</li></ul>`;

  const checklistHtml = (cards || []).map(c => {
    const cardNo = String(c.card_no || "").trim();
    const player = String(c.player || "").trim();
    const team = String(c.team || "").trim();
    const tags = tagsToBadges(c.tags);
    const left = cardNo ? `${escapeHtml(cardNo)} ` : "";
    const mid = player ? escapeHtml(player) : "";
    const right = team ? ` — ${escapeHtml(team)}` : "";
    return `<div class="r"><div class="rTop">${left}${mid}${right}${tags}</div></div>`;
  }).join("");

  return `
    <div class="sectionBlock">
      <div class="subsetTitle" style="font-size:${subsetTitleSize}px; font-weight:950; margin-top:12px;">${escapeHtml(subsetName)}</div>
      <div class="subsetMeta">${count} Cards</div>

      <div style="height:10px;"></div>
      ${parallelsHtml}
      <div style="height:12px;"></div>

      <div class="resultsBox">
        ${checklistHtml || `<div class="r"><div class="rTop">No cards found.</div></div>`}
      </div>
    </div>
  `;
}

/* Base: fetch all -> sort -> client paginate */
function renderBaseChunk(body) {
  const start = state.baseOffset;
  const end = Math.min(start + state.baseLimit, state.baseAll.length);
  const slice = state.baseAll.slice(start, end);

  const listHtml = slice.map(it => {
    const cardNo = escapeHtml(it.card_no || "");
    const player = escapeHtml(it.player || "");
    const team = escapeHtml(it.team || "");
    const tags = tagsToBadges(it.tags);
    return `<div class="r"><div class="rTop">${cardNo} ${player} — ${team}${tags}</div></div>`;
  }).join("");

  const shown = end;
  const total = state.baseAll.length;

  const box = body.querySelector(".resultsBox");
  if (box) {
    if (start === 0) box.innerHTML = listHtml || `<div class="r"><div class="rTop">No cards found.</div></div>`;
    else box.insertAdjacentHTML("beforeend", listHtml);
  }

  const pill = body.querySelector(".btnRow .pill");
  if (pill) pill.textContent = `${shown} / ${total}`;

  const btn = document.getElementById("moreBase");
  if (btn) {
    if (shown >= total) btn.remove();
    else btn.onclick = () => { state.baseOffset += state.baseLimit; renderBaseChunk(body); };
  }
}

async function renderBaseChecklist() {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading Base checklist…</div></div>`;

  state.baseOffset = 0;
  state.baseAll = [];

  const all = await fetchAllCardsForSection("Base");
  all.sort(compareCardsByCardNo);
  state.baseAll = all;

  setSetHeader(state.baseAll.length);

  const parallels = await fetchParallelsFor("Base", "[Base]");
  const parallelsHtml = parallels.length
    ? `<div class="parTitle">Parallels:</div><ul class="par">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle">Parallels:</div><ul class="par"><li>None listed.</li></ul>`;

  body.innerHTML = `
    ${parallelsHtml}
    <div style="height:10px;"></div>
    <div class="resultsBox"></div>
    <div class="btnRow">
      <button id="moreBase" class="btn btnGhost" style="display:${state.baseAll.length > state.baseLimit ? "inline-flex" : "none"}; width:auto; height:auto; padding:10px 14px;">Show more</button>
      <div class="pill">${Math.min(state.baseLimit, state.baseAll.length)} / ${state.baseAll.length}</div>
    </div>
  `;

  renderBaseChunk(body);
}

async function renderBaseParallelsOnly() {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading Base parallels…</div></div>`;

  const parallels = await fetchParallelsFor("Base", "[Base]");
  setSetHeader();

  body.innerHTML = parallels.length
    ? `<div class="parTitle">Parallels:</div><ul class="par">${parallels.map(p => `<li>${escapeHtml(formatParallelLine(p))}</li>`).join("")}</ul>`
    : `<div class="parTitle">Parallels:</div><ul class="par"><li>None listed.</li></ul>`;
}

async function renderRolledUpSection(tabName) {
  const body = $("setBody");
  body.innerHTML = `<div class="r"><div class="rTop">Loading ${escapeHtml(tabName)}…</div></div>`;

  const sections = getTabSections(tabName);

  const allCards = [];
  for (const sec of sections) {
    const items = await fetchAllCardsForSection(sec);
    allCards.push(...items.map(x => ({ ...x, __source_section: sec })));
  }

  setSetHeader(allCards.length);

  if (!allCards.length) {
    body.innerHTML = `<div class="r"><div class="rTop">No cards found.</div></div>`;
    return;
  }

  const allPars = [];
  for (const sec of sections) {
    const pars = await fetchParallelsFor(sec, "");
    allPars.push(...pars.map(p => ({ ...p, __source_section: sec })));
  }

  const grouped = groupBySubset(allCards);

  const parBySubset = new Map();
  allPars.forEach(p => {
    const subset = String(p.applies_to_subset || p.subset || "[Unspecified]").trim() || "[Unspecified]";
    if (!parBySubset.has(subset)) parBySubset.set(subset, []);
    parBySubset.get(subset).push(p);
  });

  const isAutoTab = tabName === "Autographs";

  const html = grouped.map(g => {
    const pars = parBySubset.get(g.subset) || [];
    return renderSubsetBlock(g.subset, g.items, pars, { isAutoTab });
  }).join("");

  body.innerHTML = html;
}

async function renderActiveTab() {
  if (!state.setCode) return;
  if (state.activeTab === "Base") return renderBaseChecklist();
  if (state.activeTab === "Base Parallels") return renderBaseParallelsOnly();
  return renderRolledUpSection(state.activeTab);
}

/* ---------------------------
   Open set
---------------------------- */

async function openSetByCode(code) {
  closeTypeahead();

  state.setCode = code;
  state.activeTab = "Base";
  state.baseAll = [];
  state.baseOffset = 0;

  $("setView").style.display = "block";
  $("searchResults").style.display = "none";
  $("moreSearch").style.display = "none";
  $("countPill").style.display = "none";

  $("setTitle").textContent = "Loading…";
  $("setMeta").textContent = "Loading…";
  $("setCode").textContent = code;
  $("setBody").innerHTML = "";

  const j = await fetchJson("summary", { sport: state.sport, code: state.setCode });
  if (!j.ok) {
    $("setBody").innerHTML = `<div class="r"><div class="rTop">Set load failed</div><div class="rSub">${escapeHtml(j.error || "")}</div></div>`;
    return;
  }

  state.setSummary = j;

  try {
    const bp = await fetchParallelsFor("Base", "[Base]");
    state.hasBaseParallels = (bp && bp.length > 0);
  } catch {
    state.hasBaseParallels = true;
  }

  renderSetTabs();
  await renderActiveTab();
}

/* ---------------------------
   Product detection
---------------------------- */

function looksLikeCode(q) {
  const s = String(q || "").trim();
  return s.includes("_") && s.length >= 8;
}

async function tryOpenSetFromProducts(q) {
  const j = await fetchJson("products", { sport: state.sport, q });
  if (!j.ok) return false;

  const items = j.items || [];
  if (!items.length) return false;

  const qNorm = String(q).trim().toLowerCase();
  const exact = items.find(x => String(x.release_name || x.product || "").trim().toLowerCase() === qNorm);
  const best = exact || items[0];

  const code = String(best.code || "").trim();
  if (!code) return false;

  await openSetByCode(code);
  return true;
}

/* ---------------------------
   Browse modal (loaded checklists)
---------------------------- */

function showBrowseModal() { $("browseModal").style.display = "block"; }
function hideBrowseModal() { $("browseModal").style.display = "none"; }

function renderBrowseItems(items, append) {
  const box = $("browseList");
  if (!append) box.innerHTML = "";

  const html = items.map(p => {
    const title = escapeHtml(p.release_name || p.product || p.code || "Unknown");
    const sub = escapeHtml([p.year, p.manufacturer, p.code].filter(Boolean).join(" • "));
    return `
      <div class="r" style="cursor:pointer;" data-code="${escapeHtml(p.code)}">
        <div class="rTop" style="font-weight:950;">${title}</div>
        <div class="rSub">${sub}</div>
      </div>
    `;
  }).join("");

  if (append) box.insertAdjacentHTML("beforeend", html);
  else box.innerHTML = html;

  box.querySelectorAll(".r[data-code]").forEach(el => {
    el.addEventListener("click", async () => {
      const code = el.getAttribute("data-code");
      if (!code) return;
      hideBrowseModal();
      await openSetByCode(code);
      $("search").value = "";
    });
  });
}

async function loadBrowsePage(append) {
  const q = (state.browse.q || "").trim();

  const j = await fetchJson("products", {
    sport: state.sport,
    q,
    limit: state.browse.limit,
    offset: state.browse.offset
  });

  if (!j.ok) {
    $("browseList").innerHTML = `<div class="r"><div class="rTop">Failed to load</div><div class="rSub">${escapeHtml(j.error || "")}</div></div>`;
    $("browseMore").style.display = "none";
    $("browsePill").style.display = "none";
    return;
  }

  const items = j.items || [];
  if (!append) state.browse.shown = 0;

  renderBrowseItems(items, append);

  state.browse.shown += items.length;
  state.browse.hasMore = !!j.has_more;

  $("browseMore").style.display = state.browse.hasMore ? "inline-flex" : "none";
  $("browsePill").style.display = "inline-flex";
  $("browsePill").textContent = `${state.browse.shown}${j.total ? " / " + j.total : ""}`;
}

async function openBrowse() {
  state.browse.q = "";
  state.browse.offset = 0;
  state.browse.shown = 0;

  $("browseFilter").value = "";
  $("browseList").innerHTML = `<div class="r"><div class="rTop">Loading…</div></div>`;
  $("browseMore").style.display = "none";
  $("browsePill").style.display = "none";

  showBrowseModal();
  await loadBrowsePage(false);
}

function scheduleBrowseFilter() {
  clearTimeout(state.browse.debounce);
  state.browse.debounce = setTimeout(async () => {
    state.browse.q = ($("browseFilter").value || "").trim();
    state.browse.offset = 0;
    await loadBrowsePage(false);
  }, 120);
}

async function browseMore() {
  state.browse.offset += state.browse.limit;
  await loadBrowsePage(true);
}

/* ---------------------------
   Search orchestrator
---------------------------- */

async function doSearch() {
  closeTypeahead();

  state.sport = $("sport").value;
  saveLocal();

  state.q = ($("search").value || "").trim();
  if (!state.q) return;

  await checkHealth();

  state.searchOffset = 0;
  state.searchShown = 0;
  state.searchHasMore = false;
  $("moreSearch").style.display = "none";
  $("countPill").style.display = "none";

  const opened = await tryOpenSetFromProducts(state.q);

  if (!opened && looksLikeCode(state.q)) {
    await openSetByCode(state.q);
    $("search").value = "";
    return;
  }

  if (opened) {
    $("search").value = "";
    return;
  }

  $("setView").style.display = "none";
  $("searchResults").style.display = "block";
  $("searchResults").innerHTML = `<div class="r"><div class="rTop">Searching…</div><div class="rSub">${escapeHtml(state.q)}</div></div>`;

  await searchCardsPage(false);
  $("search").value = "";
}

/* ---------------------------
   Clear button (PRV behavior)
---------------------------- */

function clearUI() {
  closeTypeahead();
  $("search").value = "";

  $("searchResults").style.display = "none";
  $("searchResults").innerHTML = "";

  $("setView").style.display = "none";

  $("moreSearch").style.display = "none";
  $("countPill").style.display = "none";
}

/* ---------------------------
   Wire up
---------------------------- */

function wire() {
  $("go").onclick = doSearch;
  $("moreSearch").onclick = doMoreSearch;

  $("sport").addEventListener("change", () => {
    state.sport = $("sport").value;
    saveLocal();
    closeTypeahead();
  });

  $("search").addEventListener("focus", warmTypeaheadOnce);
  $("search").addEventListener("input", scheduleTypeahead);
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
    if (e.key === "Escape") closeTypeahead();
  });
  $("search").addEventListener("blur", () => setTimeout(closeTypeahead, 120));

  document.addEventListener("click", (e) => {
    const box = $("typeahead");
    const inp = $("search");
    if (!box || !inp) return;
    if (e.target === inp || box.contains(e.target)) return;
    closeTypeahead();
  });

  $("clearBtn").onclick = clearUI;

  $("browse").onclick = openBrowse;
  $("browseClose").onclick = hideBrowseModal;
  $("browseModal").addEventListener("click", (e) => {
    if (e.target && e.target.id === "browseModal") hideBrowseModal();
  });
  $("browseFilter").addEventListener("input", scheduleBrowseFilter);
  $("browseFilter").addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideBrowseModal();
  });
  $("browseMore").onclick = browseMore;

  $("themeToggle").onclick = () => setTheme(state.theme === "dark" ? "light" : "dark");

  // Home button (future navigation)
  $("homeBtn").onclick = () => {
    // For now: clear UI and focus search (acts like "home" inside this tool)
    clearUI();
    setTimeout(() => $("search")?.focus(), 0);
  };
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./sw.js"); } catch {}
}

(async function init() {
  loadTheme();
  loadLocal();
  wire();
  await checkHealth();
  await registerSW();
})();
