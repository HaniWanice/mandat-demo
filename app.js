"use strict";

const KEY_STORE = "mandat.key";
const TRACK_STORE = "mandat.suivi";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const SHORT = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const STATUSES = [["appeler", "À appeler"], ["appele", "Appelé"], ["rappeler", "À rappeler"], ["devis", "Devis envoyé"], ["client", "Client"], ["ecarte", "Écarté"]];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const SIZE_ORDER = ["10-19", "20-49", "50-99", "100-199", "200-249", "250-499", "500-999", "1000-1999", "2000-4999", "5000-9999", "10000+"];
const WINDOW = 4; // months ahead that count as "call now"
const SECTOR_COLOR = {
  "Santé et médico-social": "#E5484D", "Industrie": "#3E63DD", "Transport et logistique": "#0090FF", "Commerce": "#E54666",
  "Enseignement et formation": "#8E4EC6", "Construction": "#F76B15", "Hôtellerie et restauration": "#D6409F",
  "Associations et organisations": "#12A594", "Administration": "#6E56CF", "Banque et assurance": "#30A46C",
  "Information et communication": "#0D74CE", "Services aux entreprises": "#AB4ABA", "Conseil et ingénierie": "#5B5BD6",
  "Énergie, eau, déchets": "#29A383",
};
const CT = "https://code.travail.gouv.fr/code-du-travail/";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fmt = (n) => Number(n).toLocaleString("fr-FR");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const today = new Date();

let D = null;
let ROWS = [];
let BY_SIRET = {};
let track = JSON.parse(localStorage.getItem(TRACK_STORE) || "{}");
const state = { q: "", mois: "", secteur: "", taille: "", statut: "", sort: "mois" };
let currentView = "";

/* ---------- Unlock ---------- */

async function deriveKey(pw) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function decrypt(key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(ENC.iv) }, key, b64(ENC.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function tryStoredKey() {
  const raw = localStorage.getItem(KEY_STORE);
  if (!raw) return null;
  try {
    return await decrypt(await crypto.subtle.importKey("raw", b64(raw), "AES-GCM", true, ["decrypt"]));
  } catch {
    localStorage.removeItem(KEY_STORE); // data re-encrypted with another code: ask again
    return null;
  }
}

async function unlock(e) {
  e.preventDefault();
  const go = $("#lockBtn"), card = $(".lock-card");
  go.classList.add("busy");
  $("#lockErr").classList.remove("on");
  try {
    const key = await deriveKey($("#pw").value.trim());
    const data = await decrypt(key);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    localStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...raw)));
    $("#lock").classList.add("leave");
    start(data);
    setTimeout(() => { $("#lock").hidden = true; }, 1300);
  } catch {
    go.classList.remove("busy");
    $("#lockErr").classList.add("on");
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    $("#pw").select();
  }
}

/* ---------- Helpers ---------- */

const monthLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const monthsUntil = (m) => (+m.slice(0, 4) - today.getFullYear()) * 12 + (+m.slice(5) - 1 - today.getMonth());
const isSoon = (m) => monthsUntil(m) <= WINDOW;
const untilLabel = (m) => { const n = monthsUntil(m); return n < 0 ? "passé" : n === 0 ? "ce mois-ci" : `dans ${n} mois`; };
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const cityCase = (s) => s.toLowerCase().replace(/(^|[\s-'])\S/g, (c) => c.toUpperCase());
const fmtTel = (t) => (t || "").replace(/(\d{2})(?=\d)/g, "$1 ");
const telHref = (t) => "tel:+33" + t.slice(1);
const siteUrl = (s) => (/^https?:/.test(s) ? s : "https://" + s);
const statusOf = (r) => track[r.siret]?.s || "appeler";
const noteOf = (r) => track[r.siret]?.n || "";
const big = (r) => SIZE_ORDER.indexOf(r.effectif) >= SIZE_ORDER.indexOf("50-99");
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const initials = (name) => name.replace(/\(.*?\)/g, "").replace(/^(ASS|ASSOCIATION|SAS|SA|STE|SOCIETE|STE|ETS|FONDATION|OGEC)\s+/i, "").split(/[\s'-]+/).filter((w) => w.length > 1 && !/^(DE|DU|DES|LA|LE|LES|ET|D|L|AU)$/i.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || name[0];
const av = (r, cls = "mono-av") => `<span class="${cls}" style="--c:${SECTOR_COLOR[r.secteur] || "#6E6E78"}" aria-hidden="true">${esc(initials(r.entreprise))}</span>`;
const plural = (n, s, p = s + "s") => (n > 1 ? p : s);

function save(siret, patch) {
  track[siret] = { ...track[siret], ...patch };
  localStorage.setItem(TRACK_STORE, JSON.stringify(track));
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<i><svg class="ic"><use href="#i-check"/></svg></i>${esc(msg)}`;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 500); }, 2800);
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Copie impossible sur ce navigateur"); }
}

// Numbers count up once when they first appear: the eye reads the scale, not just the digits.
function countUp(root = document) {
  $$("[data-count]", root).forEach((el) => {
    const end = +el.dataset.count;
    el.removeAttribute("data-count");
    if (reduced || end < 10) { el.textContent = fmt(end); return; }
    const t0 = performance.now(), dur = 2200;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(Math.round(end * (1 - Math.pow(2, -10 * p))));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(end);
    };
    const begin = () => ($("#main").classList.contains("held") ? setTimeout(begin, 60) : requestAnimationFrame(tick));
    begin();
  });
}

function burst(x, y) {
  if (reduced) return;
  const colors = ["#5B4BFF", "#FF4D94", "#0EA66E", "#FFB020", "#2EB5FF"];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement("i");
    const a = (Math.PI * 2 * i) / 26 + Math.random() * .3, d = 80 + Math.random() * 120;
    p.className = "burst";
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % 5]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.random() * 540}deg`;
    document.body.append(p);
    setTimeout(() => p.remove(), 1000);
  }
}

/* ---------- Start, routing, shell ---------- */

function start(data) {
  D = data;
  ROWS = data.rows;
  BY_SIRET = Object.fromEntries(ROWS.map((r) => [r.siret, r]));
  $("#app").hidden = false;
  route();
}

const VIEWS = { accueil: viewHome, prospects: viewProspects, calendrier: viewCalendar, assistant: viewAssistant, methode: viewMethod };

function route() {
  const [name, query] = location.hash.replace(/^#\/?/, "").split("?");
  const v = VIEWS[name] ? name : "accueil";
  if (query) new URLSearchParams(query).forEach((val, k) => { if (k in state) state[k] = val; });
  const first = !currentView;
  const swap = () => {
    $$("#tabs a").forEach((a) => (a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    VIEWS[v]();
    moveTabInd();
    if (currentView !== v) window.scrollTo({ top: 0 });
    currentView = v;
  };
  if (currentView === v) return swap();
  currentView = v;
  curtain(first ? "Mandat" : TITLES[v], first ? "Élections CSE 2027" : "", swap, first);
}

const TITLES = { accueil: "Accueil", prospects: "Prospects", calendrier: "Calendrier 2027", assistant: "Assistant", methode: "Méthode" };
let curtainRun = Promise.resolve();

// One full-screen sweep per page change: the curtain rises, names the page, swaps it underneath, then lifts away.
function curtain(title, sub, swap, intro) {
  if (reduced) { swap(); return; }
  curtainRun = curtainRun.then(async () => {
    const c = $("#curtain"), kids = $$(".c-in > *", c);
    $("#curtainTitle").textContent = title;
    $("#curtainSub").textContent = sub;
    c.hidden = false;
    const ease = "cubic-bezier(.76,0,.24,1)";
    const instant = intro && $("#lock").hidden; // reload with a remembered code: start fully covered
    await c.animate([{ clipPath: "inset(100% 0 0 0 round 40px)" }, { clipPath: "inset(0 0 0 0 round 0px)" }], { duration: instant ? 10 : 750, easing: ease, fill: "forwards" }).finished;
    kids.forEach((k, i) => k.animate([{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "none" }], { duration: 700, delay: i * 110, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }));
    await new Promise((r) => setTimeout(r, intro ? 1300 : 650));
    $("#main").classList.add("held");
    swap();
    kids.forEach((k, i) => k.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-24px)" }], { duration: 450, delay: i * 60, easing: "cubic-bezier(.7,0,.84,0)", fill: "forwards" }));
    await new Promise((r) => setTimeout(r, 350));
    $("#main").classList.remove("held");
    await c.animate([{ clipPath: "inset(0 0 0 0 round 0px)" }, { clipPath: "inset(0 0 100% 0 round 40px)" }], { duration: 850, easing: ease, fill: "forwards" }).finished;
    c.hidden = true;
  });
}

function moveTabInd() {
  const a = $("#tabs a[aria-current]"), ind = $("#tabInd");
  if (!a) return;
  ind.style.left = a.offsetLeft + "px";
  ind.style.width = a.offsetWidth + "px";
}

function moveSegInd(seg) {
  const on = $("button[aria-pressed='true']", seg), ind = $(".seg-ind", seg);
  if (on && ind) { ind.style.left = on.offsetLeft + "px"; ind.style.width = on.offsetWidth + "px"; }
}

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

/* ---------- Home ---------- */

function yearChart(months, { nav = true } = {}) {
  const map = Object.fromEntries(months);
  const all = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`);
  const max = Math.max(1, ...all.map((m) => map[m] || 0));
  const inWin = all.map((m, i) => [i, monthsUntil(m)]).filter(([, n]) => n >= 0 && n <= WINDOW).map(([i]) => i);
  const win = inWin.length ? `<div class="win" style="left:calc(${inWin[0]} * (100% + var(--g)) / 12);width:calc(${inWin.length} * (100% + var(--g)) / 12 - var(--g))"><span>À appeler maintenant</span></div>` : "";
  return `<div class="year">${win}${all.map((m, i) => {
    const n = map[m] || 0;
    const cls = inWin.includes(i) ? "hot" : m <= "2027-06" ? "s1" : "";
    const label = n >= 1000 ? (n / 1000).toFixed(1).replace(".", ",") + " k" : n;
    return `<button class="mcol ${cls}" type="button" data-month="${nav ? m : ""}" style="--i:${i};--h:${n / max}"
      data-tip="${fmt(n)} ${plural(n, "établissement")} avec élus ${n > 1 ? "devraient" : "devrait"} revoter en ${monthLabel(m)}, ${untilLabel(m)}.${nav ? " Cliquez pour voir ce mois." : ""}">
      <span class="n">${label}</span><span class="bar"></span><span class="m"><span class="full">${SHORT[i]}</span><span class="ab">${SHORT[i][0]}</span></span></button>`;
  }).join("")}</div>`;
}

function viewHome() {
  const st = D.stats;
  const withElus = st.total - st.sans;
  const ara = (st.regions.find(([r]) => r === D.region) || [0, 0])[1];
  const due = ROWS.filter((r) => isSoon(r.mois));
  const queue = sessionQueue();
  const day = today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const funnel = [
    ["Élection estimée en 2027", st.total],
    ["Avec des élus en place", withElus],
    ["Au 1er semestre", st.s1_elus],
    [`En ${D.region}`, ara],
    ["Dans votre liste", ROWS.length],
  ];
  const regMax = st.regions[0][1];
  const first = [...ROWS].filter((r) => !["ecarte", "client"].includes(statusOf(r))).sort((a, b) => a.mois.localeCompare(b.mois) || b.inscrits - a.inscrits).slice(0, 6);
  $("#main").innerHTML = `<div class="view">
    <section class="hero">
      <div class="mesh" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hero-in stag">
        <span class="date" style="--i:0"><i></i>${capital(day)}</span>
        <h1 style="--i:1"><span class="hl" data-count="${due.length}">${due.length}</span> CSE votent dans les ${WINDOW} prochains mois.</h1>
        <div class="typer" style="--i:2" data-tip="Les prochains établissements à appeler, tirés de votre liste."><b>À appeler</b><span id="typed"></span></div>
        <p style="--i:3">Sur vos ${ROWS.length} établissements en ${esc(D.region)}. Le vote se prépare un à trois mois avant : c'est le moment d'appeler, avant les autres organismes.</p>
        <div class="acts" style="--i:4">
          <button class="btn primary lg" type="button" data-session ${queue.length ? "" : "disabled"}><svg class="ic"><use href="#i-phone"/></svg>Lancer la session d'appels<kbd style="background:rgba(255,255,255,.14);color:#fff">${queue.length}</kbd></button>
          <a class="btn lg" href="#/prospects">Voir les prospects</a>
        </div>
      </div>
    </section>
    <div class="stats stag">
      <div class="stat" style="--i:1" data-tip="Établissements avec des élus en place dont le mandat se termine en 2027, dans toute la France."><b data-count="${withElus}">0</b><span>CSE à renouveler en 2027</span></div>
      <div class="stat" style="--i:2" data-tip="${esc(D.txt.kpi2)}"><b data-count="${st.s1_elus}">0</b><span>au 1er semestre</span></div>
      <div class="stat" style="--i:3" data-tip="Salariés inscrits sur les listes électorales de ces établissements au dernier vote."><b data-count="${st.s1_inscrits}">0</b><span>électeurs concernés</span></div>
      <div class="stat" style="--i:4" data-tip="Établissements de votre liste avec le contact de l'entreprise."><b data-count="${ROWS.length}">0</b><span>prospects prêts à appeler</span></div>
    </div>
    <div class="bento stag">
      <section class="tile span-8" style="--i:2">
        <h2>Quand ils revotent</h2>
        <p class="sub">Établissements avec élus en France, par mois d'élection estimé.</p>
        ${yearChart(st.months)}
        <div class="legend"><span><i style="background:var(--hot)"></i>À appeler maintenant</span><span><i style="background:var(--brand)"></i>1er semestre</span><span><i style="background:var(--fill-2)"></i>2nd semestre</span></div>
      </section>
      <section class="tile span-4" style="--i:3">
        <h2>De 50 000 à 100</h2>
        <p class="sub">Chaque étape retire ceux qui ne sont pas des clients possibles.</p>
        <ol class="funnel">${funnel.map(([l, n], i) => `<li><span class="row"><span>${esc(l)}</span><b>${fmt(n)}</b></span><span class="track"><span class="fill" style="--w:${Math.max(1.5, (n / st.total) * 100)}%;--i:${i}"></span></span></li>`).join("")}</ol>
      </section>
      <section class="tile span-7" style="--i:4">
        <h2>À appeler en premier</h2>
        <p class="sub">Les élections les plus proches, les plus gros CSE d'abord.</p>
        <a class="btn ghost more" href="#/prospects">Tout voir<svg class="ic"><use href="#i-arrow"/></svg></a>
        <ul class="next">${first.map((r) => `<li><button type="button" data-open="${r.siret}">${av(r)}
          <span class="who"><b>${esc(r.entreprise)}</b><span>${esc(cityCase(r.ville))} · ${r.inscrits} électeurs</span></span>
          <span class="pill ${isSoon(r.mois) ? "hot" : "brand"}">${isSoon(r.mois) ? '<span class="dot"></span>' : ""}${SHORT[+r.mois.slice(5) - 1]} ${r.mois.slice(0, 4)}</span></button></li>`).join("")}</ul>
      </section>
      <section class="tile span-5" style="--i:5">
        <h2>Où, au 1er semestre</h2>
        <p class="sub">Établissements avec élus par région.</p>
        <ul class="regions">${st.regions.filter(([r]) => r !== "Outre-mer").slice(0, 8).map(([r, n], i) => `<li class="${r === D.region ? "on" : ""}"><span>${esc(r)}</span><b>${fmt(n)}</b><span class="rb"><i style="--w:${(n / regMax) * 100}%;--i:${i}"></i></span></li>`).join("")}</ul>
      </section>
    </div></div>`;
  countUp();
  typewriter($("#typed"), due.slice(0, 8).map((r) => `${r.entreprise} · ${cityCase(r.ville)} · vote en ${monthLabel(r.mois)}`));
}

// Types each phrase, holds it, erases it, then moves on; stops by itself once the view is gone.
async function typewriter(el, phrases) {
  if (!el || !phrases.length) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (reduced) { el.textContent = phrases[0]; return; }
  await wait(1200);
  for (let i = 0; el.isConnected; i = (i + 1) % phrases.length) {
    const p = phrases[i];
    for (let k = 1; k <= p.length && el.isConnected; k++) { el.textContent = p.slice(0, k); await wait(55 + Math.random() * 40); }
    await wait(2200);
    for (let k = p.length; k >= 0 && el.isConnected; k--) { el.textContent = p.slice(0, k); await wait(22); }
    await wait(450);
  }
}

/* ---------- Prospects ---------- */

function filtered() {
  const q = norm(state.q.trim());
  const rows = ROWS.filter((r) =>
    (!q || norm(`${r.entreprise} ${r.ville} ${r.cp} ${r.secteur} ${r.dirigeant}`).includes(q))
    && (!state.mois || r.mois === state.mois)
    && (!state.secteur || r.secteur === state.secteur)
    && (!state.taille || (state.taille === "50" ? big(r) : !big(r)))
    && (!state.statut || statusOf(r) === state.statut));
  const by = {
    mois: (a, b) => a.mois.localeCompare(b.mois) || b.inscrits - a.inscrits,
    inscrits: (a, b) => b.inscrits - a.inscrits,
    entreprise: (a, b) => a.entreprise.localeCompare(b.entreprise),
  }[state.sort];
  return rows.sort(by);
}

const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;

function viewProspects() {
  const months = [...new Set(ROWS.map((r) => r.mois))].sort();
  const sectors = [...new Set(ROWS.map((r) => r.secteur))].sort();
  const count = (m) => ROWS.filter((r) => r.mois === m).length;
  $("#main").innerHTML = `<div class="view">
    <header class="page-head stag"><div style="--i:0"><h1>Prospects</h1><p>${ROWS.length} établissements en ${esc(D.region)} qui revotent au 1er semestre 2027, avec le contact de l'entreprise.</p></div>
      <div class="row-tools" style="--i:1">
        <button class="btn" id="copyTels" type="button" data-tip="Copie les numéros affichés, un par ligne."><svg class="ic"><use href="#i-copy"/></svg>Copier les numéros</button>
        <button class="btn primary" type="button" popovertarget="exportMenu" data-tip="Télécharge les lignes affichées, avec votre suivi et vos notes."><svg class="ic"><use href="#i-down"/></svg>Exporter</button>
        <div id="exportMenu" class="menu" popover role="menu">
          <button role="menuitem" data-exp="xlsx">Excel <span>.xlsx</span></button>
          <button role="menuitem" data-exp="csv">CSV pour CRM <span>.csv</span></button>
          <button role="menuitem" data-exp="vcf">Contacts téléphone <span>.vcf</span></button>
          <button role="menuitem" data-exp="ics">Rappels d'agenda <span>.ics</span></button>
          <button role="menuitem" data-exp="print">Imprimer ou PDF</button>
        </div>
      </div></header>
    <div class="bar-tools">
      <div class="row-tools">
        <label class="search" data-tip="Nom, ville, code postal, secteur ou dirigeant. Raccourci : /"><svg class="ic"><use href="#i-search"/></svg><input id="q" type="search" placeholder="Rechercher un établissement" value="${esc(state.q)}" aria-label="Rechercher"></label>
        <div class="filters">
        <div class="seg" id="segTaille" role="group" aria-label="Taille" data-tip="Dès 50 salariés, les titulaires ont aussi droit à la formation économique."><span class="seg-ind"></span>
          ${[["", "Toutes tailles"], ["50", "50 sal. et +"], ["moins", "Moins de 50"]].map(([v, l]) => `<button type="button" data-taille="${v}" aria-pressed="${state.taille === v}">${l}</button>`).join("")}</div>
        <select class="select" id="fSecteur" aria-label="Secteur">${opt("", "Tous les secteurs", state.secteur)}${sectors.map((s) => opt(s, s, state.secteur)).join("")}</select>
        <select class="select" id="fStatut" aria-label="Suivi">${opt("", "Tout le suivi", state.statut)}${STATUSES.map(([v, l]) => opt(v, l, state.statut)).join("")}</select>
        <select class="select" id="fSort" aria-label="Trier">${opt("mois", "Trier : élection", state.sort)}${opt("inscrits", "Trier : électeurs", state.sort)}${opt("entreprise", "Trier : nom", state.sort)}</select>
        </div>
      </div>
      <div class="chips" id="chipsMois">
        <button class="chip" type="button" data-mois="" aria-pressed="${!state.mois}">Tous les mois <small>${ROWS.length}</small></button>
        ${months.map((m) => `<button class="chip" type="button" data-mois="${m}" aria-pressed="${state.mois === m}">${capital(monthLabel(m))} <small>${count(m)}</small></button>`).join("")}
      </div>
      <div class="count-line" id="countLine"></div>
    </div>
    <ul class="plist" id="plist"></ul>
    <div class="empty" id="empty" hidden><b>Aucun établissement ne correspond.</b>Élargissez un filtre ou videz la recherche.</div></div>`;
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderRows(); });
  $("#fSecteur").addEventListener("change", (e) => { state.secteur = e.target.value; renderRows(); });
  $("#fStatut").addEventListener("change", (e) => { state.statut = e.target.value; renderRows(); });
  $("#fSort").addEventListener("change", (e) => { state.sort = e.target.value; renderRows(); });
  requestAnimationFrame(() => moveSegInd($("#segTaille")));
  renderRows(true);
}

function rowHTML(r) {
  const s = statusOf(r);
  return `<li class="prow ${s === "ecarte" ? "dim" : ""}" data-siret="${r.siret}" tabindex="0">
    ${av(r)}
    <span class="who"><b>${esc(r.entreprise)}</b><span>${esc(cityCase(r.ville))} · ${esc(r.effectif)} salariés</span></span>
    <span class="c-sec">${esc(r.secteur)}</span>
    <span class="c-el" data-tip="Salariés inscrits au dernier vote : plus il y en a, plus il y a d'élus à former."><b>${r.inscrits}</b>électeurs</span>
    <span class="c-tel">${r.tel ? `<span class="tel"><a class="mono" href="${telHref(r.tel)}" data-tip="Appeler le standard. Demandez le ou la secrétaire du CSE.">${fmtTel(r.tel)}</a>${r.tel_local ? "" : `<span class="hq" data-tip="Numéro hors de la région : probablement le standard du siège.">siège</span>`}<button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro" data-tip="Copier"><svg class="ic"><use href="#i-copy"/></svg></button></span>` : `<span class="none">Pas de standard trouvé</span>`}</span>
    <span class="c-st"><span class="pill ${isSoon(r.mois) ? "hot" : "brand"}" style="margin-right:6px" data-tip="Élection estimée en ${monthLabel(r.mois)}, ${untilLabel(r.mois)}.">${isSoon(r.mois) ? '<span class="dot"></span>' : ""}${SHORT[+r.mois.slice(5) - 1]}</span><select class="stsel" data-s="${s}" data-siret="${r.siret}" aria-label="Suivi pour ${esc(r.entreprise)}">${STATUSES.map(([v, l]) => `<option value="${v}" ${v === s ? "selected" : ""}>${l}</option>`).join("")}</select></span>
  </li>`;
}

// FLIP: rows that stay glide to their new place, new rows pop in. Filtering feels physical instead of a flash.
function renderRows(first = false) {
  const list = $("#plist");
  if (!list) return;
  const before = new Map($$(".prow", list).map((el) => [el.dataset.siret, el.getBoundingClientRect().top]));
  const rows = filtered();
  list.innerHTML = rows.map(rowHTML).join("");
  $("#empty").hidden = rows.length > 0;
  $("#countLine").innerHTML = `<b>${rows.length}</b> ${plural(rows.length, "établissement")} · <b>${rows.filter((r) => r.tel).length}</b> avec standard · <b>${rows.filter((r) => isSoon(r.mois)).length}</b> à appeler maintenant`;
  $$("#chipsMois .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.mois === state.mois));
  if (reduced) return;
  $$(".prow", list).forEach((el, i) => {
    const old = before.get(el.dataset.siret);
    if (first || old === undefined) {
      if (i < 14) el.animate([{ opacity: 0, transform: "translateY(18px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 1000, delay: i * 60, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      return;
    }
    const dy = old - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1 && Math.abs(dy) < innerHeight * 1.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 900, easing: getComputedStyle(document.documentElement).getPropertyValue("--spring-soft").trim() || "ease-out" });
  });
}

/* ---------- Sheet ---------- */

function openSheet(siret) {
  const r = BY_SIRET[siret];
  if (!r) return;
  const s = statusOf(r), soon = isSoon(r.mois);
  const line = `${r.entreprise}, ${cityCase(r.ville)}, élection CSE estimée ${monthLabel(r.mois)}${r.tel ? ", standard " + fmtTel(r.tel) : ""}`;
  const subject = encodeURIComponent("Élections du CSE et formation des élus");
  $("#sheetBody").innerHTML = `
    <div class="s-head" style="--i:0">${av(r)}<div><h2 id="sTitle">${esc(r.entreprise)}</h2><p>${esc(cityCase(r.ville))} · ${esc(r.secteur)}</p></div>
      <button class="iconbtn" data-close aria-label="Fermer" data-tip="Fermer (Échap)"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="s-when ${soon ? "" : "later"}" style="--i:1"><b>Élection estimée en ${monthLabel(r.mois)}</b><span>${capital(untilLabel(r.mois))} · ${soon ? "le vote se prépare maintenant, appelez cette semaine" : "à appeler avant l'organisation du vote"}</span></div>
    ${r.tel ? `<a class="bigtel" style="--i:2" href="${telHref(r.tel)}"><span><small>Standard${r.tel_local ? "" : ", probablement le siège"} · demandez le ou la secrétaire du CSE</small><span class="mono">${fmtTel(r.tel)}</span></span><svg class="ic"><use href="#i-phone"/></svg></a>` : ""}
    <section class="s-sec" style="--i:3"><h3>Contact de l'entreprise</h3>
      ${r.tel ? `<div class="s-row"><svg class="ic"><use href="#i-phone"/></svg><span class="v mono">${fmtTel(r.tel)}</span><button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro" data-tip="Copier"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
      ${r.email ? `<div class="s-row"><svg class="ic"><use href="#i-mail"/></svg><span class="v"><a href="mailto:${esc(r.email)}?subject=${subject}" data-tip="Ouvre votre messagerie avec un objet déjà rempli.">${esc(r.email)}</a></span><button class="mini" data-copy="${esc(r.email)}" aria-label="Copier l'email" data-tip="Copier"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
      ${r.site ? `<div class="s-row"><svg class="ic"><use href="#i-globe"/></svg><span class="v"><a href="${esc(siteUrl(r.site))}" target="_blank" rel="noopener">${esc(r.site)}</a></span></div>` : ""}
      ${r.adresse ? `<div class="s-row"><svg class="ic"><use href="#i-pin"/></svg><span class="v"><a href="https://www.google.com/maps/search/${encodeURIComponent(r.adresse)}" target="_blank" rel="noopener">${esc(r.adresse)}</a></span></div>` : ""}
    </section>
    <section class="s-sec" style="--i:4"><h3>Mon suivi</h3><div class="status-seg">${STATUSES.map(([v, l]) => `<button type="button" data-st="${v}" data-siret="${r.siret}" aria-pressed="${v === s}">${l}</button>`).join("")}</div></section>
    <section class="s-sec" style="--i:5"><h3><label for="note">Notes</label></h3><textarea id="note" data-siret="${r.siret}" placeholder="Ex. secrétaire du CSE absente, rappeler mardi matin">${esc(noteOf(r))}</textarea></section>
    <section class="s-sec" style="--i:6"><h3>Formations à proposer aux nouveaux élus</h3><div class="trainings">
      <div class="training"><b>Santé, sécurité et conditions de travail</b><span>Tous les élus · 5 jours minimum au premier mandat, 3 jours au renouvellement · payée par l'employeur</span><a href="${CT}l2315-18" target="_blank" rel="noopener">Article L2315-18</a></div>
      ${big(r) ? `<div class="training"><b>Formation économique</b><span>Titulaires élus pour la première fois, dès 50 salariés · 5 jours maximum · financée par le CSE</span><a href="${CT}l2315-63" target="_blank" rel="noopener">Article L2315-63</a></div>` : ""}
      <div class="training"><b>Référent harcèlement</b><span>Désigné par le CSE parmi ses membres, pour la durée du mandat</span><a href="${CT}l2314-1" target="_blank" rel="noopener">Article L2314-1</a></div>
    </div></section>
    <section class="s-sec" style="--i:7"><h3>Fiche</h3><dl class="facts">
      <dt>Électeurs inscrits</dt><dd>${r.inscrits}</dd><dt>Effectif</dt><dd>${esc(r.effectif)} salariés</dd>
      ${r.dirigeant ? `<dt data-tip="Dirigeant déclaré au registre officiel (donnée publique).">Dirigeant publié</dt><dd>${esc(r.dirigeant)}</dd>` : ""}
      <dt>Code NAF</dt><dd>${esc(r.naf)}</dd><dt>SIRET</dt><dd class="mono">${r.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4")}</dd></dl></section>
    <div class="s-actions" style="--i:8">
      <button class="btn" data-copy="${esc(line)}"><svg class="ic"><use href="#i-copy"/></svg>Copier la fiche</button>
      <button class="btn" data-ics="${r.siret}" data-tip="Rappel trois mois avant l'élection."><svg class="ic"><use href="#i-cal"/></svg>Rappel agenda</button>
      <a class="btn" href="https://annuaire-entreprises.data.gouv.fr/etablissement/${r.siret}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-ext"/></svg>Fiche officielle</a>
    </div>`;
  const sh = $("#sheet");
  if (!sh.open) sh.showModal();
  $("#sheetBody").scrollTop = 0;
}

/* ---------- Call session ---------- */

function sessionQueue() {
  return ROWS.filter((r) => r.tel && ["appeler", "rappeler"].includes(statusOf(r))).sort((a, b) => a.mois.localeCompare(b.mois) || b.inscrits - a.inscrits);
}

const SESS = { queue: [], i: 0, done: { appele: 0, rappeler: 0, ecarte: 0 } };

function cardHTML(r, pos) {
  return `<article class="card" data-pos="${pos}" data-siret="${r.siret}" aria-hidden="${pos > 0}">
    <div class="card-top"><span class="pill ${isSoon(r.mois) ? "hot" : "brand"}">${isSoon(r.mois) ? '<span class="dot"></span>' : ""}Élection ${monthLabel(r.mois)} · ${untilLabel(r.mois)}</span>${av(r)}</div>
    <div><h3>${esc(r.entreprise)}</h3><p class="meta">${esc(cityCase(r.ville))} · ${esc(r.secteur)} · ${r.inscrits} électeurs · ${esc(r.effectif)} salariés</p></div>
    <a class="bigtel" href="${telHref(r.tel)}" ${pos ? 'tabindex="-1"' : ""}><span><small>Standard${r.tel_local ? "" : ", probablement le siège"}</small><span class="mono">${fmtTel(r.tel)}</span></span><svg class="ic"><use href="#i-phone"/></svg></a>
    <p class="hint">Demandez le ou la secrétaire du CSE. ${big(r) ? "Dès 50 salariés : SSCT et formation économique pour les nouveaux titulaires." : "Formation SSCT pour tous les nouveaux élus."}</p>
    <div class="card-links">${r.email ? `<a class="btn ghost" href="mailto:${esc(r.email)}" ${pos ? 'tabindex="-1"' : ""}><svg class="ic"><use href="#i-mail"/></svg>Email</a>` : ""}${r.site ? `<a class="btn ghost" href="${esc(siteUrl(r.site))}" target="_blank" rel="noopener" ${pos ? 'tabindex="-1"' : ""}><svg class="ic"><use href="#i-globe"/></svg>Site</a>` : ""}<button class="btn ghost" type="button" data-open="${r.siret}" ${pos ? 'tabindex="-1"' : ""}>Fiche complète</button></div>
  </article>`;
}

function openSession() {
  SESS.queue = sessionQueue();
  SESS.i = 0;
  SESS.done = { appele: 0, rappeler: 0, ecarte: 0 };
  if (!SESS.queue.length) return toast("Tout est traité, rien à appeler");
  const el = $("#session");
  el.innerHTML = `<div class="mesh" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <header class="sess-top"><div class="ring" id="ring"><span id="ringN">0/${SESS.queue.length}</span></div><div><h2>Session d'appels</h2><p>Les élections les plus proches d'abord. Raccourcis : ← pas intéressé · ↑ à rappeler · → appelé</p></div>
      <button class="iconbtn" data-endsession aria-label="Terminer la session" data-tip="Terminer (Échap)"><svg class="ic"><use href="#i-x"/></svg></button></header>
    <div class="stack" id="stack"></div>
    <div class="sess-acts" id="sessActs">
      <button class="act no" type="button" data-verdict="ecarte"><i><svg class="ic"><use href="#i-x"/></svg></i>Pas intéressé<kbd>←</kbd></button>
      <button class="act later" type="button" data-verdict="rappeler"><i><svg class="ic"><use href="#i-clock"/></svg></i>À rappeler<kbd>↑</kbd></button>
      <button class="act ok" type="button" data-verdict="appele"><i><svg class="ic"><use href="#i-check"/></svg></i>Appelé<kbd>→</kbd></button>
    </div>`;
  el.hidden = false;
  el.classList.remove("leave");
  document.body.style.overflow = "hidden";
  renderStack(true);
}

function renderStack(first) {
  const stack = $("#stack");
  const left = SESS.queue.slice(SESS.i, SESS.i + 4);
  const total = SESS.queue.length;
  $("#ring").style.setProperty("--p", (SESS.i / total) * 100);
  $("#ringN").textContent = `${SESS.i}/${total}`;
  if (!left.length) {
    $("#sessActs").hidden = true;
    stack.innerHTML = `<div class="done"><div class="big"><svg class="ic"><use href="#i-check"/></svg></div><h3>Session terminée</h3>
      <p>${SESS.done.appele} ${plural(SESS.done.appele, "appelé")} · ${SESS.done.rappeler} à rappeler · ${SESS.done.ecarte} ${plural(SESS.done.ecarte, "écarté")}. Tout est enregistré dans votre suivi.</p>
      <button class="btn primary lg" data-endsession type="button">Retour à l'accueil</button></div>`;
    const b = stack.getBoundingClientRect();
    burst(b.left + b.width / 2, b.top + b.height / 2 - 40);
    return;
  }
  // Keep the cards already on screen so they slide forward; only the new back card is created.
  const keep = new Map($$(".card", stack).filter((c) => !c.dataset.gone).map((c) => [c.dataset.siret, c]));
  left.forEach((r, pos) => {
    let c = keep.get(r.siret);
    if (!c) {
      stack.insertAdjacentHTML("afterbegin", cardHTML(r, pos));
      c = stack.firstElementChild;
      if (first && pos === 0) c.classList.add("enter");
    }
    c.dataset.pos = pos;
    c.style.zIndex = 10 - pos;
    c.setAttribute("aria-hidden", pos > 0);
    $$("a, button", c).forEach((x) => (pos ? x.setAttribute("tabindex", "-1") : x.removeAttribute("tabindex")));
    keep.delete(r.siret);
  });
  keep.forEach((c) => c.remove());
}

function verdict(v) {
  const r = SESS.queue[SESS.i];
  if (!r) return;
  const card = $(`.card[data-siret="${r.siret}"]`);
  save(r.siret, { s: v });
  SESS.done[v]++;
  SESS.i++;
  if (card) {
    card.dataset.gone = "1";
    card.classList.add({ appele: "fly-ok", rappeler: "fly-later", ecarte: "fly-no" }[v]);
    setTimeout(() => card.remove(), 1000);
  }
  const btn = $(`[data-verdict="${v}"]`);
  btn?.animate([{ transform: "scale(.9)" }, { transform: "scale(1.06)" }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.16,1,.3,1)" });
  renderStack();
}

function closeSession() {
  const el = $("#session");
  el.classList.add("leave");
  setTimeout(() => { el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; route(); }, 320);
}

/* ---------- Calendar ---------- */

function viewCalendar() {
  const nat = Object.fromEntries(D.stats.months);
  const all = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`);
  $("#main").innerHTML = `<div class="view">
    <header class="page-head stag"><div style="--i:0"><h1>Calendrier 2027</h1><p>Chaque carré est un établissement de votre liste, coloré selon votre suivi. Les mois cerclés de rouge sont à appeler maintenant.</p></div></header>
    <div class="cal-legend">${[["var(--fill-2)", "À appeler"], ["var(--brand)", "Appelé"], ["var(--warn)", "À rappeler"], ["var(--violet-ink)", "Devis envoyé"], ["var(--ok)", "Client"]].map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>
    <div class="months stag">${all.map((m, i) => {
      const rows = ROWS.filter((r) => r.mois === m);
      const n = monthsUntil(m), win = n >= 0 && n <= WINDOW;
      return `<button class="month ${win ? "win" : ""} ${rows.length ? "" : "quiet"}" style="--i:${i}" type="button" data-month="${rows.length ? m : ""}" data-tip="${fmt(nat[m] || 0)} établissements avec élus revotent en ${monthLabel(m)} en France.${rows.length ? " Cliquez pour voir les vôtres." : ""}">
        ${win ? '<span class="pill hot tag"><span class="dot"></span>Maintenant</span>' : ""}
        <h3>${MONTHS[i]}</h3>
        ${rows.length ? `<div class="n">${rows.length}<small>${plural(rows.length, "prospect")}</small></div>
        <div class="dots">${rows.map((r, j) => `<i data-s="${statusOf(r)}" style="--i:${j}"></i>`).join("")}</div>
        <span class="nat">${fmt(nat[m] || 0)} en France</span>` : `<div class="n">${fmt(nat[m] || 0)}<small>en France</small></div><span class="nat">Hors de la démo, limitée au 1er semestre</span>`}</button>`;
    }).join("")}</div></div>`;
}

/* ---------- Assistant: data answers + four verified points of law ---------- */

const LAW = [
  { k: /mandat|duree|combien de temps|4 ans|quatre ans|renouvel/, q: "Combien de temps dure un mandat au CSE ?",
    a: "<p><b>Quatre ans.</b> Les membres de la délégation du personnel du CSE sont élus pour quatre ans.</p><p>Un accord de branche, de groupe ou d'entreprise peut fixer une durée comprise <b>entre deux et quatre ans</b>. C'est pour ça que la date de la prochaine élection est une estimation.</p>",
    cites: [["Article L2314-33", "l2314-33"], ["Article L2314-34", "l2314-34"]] },
  { k: /ssct|sante|securite|conditions de travail/, q: "Quelle formation santé et sécurité pour les élus ?",
    a: "<p><b>Au moins 5 jours lors du premier mandat</b>, pour chaque membre de la délégation du personnel.</p><p>Au renouvellement : <b>3 jours</b> pour chaque membre, et <b>5 jours</b> pour les membres de la commission santé, sécurité et conditions de travail dans les entreprises d'au moins 300 salariés. La formation est payée par l'employeur.</p>",
    cites: [["Article L2315-18", "l2315-18"]] },
  { k: /econom|comptes|budget/, q: "Qui a droit à la formation économique ?",
    a: "<p>Dans les entreprises d'<b>au moins 50 salariés</b>, les <b>membres titulaires élus pour la première fois</b>.</p><p>C'est un stage de <b>5 jours maximum</b>, financé par le CSE (et non par l'employeur).</p>",
    cites: [["Article L2315-63", "l2315-63"]] },
  { k: /harcel|referent|sexis/, q: "Comment est désigné le référent harcèlement ?",
    a: "<p>Le CSE désigne <b>parmi ses membres</b> un référent en matière de lutte contre le harcèlement sexuel et les agissements sexistes, par une <b>résolution</b>.</p><p>Sa mission dure <b>jusqu'à la fin du mandat</b> des élus.</p>",
    cites: [["Article L2314-1", "l2314-1"]] },
];
const DATA_QS = ["Qui vote en mars ?", "Les plus gros CSE", "Établissements à Lyon", "Combien à appeler maintenant ?", "Lesquels ont un email ?"];

function answer(qRaw) {
  const q = norm(qRaw);
  const list = (rows, n = 5) => `<ul>${rows.slice(0, n).map((r) => `<li><a data-open="${r.siret}">${esc(r.entreprise)}</a> · ${esc(cityCase(r.ville))} · ${monthLabel(r.mois)} · ${r.inscrits} électeurs</li>`).join("")}</ul>${rows.length > n ? `<p class="muted" style="margin-top:6px">… et ${rows.length - n} autres dans Prospects.</p>` : ""}`;
  const law = LAW.find((l) => l.k.test(q) && !/qui vote|prospect|etablissement/.test(q));
  if (law) return law.a + law.cites.map(([l, a]) => `<a class="cite" href="${CT}${a}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-scale"/></svg>${l}<svg class="ic"><use href="#i-ext"/></svg></a>`).join(" ");
  const mi = MONTHS.findIndex((m) => q.includes(norm(m)));
  if (mi >= 0) {
    const m = `2027-${String(mi + 1).padStart(2, "0")}`;
    const rows = ROWS.filter((r) => r.mois === m).sort((a, b) => b.inscrits - a.inscrits);
    const nat = (D.stats.months.find(([k]) => k === m) || [0, 0])[1];
    return rows.length ? `<p><b>${rows.length} prospects</b> votent en ${monthLabel(m)}, sur ${fmt(nat)} en France. Les plus gros :</p>${list(rows)}` : `<p>Aucun prospect de votre liste ne vote en ${monthLabel(m)}. En France : <b>${fmt(nat)}</b> établissements avec élus.</p>`;
  }
  if (/gros|grand|plus d.electeurs|important/.test(q)) return `<p>Les CSE avec le plus d'électeurs, donc le plus d'élus à former :</p>${list([...ROWS].sort((a, b) => b.inscrits - a.inscrits))}`;
  if (/email|mail/.test(q)) { const r = ROWS.filter((x) => x.email); return `<p><b>${r.length}</b> établissements ont un email générique :</p>${list(r)}`; }
  if (/maintenant|urgent|bientot|priorit|appeler/.test(q)) { const r = ROWS.filter((x) => isSoon(x.mois)).sort((a, b) => a.mois.localeCompare(b.mois)); return `<p><b>${r.length}</b> prospects votent dans les ${WINDOW} prochains mois.</p>${list(r)}<button class="btn primary" style="margin-top:10px" data-session type="button"><svg class="ic"><use href="#i-phone"/></svg>Lancer la session d'appels</button>`; }
  const sec = [...new Set(ROWS.map((r) => r.secteur))].find((s) => norm(s).split(/[ ,]+/).some((w) => w.length > 4 && q.includes(w)));
  if (sec) { const r = ROWS.filter((x) => x.secteur === sec); return `<p><b>${r.length}</b> établissements en ${esc(sec.toLowerCase())} :</p>${list(r)}`; }
  const city = [...new Set(ROWS.map((r) => norm(r.ville).replace(/ \d+$/, "")))].sort((a, b) => b.length - a.length).find((c) => c.length > 2 && q.includes(c));
  if (city) { const r = ROWS.filter((x) => norm(x.ville).startsWith(city)); return `<p><b>${r.length}</b> établissements à ${esc(cityCase(city))} :</p>${list(r)}`; }
  return "<p>Je sais répondre sur vos prospects (un mois, une ville, un secteur, les plus gros CSE, ceux à appeler maintenant) et sur quatre points du droit du CSE : durée du mandat, formation santé-sécurité, formation économique, référent harcèlement.</p>";
}

function viewAssistant() {
  $("#main").innerHTML = `<div class="view">
    <header class="page-head stag"><div style="--i:0"><h1>Assistant</h1><p>Une question en français, une réponse courte. Sur le droit du CSE, chaque réponse cite l'article du Code du travail.</p></div></header>
    <div class="chat stag">
      <section class="chatbox" style="--i:1"><div class="msgs" id="msgs" aria-live="polite">
        <div class="msg bot"><p>Bonjour. Je connais vos ${ROWS.length} prospects et quatre points du droit du CSE. Choisissez une question dans la liste, ou écrivez la vôtre.</p></div></div>
        <form class="composer" id="ask"><input id="askIn" placeholder="Ex. qui a droit à la formation économique ?" aria-label="Votre question" autocomplete="off"><button class="btn brand" aria-label="Envoyer"><svg class="ic"><use href="#i-send"/></svg></button></form>
      </section>
      <aside class="side">
        <div class="tile" style="--i:2"><h3><svg class="ic"><use href="#i-scale"/></svg>Droit du CSE</h3><div class="qs">${LAW.map((l) => `<button type="button" data-ask="${esc(l.q)}">${esc(l.q)}</button>`).join("")}</div></div>
        <div class="tile" style="--i:3"><h3><svg class="ic"><use href="#i-spark"/></svg>Vos prospects</h3><div class="qs">${DATA_QS.map((q) => `<button type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>
        <div class="tile" style="--i:4"><p>Réponses rédigées à partir du Code du travail, sans IA générative. Branché sur un modèle d'IA, cet assistant deviendrait l'outil quotidien des élus.</p></div>
      </aside>
    </div></div>`;
  $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#askIn").value); $("#askIn").value = ""; });
}

function ask(q) {
  if (!q.trim() || !$("#msgs")) return;
  const box = $("#msgs");
  box.insertAdjacentHTML("beforeend", `<div class="msg me">${esc(q)}</div><div class="msg bot typing"><i></i><i></i><i></i></div>`);
  box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  setTimeout(() => {
    const t = $(".typing", box);
    if (!t) return;
    t.outerHTML = `<div class="msg bot">${answer(q)}</div>`;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, reduced ? 0 : 1100);
}

/* ---------- Method ---------- */

function viewMethod() {
  $("#main").innerHTML = D.methode;
  const st = D.stats;
  const ara = (st.regions.find(([r]) => r === D.region) || [0, 0])[1];
  $("#docFunnel").innerHTML = [
    [st.total, "établissements dont la prochaine élection tombe en 2027"],
    [st.total - st.sans, D.txt.m2],
    [st.s1_elus, "votent entre janvier et juin 2027"],
    [ara, `sont en ${D.region}`],
    [ROWS.length, "enrichis avec le contact de l'entreprise dans cette démo"],
  ].map(([n, l], i) => `<li style="--i:${i + 2}"><b data-count="${n}">0</b><span>${esc(l)}</span></li>`).join("");
  countUp($("#docFunnel"));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .15 });
  $$(".reveal").forEach((el) => io.observe(el));
}

/* ---------- Command palette ---------- */

const ACTIONS = [
  { l: "Lancer la session d'appels", i: "i-phone", run: () => openSession() },
  { l: "Aller à l'accueil", i: "i-home", run: () => go("#/accueil") },
  { l: "Voir les prospects", i: "i-list", run: () => go("#/prospects") },
  { l: "Ouvrir le calendrier 2027", i: "i-cal", run: () => go("#/calendrier") },
  { l: "Poser une question à l'assistant", i: "i-scale", run: () => go("#/assistant") },
  { l: "Comprendre la méthode", i: "i-book", run: () => go("#/methode") },
  { l: "Exporter en Excel", i: "i-down", run: () => doExport("xlsx", ROWS) },
];
let cmdSel = 0, cmdItems = [];

function openCmd() {
  const c = $("#cmd");
  if (c.open) return;
  c.showModal();
  $("#cmdIn").value = "";
  renderCmd();
  $("#cmdIn").focus();
}

function renderCmd() {
  const q = norm($("#cmdIn").value.trim());
  const acts = ACTIONS.filter((a) => !q || norm(a.l).includes(q));
  const pros = q ? ROWS.filter((r) => norm(`${r.entreprise} ${r.ville} ${r.cp}`).includes(q)).slice(0, 8) : ROWS.filter((r) => isSoon(r.mois)).slice(0, 4);
  cmdItems = [...pros.map((r) => ({ run: () => openSheet(r.siret) })), ...acts];
  cmdSel = Math.min(cmdSel, Math.max(0, cmdItems.length - 1));
  let k = 0;
  $("#cmdList").innerHTML = (pros.length ? `<h4>${q ? "Établissements" : "À appeler maintenant"}</h4>` + pros.map((r) => `<button class="cmd-item" role="option" data-k="${k++}">${av(r)}<span class="who"><b>${esc(r.entreprise)}</b><span>${esc(cityCase(r.ville))} · ${monthLabel(r.mois)}</span></span><span class="r">${r.tel ? fmtTel(r.tel) : ""}</span></button>`).join("") : "")
    + (acts.length ? `<h4>Actions</h4>` + acts.map((a) => `<button class="cmd-item" role="option" data-k="${k++}"><span class="ico"><svg class="ic"><use href="#${a.i}"/></svg></span><span>${esc(a.l)}</span><span class="r">↵</span></button>`).join("") : "")
    || `<p class="cmd-empty">Aucun résultat pour « ${esc($("#cmdIn").value)} »</p>`;
  highlightCmd();
}

function highlightCmd() {
  $$(".cmd-item").forEach((b) => b.setAttribute("aria-selected", +b.dataset.k === cmdSel));
  $(`.cmd-item[data-k="${cmdSel}"]`)?.scrollIntoView({ block: "nearest" });
}

function runCmd(k) {
  const it = cmdItems[k];
  if (!it) return;
  $("#cmd").close();
  setTimeout(it.run, 60);
}

/* ---------- Exports ---------- */

function exportRows(rows) {
  return rows.map((r) => ({
    "Élection estimée": monthLabel(r.mois), "Mois (AAAA-MM)": r.mois, "Entreprise": r.entreprise, "Ville": cityCase(r.ville),
    "Code postal": r.cp, "Adresse": r.adresse, "Secteur": r.secteur, "NAF": r.naf, "Effectif": r.effectif, "Électeurs inscrits": r.inscrits,
    "Standard": fmtTel(r.tel), "Email": r.email, "Site": r.site, "Dirigeant publié": r.dirigeant,
    "SIRET": r.siret, "Suivi": STATUS_LABEL[statusOf(r)], "Notes": noteOf(r),
  }));
}

function download(content, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const vEsc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

function icsFor(rows) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = rows.map((r) => {
    const t = +r.mois.slice(0, 4) * 12 + +r.mois.slice(5) - 1 - 3;
    const d = `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}01`;
    return ["BEGIN:VEVENT", `UID:${r.siret}@mandat`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${vEsc(`Appeler ${r.entreprise} (élection CSE ${monthLabel(r.mois)})`)}`,
      `DESCRIPTION:${vEsc(`${cityCase(r.ville)}. Standard ${fmtTel(r.tel) || "non trouvé"}. ${r.inscrits} électeurs.`)}`, "END:VEVENT"].join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mandat//FR", ...ev, "END:VCALENDAR"].join("\r\n");
}

function doExport(kind, src = filtered()) {
  const name = `mandat-prospects-${new Date().toISOString().slice(0, 10)}`;
  const rows = exportRows(src);
  if (kind === "print") return window.print();
  if (kind === "csv") {
    const head = Object.keys(rows[0] || {});
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    download("﻿" + [head.map(cell).join(";"), ...rows.map((r) => head.map((h) => cell(r[h])).join(";"))].join("\r\n"), name + ".csv", "text/csv");
  } else if (kind === "xlsx") {
    if (!window.XLSX) return toast("Excel se charge, réessayez dans une seconde");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prospects");
    XLSX.writeFile(wb, name + ".xlsx");
  } else if (kind === "vcf") {
    download(src.filter((r) => r.tel).map((r) => ["BEGIN:VCARD", "VERSION:3.0", `FN:${vEsc(r.entreprise)}`, `ORG:${vEsc(r.entreprise)}`, `TEL;TYPE=WORK:${r.tel}`, r.email ? `EMAIL:${r.email}` : "", `NOTE:${vEsc(`Élection CSE estimée ${monthLabel(r.mois)}`)}`, "END:VCARD"].filter(Boolean).join("\r\n")).join("\r\n"), name + ".vcf", "text/vcard");
  } else if (kind === "ics") download(icsFor(src), name + ".ics", "text/calendar");
  toast(`${src.length} ${plural(src.length, "établissement")} ${src.length > 1 ? "exportés" : "exporté"}`);
}

/* ---------- Tooltip ---------- */

function initTips() {
  if (matchMedia("(hover: none)").matches) return; // touch screens: no hover, so no tooltips getting in the way
  const tip = $("#tip");
  let cur = null, timer;
  const hide = () => { tip.classList.remove("on"); cur = null; clearTimeout(timer); };
  const show = (el) => {
    cur = el;
    clearTimeout(timer);
    timer = setTimeout(() => {
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      let top = r.bottom + 10;
      if (top + t.height > innerHeight - 8) top = r.top - t.height - 10;
      tip.style.top = top + "px";
      tip.style.left = Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2)) + "px";
      tip.classList.add("on");
    }, tip.classList.contains("on") ? 0 : 260);
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest("[data-tip]");
    if (el && el !== cur) show(el); else if (!el && cur) hide();
  });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el && e.target.matches(":focus-visible")) show(el); });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  addEventListener("scroll", hide, { passive: true, capture: true });
}

/* ---------- Events ---------- */

document.addEventListener("click", (e) => {
  const t = e.target;
  const c = t.closest("[data-copy]");
  if (c) { e.stopPropagation(); return copy(c.dataset.copy, "Copié dans le presse-papiers"); }
  if (t.closest("[data-session]")) { $("#sheet").open && $("#sheet").close(); return openSession(); }
  if (t.closest("[data-endsession]")) return closeSession();
  const vd = t.closest("[data-verdict]");
  if (vd) return verdict(vd.dataset.verdict);
  const o = t.closest("[data-open]");
  if (o) return openSheet(o.dataset.open);
  const m = t.closest("[data-month]");
  if (m && m.dataset.month) { state.mois = m.dataset.month; return go("#/prospects"); }
  const mc = t.closest("[data-mois]");
  if (mc) { state.mois = mc.dataset.mois; mc.animate([{ transform: "scale(.9)" }, { transform: "none" }], { duration: 400, easing: "cubic-bezier(.16,1,.3,1)" }); mc.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }); return renderRows(); }
  const tb = t.closest("[data-taille]");
  if (tb) { state.taille = tb.dataset.taille; $$("#segTaille button").forEach((b) => b.setAttribute("aria-pressed", b === tb)); moveSegInd($("#segTaille")); return renderRows(); }
  const ex = t.closest("[data-exp]");
  if (ex) { $("#exportMenu").hidePopover?.(); return doExport(ex.dataset.exp); }
  if (t.closest("#copyTels")) { const tels = filtered().filter((r) => r.tel).map((r) => fmtTel(r.tel)); return copy(tels.join("\n"), `${tels.length} numéros copiés`); }
  const st = t.closest("[data-st]");
  if (st) { save(st.dataset.siret, { s: st.dataset.st }); $$("[data-st]").forEach((b) => b.setAttribute("aria-pressed", b === st)); toast(`Suivi : ${STATUS_LABEL[st.dataset.st]}`); return refreshList(); }
  const ic = t.closest("[data-ics]");
  if (ic) { const r = BY_SIRET[ic.dataset.ics]; download(icsFor([r]), `rappel-${r.siret}.ics`, "text/calendar"); return toast("Rappel téléchargé"); }
  if (t.closest("[data-close]")) return $("#sheet").close();
  const ak = t.closest("[data-ask]");
  if (ak) return ask(ak.dataset.ask);
  const ck = t.closest(".cmd-item");
  if (ck) return runCmd(+ck.dataset.k);
  if (t.closest("#openCmd")) return openCmd();
  if (t.closest("#logout")) { localStorage.removeItem(KEY_STORE); return location.reload(); }
  const row = t.closest(".prow");
  if (row && !t.closest("select, a, button")) openSheet(row.dataset.siret);
});

