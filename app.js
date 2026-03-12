/* =========================================
   Checklist Vault — app.js
   Mirrors Print Run Vault UX
   Adds:
   - Sport picker
   - Instant local product autocomplete
   - Remote SearchIndex enrichment
   - Broader checklist search
========================================= */

// ---------------- CONFIG ----------------
const EXEC_URL = "https://script.google.com/macros/s/AKfycbxiP74l-02E7YkuLUBBSKtt0TSTHQfTbPNUCO4gnc3bCJ6-jBUlefkCRy40Yi8_gxEF/exec";

const INDEX_KEY = "cv_index_v1";
const INDEX_VER_KEY = "cv_index_ver_v1";
const THEME_KEY = "cm_theme";

// ---------------- DOM ----------------
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elThemeBtn = document.getElementById("themeToggle");
const elSport = document.getElementById("sport");
const elBtnSearch = document.getElementById("btnSearch");
const elBtnClear = document.getElementById("btnClear");

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let searchTimer = null;
let activeTypeaheadToken = 0;

// ---------------- THEME ----------------
function setTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);

  const icon = document.getElementById("themeIcon");
  if (!icon) return;

  if (t === "dark") {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
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
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") setTheme(saved);
  else setTheme("dark");
}

if (elThemeBtn) {
  elThemeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  });
}

// ---------------- HELPERS ----------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

function norm(s) {
  return String(s ?? "").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function fmtType(type) {
  const t = lower(type);
  if (!t) return "Result";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function getSportValue() {
  return elSport ? elSport.value : "";
}

function debounce(fn, wait = 80) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fn, wait);
}

function setLoadingState(isLoading) {
  if (elBtnSearch) {
    elBtnSearch.disabled = !!isLoading;
    elBtnSearch.textContent = isLoading ? "Loading..." : "Search";
  }
}

function sortByDisplayPriority(items) {
  const typeRank = {
    product: 1,
    player: 2,
    team: 3,
    subset: 4,
    section: 5,
    tag: 6
  };

  return items.slice().sort((a, b) => {
    const aRank = typeRank[lower(a.type)] || 99;
    const bRank = typeRank[lower(b.type)] || 99;
    if (aRank !== bRank) return aRank - bRank;

    const aYear = Number(a.year) || 0;
    const bYear = Number(b.year) || 0;
    if (bYear !== aYear) return bYear - aYear;

    return String(a.term || a.displayName || "").localeCompare(String(b.term || b.displayName || ""));
  });
}

// ---------------- API ----------------
async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });

  const data = await res.json();

  if (!data || data.ok === false) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

// ---------------- INDEX CACHE ----------------
function loadCachedIndex_() {
  const cached = localStorage.getItem(INDEX_KEY);
  if (!cached) return [];
  try {
    return JSON.parse(cached) || [];
  } catch (e) {
    return [];
  }
}

function storeIndex_(indexArr, versionStr) {
  INDEX = Array.isArray(indexArr) ? indexArr : [];
  localStorage.setItem(INDEX_KEY, JSON.stringify(INDEX));
  if (versionStr) localStorage.setItem(INDEX_VER_KEY, String(versionStr));
}

async function ensureFreshIndex_() {
  INDEX = loadCachedIndex_();
  const forceRefresh = new URLSearchParams(location.search).get("refresh") === "1";

  try {
    const meta = await api("meta");
    const remoteVer = meta && meta.ok ? String(meta.indexVersion || "") : "";
    const localVer = localStorage.getItem(INDEX_VER_KEY) || "";

    if (forceRefresh || !INDEX.length || (remoteVer && remoteVer !== localVer)) {
      const d = await api("index");
      const fresh = (d && d.ok && Array.isArray(d.index)) ? d.index : [];
      storeIndex_(fresh, remoteVer || localVer);
    }
  } catch (e) {
    console.warn("Index freshness check failed, using cache.", e);
  }
}

// ---------------- INIT ----------------
(async function init() {
  loadTheme();
  await ensureFreshIndex_();
  console.log("INDEX loaded:", INDEX.length, INDEX.slice(0, 5));
})();

// ---------------- DROPDOWN ----------------
function openDropdown(html) {
  elDD.innerHTML = html;
  elDD.style.display = "block";
}

