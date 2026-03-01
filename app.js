/* Checklist Viewer (Beta) */

const DEFAULT_API_BASE =
  "https://script.google.com/macros/s/AKfycbyZbd_9POsLRLA4jydnDrSTibj7L_BE2zmS9ia0eCSG76LFLojXd8ZBp9E5Y-5DmvJm/exec";

const state = {
  apiBase: "",
  sport: "baseball",
  code: "",
  summary: null,

  section: "",
  subset: "",
  player: "",
  tag: "",

  limit: 100,
  offset: 0,
  total: 0,
};

function $(id) {
  return document.getElementById(id);
}

function setDebug(msg) {
  $("debugBox").textContent = msg;
}

function setApiStatus(ok, text) {
  const el = $("apiStatus");
  el.textContent = text;
  el.style.borderColor = ok ? "#10b981" : "#ef4444";
}

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
  const base = state.apiBase;
  const url = `${base}?${qs({ route, ...params })}`;
  setDebug(`GET ${url}`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function tagsToBadges(tagsCell) {
  const t = String(tagsCell || "").trim();
  if (!t) return [];
  return t
    .split("|")
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
}

function renderBadges(tagsCell) {
  const tags = tagsToBadges(tagsCell);
  if (!tags.length) return "";
  return tags.map(t => `<span class="badge">${t}</span>`).join("");
}

function formatCardLine(item) {
  const cardNo = String(item.card_no ?? "").trim();
  const player = String(item.player ?? "").trim();
  const team = String(item.team ?? "").trim();
  const subset = String(item.subset ?? "").trim();
  const notes = String(item.notes ?? "").trim();

  const line1 = `${escapeHtml(cardNo)} ${escapeHtml(player)} — ${escapeHtml(team)}${renderBadges(item.tags)}`;
  const line2 = [subset, notes].filter(Boolean).map(escapeHtml).join(" • ");

  return { line1, line2 };
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- UI Wiring ---------- */

function loadLocalDefaults() {
  const savedBase = localStorage.getItem("cm_api_base");
  $("apiBase").value = savedBase || DEFAULT_API_BASE;
  state.apiBase = normalizeApiBase($("apiBase").value);

  const savedSport = localStorage.getItem("cm_sport");
  if (savedSport) $("sport").value = savedSport;

  const savedCode = localStorage.getItem("cm_code");
  if (savedCode) $("code").value = savedCode;
}

async function checkHealth() {
  try {
    const apiBase = normalizeApiBase($("apiBase").value);
    state.apiBase = apiBase;
    localStorage.setItem("cm_api_base", apiBase);

    const j = await fetchJson("health", {});
    if (j && j.ok) {
      setApiStatus(true, "API: OK");
      return true;
    }
    setApiStatus(false, "API: error");
    return false;
  } catch (e) {
    setApiStatus(false, "API: offline");
    setDebug(String(e));
    return false;
  }
}

function renderSectionTabs() {
  const tabsEl = $("sectionTabs");
  tabsEl.innerHTML = "";

  const sections = state.summary?.sections || [];
  if (!sections.length) return;

  sections.forEach(s => {
    const btn = document.createElement("button");
    btn.className = "tab" + (s.section === state.section ? " active" : "");
    btn.textContent = `${s.section} (${s.count})`;
    btn.onclick = async () => {
      state.section = s.section;
      state.offset = 0;
      renderSectionTabs();
      renderSubsetDropdown();
      await refreshParallels();
      await refreshCards();
    };
    tabsEl.appendChild(btn);
  });
}

function renderSubsetDropdown() {
  const sel = $("subsetSelect");
  sel.innerHTML = "";

  const sectionObj = (state.summary?.sections || []).find(x => x.section === state.section);
  const subsets = sectionObj?.subsets || [];

  // Always include an "All subsets" option
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "(All subsets)";
  sel.appendChild(optAll);

  subsets.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.subset;
    opt.textContent = `${s.subset} (${s.count})`;
    sel.appendChild(opt);
  });

  sel.value = state.subset || "";
  sel.onchange = async () => {
    state.subset = sel.value;
    state.offset = 0;
    await refreshParallels();
    await refreshCards();
  };
}

function setHeaderCounts() {
  const sectionObj = (state.summary?.sections || []).find(x => x.section === state.section);
  const sectionCount = sectionObj?.count || 0;

  $("title").textContent = `${state.section || "Checklist"} Checklist`;
  $("subtitle").textContent = state.code ? `${state.code} • ${state.sport}` : "Enter a code and click Load.";
  $("countPill").textContent = `${sectionCount} cards`;
}

