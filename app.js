const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbz25GxN79WE7PFzb1vT0bsXZBuMp11Qs2vvhJAnH3r3qOrYzYNwp_14n420ml4Bu5t_/exec";

const state = {
  apiBase: "",
  sport: "baseball",
  q: "",
  offset: 0,
  limit: 25,
  hasMore: false,
  totalShown: 0
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

function showResultsBox(on) {
  const box = $("searchResults");
  box.style.display = on ? "block" : "none";
  if (!on) box.innerHTML = "";
}

function setCountPill() {
  const pill = $("countPill");
  pill.style.display = "inline-flex";
  pill.textContent = `${state.totalShown} results`;
}

function setMoreButton() {
  const btn = $("more");
  btn.style.display = state.hasMore ? "inline-flex" : "none";
}

function renderRows(rows, append) {
  const box = $("searchResults");
  if (!append) box.innerHTML = "";

  // Build one HTML string (fast)
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

async function searchPage(append) {
  // API call: search_cards (global)
  const j = await fetchJson("search_cards", {
    sport: state.sport,
    q: state.q,
    limit: state.limit,
    offset: state.offset
  });

  if (!j.ok) {
    showResultsBox(true);
    $("searchResults").innerHTML = `<div class="r"><div class="rTop">Search failed</div><div class="rSub">${escapeHtml(j.error || "Unknown error")}</div></div>`;
    state.hasMore = false;
    setMoreButton();
    return;
  }

  const items = j.items || [];

  if (!append) state.totalShown = 0;

  if (!items.length && !append) {
    showResultsBox(true);
    $("searchResults").innerHTML = `<div class="r"><div class="rTop">No results</div><div class="rSub">Try a player name (Judge) or a product code (2026_topps_series1).</div></div>`;
    state.hasMore = false;
    setMoreButton();
    $("countPill").style.display = "none";
    return;
  }

  showResultsBox(true);
  renderRows(items, append);

  state.totalShown += items.length;
  state.hasMore = !!j.has_more;

  setCountPill();
  setMoreButton();
}

async function doSearch() {
  // Reset paging
  state.sport = $("sport").value;
  state.apiBase = normalizeApiBase($("apiBase").value);
  saveLocal();

  state.q = $("search").value.trim();
  state.offset = 0;

  if (!state.apiBase || !state.q) return;

  await checkHealth();

  // Show a quick loading state
  showResultsBox(true);
  $("searchResults").innerHTML = `<div class="r"><div class="rTop">Searching…</div><div class="rSub">${escapeHtml(state.q)}</div></div>`;
  $("countPill").style.display = "none";
  $("more").style.display = "none";

  await searchPage(false);
}

async function doMore() {
  state.offset += state.limit;
  await searchPage(true);
}

function wire() {
  $("apiBase").addEventListener("change", async () => {
    state.apiBase = normalizeApiBase($("apiBase").value);
    saveLocal();
    await checkHealth();
  });

  $("go").onclick = doSearch;
  $("more").onclick = doMore;

  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
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