function closeDropdown() {
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

function dropdownItemHtml(item) {
  const typeLabel = fmtType(item.type || "product");

  return `
    <div class="ddItem"
         data-code="${esc(item.code || "")}"
         data-sport="${esc(item.sport || "")}"
         data-type="${esc(item.type || "product")}"
         data-term="${esc(item.term || item.displayName || "")}">
      <div class="ddTitle">${esc(item.term || item.displayName || "")}</div>
      <div class="ddMeta">
        ${esc(typeLabel)}
        ${item.sport ? ` • ${esc(item.sport)}` : ""}
        ${item.displayName && lower(item.term) !== lower(item.displayName) ? ` • ${esc(item.displayName)}` : ""}
      </div>
    </div>
  `;
}

function bindDropdownItems(items) {
  [...elDD.children].forEach((node, idx) => {
    node.onclick = async () => {
      const item = items[idx];
      if (!item) return;

      selected = item;
      elQ.value = item.term || item.displayName || "";
      closeDropdown();

      if (lower(item.type) === "product" && item.code) {
        logSelectionFireAndForget_({
          DisplayName: item.displayName || item.term || "",
          year: item.year || "",
          sport: item.sport || ""
        });

        await runProductSearch(item.code, item.sport);
      } else {
        await runBroadSearch(item.term || elQ.value, item.sport || getSportValue());
      }
    };
  });
}

function renderDropdownItems(items) {
  if (!items || !items.length) {
    closeDropdown();
    return;
  }

  const sorted = sortByDisplayPriority(items);
  openDropdown(sorted.map(dropdownItemHtml).join(""));
  bindDropdownItems(sorted);
}

// ---------------- LOGGING ----------------
function logSelectionFireAndForget_(sel) {
  if (!sel) return;

  api("logSearch", {
    selectedName: sel.DisplayName || "",
    year: sel.year || "",
    sport: sel.sport || ""
  }).catch(() => {});
}

// ---------------- LOCAL TYPEAHEAD ----------------
function dedupeTypeaheadResults(rows) {
  const seen = {};
  const out = [];

  rows.forEach(r => {
    const key = [
      lower(r.type),
      lower(r.sport),
      lower(r.code),
      lower(r.term)
    ].join("||");

    if (seen[key]) return;
    seen[key] = true;
    out.push(r);
  });

  return out;
}

function makeProductHitsFromLocalIndex(q, sport, limit = 8) {
  const needle = lower(q);

  let rows = INDEX.slice();

  if (sport) {
    rows = rows.filter(r => lower(r.sport) === lower(sport));
  }

  const exact = [];
  const starts = [];
  const contains = [];

  rows.forEach(r => {
    const displayName = lower(r.DisplayName);
    const keywords = lower(r.Keywords);
    const code = lower(r.Code);
    const hay = `${displayName} | ${keywords} | ${code}`;

    if (!hay.includes(needle)) return;

    const out = {
      term: r.DisplayName,
      type: "product",
      sport: r.sport,
      code: r.Code,
      displayName: r.DisplayName,
      year: r.year,
      manufacturer: r.manufacturer,
      product: r.product
    };

    if (displayName === needle || code === needle) exact.push(out);
    else if (displayName.indexOf(needle) === 0 || keywords.indexOf(needle) === 0 || code.indexOf(needle) === 0) starts.push(out);
    else contains.push(out);
  });

  return dedupeTypeaheadResults(exact.concat(starts, contains)).slice(0, limit);
}

function mergeTypeaheadResults(localHits, remoteHits, limit = 10) {
  return dedupeTypeaheadResults([...(localHits || []), ...(remoteHits || [])]).slice(0, limit);
}

// ---------------- FAST AUTOCOMPLETE ----------------
async function runTypeahead() {
  const token = ++activeTypeaheadToken;
  const q = norm(elQ.value);
  const sport = getSportValue();
  selected = null;

  if (q.length < 2) {
    closeDropdown();
    return;
  }

  // 1) Instant local product suggestions
  const localHits = makeProductHitsFromLocalIndex(q, sport, 8);
  renderDropdownItems(localHits);

  // 2) Optional async enrichment from SearchIndex
  try {
    const data = await api("searchIndex", {
      q,
      sport,
      limit: 10
    });

    if (token !== activeTypeaheadToken) return;

    const remoteHits = Array.isArray(data.results) ? data.results : [];
    const merged = mergeTypeaheadResults(localHits, remoteHits, 10);

    renderDropdownItems(merged);
  } catch (e) {
    console.warn("Remote SearchIndex typeahead failed; local suggestions still shown.", e);
  }
}

elQ.addEventListener("input", () => {
  debounce(() => {
    runTypeahead();
  }, 80);
});

document.addEventListener("click", (e) => {
  const inSearch = e.target.closest(".searchWrap") || e.target.closest("#dropdown");
  if (!inSearch) closeDropdown();
});

elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    closeDropdown();
    runSearch();
  }
});