function renderParallels(items) {
  const ul = $("parallelList");
  ul.innerHTML = "";

  if (!items || !items.length) {
    $("parSub").textContent = "No parallels found for the current selection.";
    return;
  }

  $("parSub").textContent = "Parallels for the current section/subset:";

  items.forEach(p => {
    const li = document.createElement("li");
    const name = String(p.parallel_name || "").trim();
    const sn = String(p.serial_no || "").trim();
    li.textContent = sn ? `${name} ${sn}` : name;
    ul.appendChild(li);
  });
}

function renderCards(items) {
  const ul = $("cardList");
  ul.innerHTML = "";

  if (!items || !items.length) {
    $("emptyState").style.display = "block";
    return;
  }
  $("emptyState").style.display = "none";

  items.forEach(it => {
    const { line1, line2 } = formatCardLine(it);

    const li = document.createElement("li");
    li.innerHTML = `
      <div class="left">
        <div class="line1">${line1}</div>
        ${line2 ? `<div class="line2">${line2}</div>` : ""}
      </div>
      <div class="right">${escapeHtml(String(it.section || ""))}</div>
    `;
    ul.appendChild(li);
  });
}

function setPaginationMeta() {
  const page = Math.floor(state.offset / state.limit) + 1;
  const totalPages = Math.max(1, Math.ceil((state.total || 0) / state.limit));

  $("pageMeta").textContent = `Page ${page} of ${totalPages}`;
  $("resultsMeta").textContent = `Results: ${state.total}`;

  $("prevBtn").disabled = state.offset <= 0;
  $("nextBtn").disabled = state.offset + state.limit >= (state.total || 0);
}

async function refreshParallels() {
  try {
    const j = await fetchJson("parallels", {
      sport: state.sport,
      code: state.code,
      section: state.section,
      subset: state.subset || "" // blank allowed
    });

    if (!j.ok) throw new Error(j.error || "parallels error");
    renderParallels(j.items || []);
  } catch (e) {
    renderParallels([]);
    setDebug("Parallels error: " + String(e));
  }
}

async function refreshCards() {
  try {
    const j = await fetchJson("cards", {
      sport: state.sport,
      code: state.code,
      section: state.section,
      subset: state.subset || "",
      player: state.player || "",
      tag: state.tag || "",
      limit: state.limit,
      offset: state.offset
    });

    if (!j.ok) throw new Error(j.error || "cards error");

    state.total = j.total || 0;
    renderCards(j.items || []);
    setPaginationMeta();
  } catch (e) {
    state.total = 0;
    renderCards([]);
    setPaginationMeta();
    setDebug("Cards error: " + String(e));
  }
}

async function loadProduct() {
  state.sport = $("sport").value;
  state.code = $("code").value.trim();
  state.apiBase = normalizeApiBase($("apiBase").value);

  localStorage.setItem("cm_sport", state.sport);
  localStorage.setItem("cm_code", state.code);
  localStorage.setItem("cm_api_base", state.apiBase);

  if (!state.code) {
    setDebug("Enter a product code.");
    return;
  }

  const ok = await checkHealth();
  if (!ok) return;

  try {
    const j = await fetchJson("summary", { sport: state.sport, code: state.code });
    if (!j.ok) throw new Error(j.error || "summary error");

    state.summary = j;

    // Default section = first ordered section
    const firstSection = j.sections?.[0]?.section || "Base";
    state.section = firstSection;
    state.subset = "";
    state.player = "";
    state.tag = "";
    state.offset = 0;

    $("playerSearch").value = "";
    $("tagFilter").value = "";

    renderSectionTabs();
    renderSubsetDropdown();
    setHeaderCounts();

    await refreshParallels();
    await refreshCards();
  } catch (e) {
    setDebug("Summary error: " + String(e));
    state.summary = null;
    $("title").textContent = "Load failed";
    $("subtitle").textContent = "Check the code and try again.";
    $("countPill").textContent = "0 cards";
    $("sectionTabs").innerHTML = "";
    $("subsetSelect").innerHTML = "";
    renderParallels([]);
    renderCards([]);
  }
}

function wireEvents() {
  $("loadBtn").onclick = loadProduct;

  $("apiBase").addEventListener("change", checkHealth);

  $("applyFiltersBtn").onclick = async () => {
    state.player = $("playerSearch").value.trim();
    state.tag = $("tagFilter").value.trim();
    state.offset = 0;
    await refreshCards();
  };

  $("prevBtn").onclick = async () => {
    state.offset = Math.max(0, state.offset - state.limit);
    await refreshCards();
  };

  $("nextBtn").onclick = async () => {
    state.offset = state.offset + state.limit;
    await refreshCards();
  };
}

/* ---------- PWA ---------- */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    // non-fatal
  }
}

(async function init() {
  loadLocalDefaults();
  wireEvents();
  await checkHealth();
  await registerSW();
})();