function refreshList() {
  if (currentView === "prospects") renderRows();
}

document.addEventListener("change", (e) => {
  if (e.target.matches(".stsel")) { save(e.target.dataset.siret, { s: e.target.value }); e.target.dataset.s = e.target.value; e.target.closest(".prow")?.classList.toggle("dim", e.target.value === "ecarte"); toast(`Suivi : ${STATUS_LABEL[e.target.value]}`); }
});
document.addEventListener("beforetoggle", (e) => {
  if (e.target.id !== "exportMenu" || e.newState !== "open") return;
  const b = $("[popovertarget=exportMenu]").getBoundingClientRect(), m = e.target;
  m.style.top = b.bottom + 8 + "px";
  m.style.right = innerWidth - b.right + "px";
}, true);
document.addEventListener("input", (e) => { if (e.target.id === "note") save(e.target.dataset.siret, { n: e.target.value }); });
$("#cmdIn").addEventListener("input", () => { cmdSel = 0; renderCmd(); });
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("#sheet").close(); });
$("#cmd").addEventListener("click", (e) => { if (e.target.id === "cmd") $("#cmd").close(); });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && D) { e.preventDefault(); return $("#cmd").open ? $("#cmd").close() : openCmd(); }
  if ($("#cmd").open) {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdSel = Math.min(cmdItems.length - 1, cmdSel + 1); highlightCmd(); }
    if (e.key === "ArrowUp") { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); highlightCmd(); }
    if (e.key === "Enter") { e.preventDefault(); runCmd(cmdSel); }
    return;
  }
  if (!$("#session").hidden) {
    const v = { ArrowRight: "appele", ArrowUp: "rappeler", ArrowLeft: "ecarte" }[e.key];
    if (v && !$("#sheet").open) { e.preventDefault(); return verdict(v); }
    if (e.key === "Escape" && !$("#sheet").open) return closeSession();
    return;
  }
  if (e.key === "/" && !e.target.matches("input, textarea, select") && $("#q")) { e.preventDefault(); $("#q").focus(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".prow")) { e.preventDefault(); openSheet(e.target.dataset.siret); }
});
addEventListener("hashchange", route);
addEventListener("resize", () => { moveTabInd(); $("#segTaille") && moveSegInd($("#segTaille")); });
addEventListener("scroll", () => $(".top").classList.toggle("scrolled", scrollY > 4), { passive: true });
$("#lockForm").addEventListener("submit", unlock);
document.fonts?.ready.then(moveTabInd);
initTips();

(async () => {
  const data = await tryStoredKey();
  if (data) start(data);
  else { $("#lock").hidden = false; $("#pw").focus(); }
})();