// ---------------- BUTTONS ----------------
if (elBtnSearch) {
  elBtnSearch.onclick = runSearch;
}

if (elBtnClear) {
  elBtnClear.onclick = () => {
    elQ.value = "";
    selected = null;
    closeDropdown();
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No results yet. Run a search.</div>`;
  };
}

if (elSport) {
  elSport.addEventListener("change", () => {
    selected = null;
    closeDropdown();
    if (norm(elQ.value).length >= 2) {
      runTypeahead();
    }
  });
}

// ---------------- SEARCH ROUTER ----------------
async function runSearch() {
  const q = norm(elQ.value);
  const sport = getSportValue();

  if (!q) return;

  if (selected && lower(selected.type) === "product" && selected.code) {
    await runProductSearch(selected.code, selected.sport || sport);
    return;
  }

  const localMatch = INDEX.find(i => {
    const sameSport = !sport || lower(i.sport) === lower(sport);
    if (!sameSport) return false;

    const hay = `${i.DisplayName} ${i.Keywords} ${i.Code}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  if (localMatch) {
    selected = {
      type: "product",
      code: localMatch.Code,
      sport: localMatch.sport,
      displayName: localMatch.DisplayName,
      term: localMatch.DisplayName,
      year: localMatch.year
    };

    logSelectionFireAndForget_({
      DisplayName: localMatch.DisplayName || "",
      year: localMatch.year || "",
      sport: localMatch.sport || ""
    });

    await runProductSearch(localMatch.Code, localMatch.sport);
    return;
  }

  await runBroadSearch(q, sport);
}

// ---------------- PRODUCT SEARCH ----------------
async function runProductSearch(code, sport) {
  setLoadingState(true);
  elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;

  try {
    const data = await api("getRowsByCode", { code, sport });
    renderProductResults(data.meta, data.rows || []);
  } catch (e) {
    console.error(e);
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading checklist data.</div>`;
  } finally {
    setLoadingState(false);
  }
}

// ---------------- BROADER SEARCH ----------------
async function runBroadSearch(q, sport) {
  setLoadingState(true);
  elResults.innerHTML = `<div class="card" style="opacity:.8;">Searching…</div>`;

  try {
    const data = await api("searchCards", {
      q,
      sport,
      limit: 50
    });

    renderBroadResults(q, data.results || [], sport);
  } catch (e) {
    console.error(e);
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading search results.</div>`;
  } finally {
    setLoadingState(false);
  }
}

// ---------------- RENDER PRODUCT ----------------
function renderProductResults(meta, rows) {
  if (!rows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No checklist rows found.</div>`;
    return;
  }

  const title = esc(meta?.displayName || "Checklist Results");
  const subParts = [
    meta?.year,
    meta?.sport,
    meta?.manufacturer
  ].filter(Boolean).map(esc);

  const sub = subParts.join(" • ");

  elResults.innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:6px;">${title}</div>
      <div style="opacity:.75;font-size:13px;margin-bottom:10px;">${sub}</div>

      <table>
        <thead>
          <tr>
            <th>Section</th>
            <th>Subset</th>
            <th>Card No</th>
            <th>Player</th>
            <th>Team</th>
            <th>Tag</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.section || "")}</td>
              <td>${esc(r.subset || "")}</td>
              <td>${esc(r.card_no || "")}</td>
              <td>${esc(r.player || "")}</td>
              <td>${esc(r.team || "")}</td>
              <td>${esc(r.tag || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------- RENDER BROADER SEARCH ----------------
function renderBroadResults(q, rows, sport) {
  if (!rows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No results found for "${esc(q)}".</div>`;
    return;
  }

  const titleBits = ["Search Results"];
  if (sport) titleBits.push(esc(sport));

  elResults.innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:6px;">${titleBits.join(" • ")}</div>
      <div style="opacity:.75;font-size:13px;margin-bottom:10px;">Query: ${esc(q)}</div>

      <table>
        <thead>
          <tr>
            <th>Sport</th>
            <th>Product</th>
            <th>Section</th>
            <th>Subset</th>
            <th>Card No</th>
            <th>Player</th>
            <th>Team</th>
            <th>Tag</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.sport || "")}</td>
              <td>${esc(r.displayName || "")}</td>
              <td>${esc(r.section || "")}</td>
              <td>${esc(r.subset || "")}</td>
              <td>${esc(r.card_no || "")}</td>
              <td>${esc(r.player || "")}</td>
              <td>${esc(r.team || "")}</td>
              <td>${esc(r.tag || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
