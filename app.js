"use strict";

const KEY_STORE = "mandat.key";
const TRACK_STORE = "mandat.suivi";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const STATUSES = [["appeler", "À appeler"], ["appele", "Appelé"], ["rappeler", "À rappeler"], ["devis", "Devis envoyé"], ["client", "Client"], ["ecarte", "Écarté"]];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const STATUS_TIP = {
  appeler: "Pas encore contacté.", appele: "Appel passé.", rappeler: "Il faut rappeler (absent, rappel demandé…).",
  devis: "Une proposition est partie.", client: "C'est signé.", ecarte: "Hors cible : la ligne passe en gris.",
};
const SIZE_ORDER = ["10-19", "20-49", "50-99", "100-199", "200-249", "250-499", "500-999", "1000-1999", "2000-4999", "5000-9999", "10000+"];
const WINDOW = 4; // months ahead that count as "call now"

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fmt = (n) => Number(n).toLocaleString("fr-FR");
const today = new Date();

let D = null;
let ROWS = [];
let track = JSON.parse(localStorage.getItem(TRACK_STORE) || "{}");
const state = { q: "", mois: "", secteur: "", taille: "", statut: "", canal: "", sort: "mois", dir: "asc" };
let exportScope = "sel";

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
  const btn = $("#lockBtn");
  btn.disabled = true;
  btn.textContent = "Ouverture…";
  try {
    const key = await deriveKey($("#pw").value.trim());
    const data = await decrypt(key);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    localStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...raw)));
    start(data);
  } catch {
    $("#lockErr").hidden = false;
    btn.disabled = false;
    btn.textContent = "Ouvrir la démo";
    $("#pw").select();
  }
}

/* ---------- Helpers ---------- */

const monthLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const monthsUntil = (m) => (+m.slice(0, 4) - today.getFullYear()) * 12 + (+m.slice(5) - 1 - today.getMonth());
const isSoon = (m) => monthsUntil(m) <= WINDOW;
function untilLabel(m) {
  const n = monthsUntil(m);
  if (n < 0) return "passé";
  if (n === 0) return "ce mois-ci";
  return `dans ${n} mois`;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const cityCase = (s) => s.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
const fmtTel = (t) => (t || "").replace(/(\d{2})(?=\d)/g, "$1 ");
const telHref = (t) => "tel:+33" + t.slice(1);
const siteUrl = (s) => (/^https?:/.test(s) ? s : "https://" + s);
const initials = (n) => n.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
const statusOf = (r) => track[r.siret]?.s || "appeler";
const noteOf = (r) => track[r.siret]?.n || "";
const big = (r) => SIZE_ORDER.indexOf(r.effectif) >= SIZE_ORDER.indexOf("50-99");
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function save(siret, patch) {
  track[siret] = { ...track[siret], ...patch };
  localStorage.setItem(TRACK_STORE, JSON.stringify(track));
}

let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 2200);
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Copie impossible sur ce navigateur"); }
}

/* ---------- Start and routing ---------- */

function start(data) {
  D = data;
  ROWS = data.rows;
  $("#lock").hidden = true;
  $("#app").hidden = false;
  $("#gen").textContent = new Date(data.generated).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  $("#navCount").textContent = ROWS.length;
  route();
}

const VIEWS = { tableau: viewDashboard, prospects: viewProspects, formations: viewFormations, assistant: viewAssistant, methode: viewMethod };

function route() {
  const [name, query] = location.hash.replace(/^#\/?/, "").split("?");
  const v = VIEWS[name] ? name : "tableau";
  if (query) new URLSearchParams(query).forEach((val, k) => { if (k in state) state[k] = val; });
  document.querySelectorAll("#nav a").forEach((a) => { if (a.dataset.view !== v) a.removeAttribute("aria-current"); else a.setAttribute("aria-current", "page"); });
  $(".rail").classList.remove("open");
  VIEWS[v]();
  $("#main").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- Dashboard ---------- */

function strip(months, { compact = false } = {}) {
  const map = Object.fromEntries(months);
  const all = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`);
  const max = Math.max(...all.map((m) => map[m] || 0));
  const inWin = all.map((m, i) => [i, monthsUntil(m)]).filter(([, n]) => n >= 0 && n <= WINDOW).map(([i]) => i);
  const win = inWin.length
    ? `<div class="win" style="left:calc(${inWin[0]} * (100% + var(--g)) / 12);width:calc(${inWin.length} * (100% + var(--g)) / 12 - var(--g))"><span>Fenêtre d'appel</span></div>` : "";
  return `<div class="strip">${win}${all.map((m) => {
    const n = map[m] || 0;
    const s1 = m <= "2027-06";
    return `<button class="mcol ${s1 ? "s1" : ""}" data-month="${m}" type="button" aria-pressed="${state.mois === m}"
      data-tip="${fmt(n)} établissements avec des élus devraient revoter en ${monthLabel(m)}, ${untilLabel(m)}.${inWin.includes(all.indexOf(m)) ? " C'est le moment d'appeler." : ""}${compact ? "" : " Cliquez pour voir les prospects de ce mois."}">
      <span class="n">${n >= 1000 ? (n / 1000).toFixed(1).replace(".", ",") + " k" : n}</span>
      <span class="bar" style="height:${Math.max(2, (n / max) * 100)}%"></span>
      <span class="m"><span class="full">${SHORT[+m.slice(5) - 1]}</span><span class="ab">${MONTHS[+m.slice(5) - 1][0].toUpperCase()}</span></span></button>`;
  }).join("")}</div>`;
}

function viewDashboard() {
  const st = D.stats;
  const withElus = st.total - st.sans;
  const ara = (st.regions.find(([r]) => r === D.region) || [0, 0])[1];
  const soonRows = ROWS.filter((r) => isSoon(r.mois));
  const funnel = [
    ["Établissements dont l'élection tombe en 2027", st.total],
    [D.txt.f2, withElus],
    ["… qui votent au 1er semestre 2027", st.s1_elus],
    [`… en ${D.region}`, ara],
    ["… enrichis dans cette démo", ROWS.length],
  ];
  const regMax = st.regions[0][1];
  const first = [...ROWS].filter((r) => statusOf(r) !== "ecarte").sort((a, b) => a.mois.localeCompare(b.mois) || b.inscrits - a.inscrits).slice(0, 7);
  $("#main").innerHTML = `
    <header class="view-head"><div>
      <h1>Élections CSE 2027</h1>
      <p>${D.txt.sub}</p>
    </div><a class="btn primary" href="#/prospects"><svg class="ic"><use href="#i-list"/></svg>Ouvrir les ${ROWS.length} prospects</a></header>
    <div class="kpis">
      <div class="kpi" data-tip="Établissements avec des élus en place dont le mandat se termine en 2027."><b>${fmt(withElus)}</b><span>CSE à renouveler en 2027</span></div>
      <div class="kpi" data-tip="${D.txt.kpi2}"><b>${fmt(st.s1_elus)}</b><span>au 1er semestre</span></div>
      <div class="kpi" data-tip="Salariés inscrits sur les listes électorales de ces établissements au dernier vote."><b>${fmt(st.s1_inscrits)}</b><span>électeurs concernés au 1er semestre</span></div>
      <div class="kpi gold" data-tip="Prospects de la démo dont l'élection tombe dans les ${WINDOW} prochains mois."><b>${soonRows.length}</b><span>prospects à appeler maintenant</span></div>
    </div>
    <div class="grid2">
      <section class="surface card">
        <h2>Quand ils revotent</h2>
        <p class="sub">Établissements avec élus, par mois d'élection estimé. La zone dorée est la fenêtre d'appel : l'élection se prépare un à trois mois avant.</p>
        ${strip(st.months)}
        <div class="strip-legend"><span><i style="background:var(--accent)"></i>1er semestre</span><span><i style="background:#C9D7D1"></i>2nd semestre</span></div>
      </section>
      <section class="surface card">
        <h2>Du fichier public à la liste d'appels</h2>
        <p class="sub">Chaque étape retire ceux qui ne sont pas des clients possibles.</p>
        <ol class="funnel">${funnel.map(([l, n]) => `<li><span class="lab">${esc(l)}</span><b>${fmt(n)}</b><span class="track"><span class="fill" style="transform:scaleX(${Math.max(0.006, n / st.total)})"></span></span></li>`).join("")}</ol>
      </section>
      <section class="surface card">
        <h2>Où, au 1er semestre</h2>
        <p class="sub">Établissements avec élus par région. La démo couvre ${esc(D.region)}.</p>
        <ul class="regions">${st.regions.filter(([r]) => r !== "Outre-mer").map(([r, n]) => `<li class="${r === D.region ? "on" : ""}"><span>${esc(r)}</span><span class="rb"><i style="width:${(n / regMax) * 100}%"></i></span><b>${fmt(n)}</b></li>`).join("")}</ul>
      </section>
      <section class="surface card">
        <h2>À appeler en premier</h2>
        <p class="sub">Les élections les plus proches, les plus gros CSE d'abord.</p>
        <ul class="next">${first.map((r) => `<li><button type="button" data-open="${r.siret}">
          <span class="when">${SHORT[+r.mois.slice(5) - 1]} ${r.mois.slice(0, 4)}</span>
          <span class="who"><b>${esc(r.entreprise)}</b><span>${esc(cityCase(r.ville))} · ${esc(r.secteur)}</span></span>
          <span class="n" data-tip="Électeurs inscrits au dernier vote.">${r.inscrits} élect.</span></button></li>`).join("")}</ul>
      </section>
    </div>`;
  requestAnimationFrame(() => document.querySelectorAll(".fill").forEach((f) => f.animate([{ transform: "scaleX(0)" }, { transform: f.style.transform }], { duration: 900, easing: "cubic-bezier(.16,1,.3,1)" })));
}

/* ---------- Prospects ---------- */

function filtered(ignoreFilters = false) {
  const q = norm(state.q.trim());
  const rows = ROWS.filter((r) => ignoreFilters || (
    (!q || norm(`${r.entreprise} ${r.ville} ${r.cp} ${r.secteur} ${r.dirigeant} ${r.elus.map((e) => e.nom).join(" ")}`).includes(q))
    && (!state.mois || r.mois === state.mois)
    && (!state.secteur || r.secteur === state.secteur)
    && (!state.taille || (state.taille === "50" ? big(r) : !big(r)))
    && (!state.statut || statusOf(r) === state.statut)
    && (!state.canal || (state.canal === "tel" ? r.tel : state.canal === "email" ? r.email : r.site))));
  const k = state.sort, dir = state.dir === "asc" ? 1 : -1;
  return rows.sort((a, b) => (k === "inscrits" ? a.inscrits - b.inscrits : String(a[k]).localeCompare(String(b[k]))) * dir || a.mois.localeCompare(b.mois));
}

const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;

function viewProspects() {
  const months = [...new Set(ROWS.map((r) => r.mois))].sort();
  const sectors = [...new Set(ROWS.map((r) => r.secteur))].sort();
  $("#main").innerHTML = `
    <header class="view-head"><div>
      <h1>Prospects · ${esc(D.region)}</h1>
      <p>${ROWS.length} établissements qui revotent au 1er semestre 2027, avec le contact de l'entreprise. Cliquez une ligne pour ouvrir sa fiche.</p>
    </div></header>
    <div class="toolbar">
      <label class="search" data-tip="Nom, ville, code postal, secteur ou nom d'un élu. Raccourci : touche /"><svg class="ic"><use href="#i-search"/></svg>
        <input id="q" type="search" placeholder="Rechercher" value="${esc(state.q)}" aria-label="Rechercher"></label>
      <select id="fMois" aria-label="Mois" data-tip="Ne garder qu'un mois d'élection.">${opt("", "Tous les mois", state.mois)}${months.map((m) => opt(m, capital(monthLabel(m)), state.mois)).join("")}</select>
      <select id="fSecteur" aria-label="Secteur" data-tip="Secteur d'activité, déduit du code NAF officiel.">${opt("", "Tous les secteurs", state.secteur)}${sectors.map((s) => opt(s, s, state.secteur)).join("")}</select>
      <select id="fTaille" aria-label="Taille" data-tip="Dès 50 salariés, les titulaires ont droit à la formation économique en plus de la SSCT.">${opt("", "Toutes tailles", state.taille)}${opt("50", "50 salariés et plus", state.taille)}${opt("moins", "Moins de 50", state.taille)}</select>
      <select id="fStatut" aria-label="Suivi" data-tip="Filtrer selon votre suivi.">${opt("", "Tout le suivi", state.statut)}${STATUSES.map(([v, l]) => opt(v, l, state.statut)).join("")}</select>
      <select id="fCanal" aria-label="Canal" data-tip="Ne garder que ceux qu'on peut joindre par ce canal.">${opt("", "Tous les canaux", state.canal)}${opt("tel", "Avec standard", state.canal)}${opt("email", "Avec email", state.canal)}${opt("site", "Avec site web", state.canal)}</select>
      <span class="spacer"></span>
      <button class="btn" id="copyTels" type="button" data-tip="Copie les numéros affichés, un par ligne, pour une session d'appels."><svg class="ic"><use href="#i-phone"/></svg>Copier les numéros</button>
      <button class="btn primary" id="exportBtn" type="button" popovertarget="exportMenu" data-tip="Télécharge les lignes affichées, avec votre suivi et vos notes."><svg class="ic"><use href="#i-down"/></svg>Exporter</button>
      <div id="exportMenu" class="menu" popover role="menu">
        <button role="menuitem" data-exp="xlsx" data-tip="Une ligne par établissement.">Excel <span>.xlsx</span></button>
        <button role="menuitem" data-exp="csv" data-tip="Accepté par Excel, HubSpot, Pipedrive…">CSV pour CRM <span>.csv</span></button>
        <button role="menuitem" data-exp="vcf" data-tip="À ouvrir sur un téléphone : les standards s'ajoutent aux contacts.">Contacts téléphone <span>.vcf</span></button>
        <button role="menuitem" data-exp="ics" data-tip="Un rappel d'agenda trois mois avant chaque élection.">Rappels d'agenda <span>.ics</span></button>
        <button role="menuitem" data-exp="print" data-tip="Choisissez « Enregistrer en PDF » comme imprimante.">Imprimer ou PDF</button>
      </div>
    </div>
    <div class="chips" id="chips"></div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th scope="col"><button class="sort" data-sort="mois" data-tip="Mois estimé de la prochaine élection.">Élection</button></th>
        <th scope="col"><button class="sort" data-sort="entreprise">Établissement</button></th>
        <th scope="col" class="num col-size"><button class="sort" data-sort="inscrits" data-tip="Salariés inscrits au dernier vote : plus il y en a, plus le CSE compte d'élus à former.">Électeurs</button></th>
        <th scope="col" class="col-people"><span class="th" data-tip="${D.txt.noms_tip}">Élus CSE</span></th>
        <th scope="col"><span class="th" data-tip="Standard de l'entreprise : demandez le ou la secrétaire du CSE.">Standard</span></th>
        <th scope="col"><span class="th" data-tip="Votre suivi, enregistré sur cet appareil.">Suivi</span></th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table><div class="empty" id="empty" hidden><b>Aucun établissement ne correspond.</b>Élargissez un filtre ou videz la recherche.</div></div>`;
  const bind = (id, k) => $(id).addEventListener(id === "#q" ? "input" : "change", (e) => { state[k] = e.target.value; renderRows(); });
  [["#q", "q"], ["#fMois", "mois"], ["#fSecteur", "secteur"], ["#fTaille", "taille"], ["#fStatut", "statut"], ["#fCanal", "canal"]].forEach(([i, k]) => bind(i, k));
  renderRows();
}

function renderRows() {
  const rows = filtered();
  document.querySelectorAll(".sort").forEach((b) => (b.dataset.sort === state.sort ? b.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending") : b.removeAttribute("aria-sort")));
  $("#rows").innerHTML = rows.map((r) => {
    const s = statusOf(r);
    return `<tr data-siret="${r.siret}" class="${s === "ecarte" ? "dim" : ""}">
      <td><div class="when ${isSoon(r.mois) ? "soon" : ""}" data-tip="Élection estimée en ${monthLabel(r.mois)}.${isSoon(r.mois) ? " Dans la fenêtre d'appel." : ""}"><b>${capital(monthLabel(r.mois))}</b><span>${untilLabel(r.mois)}</span></div></td>
      <td><div class="co"><b>${esc(r.entreprise)}</b><span>${esc(cityCase(r.ville))} · ${esc(r.secteur)} · ${esc(r.effectif)} sal.</span></div></td>
      <td class="num col-size">${r.inscrits}</td>
      <td class="col-people"><span class="people" data-tip="Exemples fictifs : ${esc(r.elus.map((e) => `${e.nom}, ${e.role}`).join(" · "))}">${r.elus.map((e) => `<span class="avatar">${initials(e.nom)}</span>`).join("")}<span>${esc(r.elus[0].nom)}</span><span class="ex">exemple</span></span></td>
      <td>${r.tel ? `<span class="tel"><a class="mono" href="${telHref(r.tel)}" data-tip="Appeler le standard.">${fmtTel(r.tel)}</a>${r.tel_local ? "" : `<span class="hq" data-tip="Numéro hors de la région : probablement le standard du siège.">siège</span>`}<button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro" data-tip="Copier"><svg class="ic"><use href="#i-copy"/></svg></button></span>` : `<span class="none" data-tip="Pas de standard trouvé : voir email ou site dans la fiche.">Pas de standard</span>`}</td>
      <td><select class="status" data-s="${s}" data-siret="${r.siret}" aria-label="Suivi pour ${esc(r.entreprise)}">${STATUSES.map(([v, l]) => `<option value="${v}" ${v === s ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    </tr>`;
  }).join("");
  $("#empty").hidden = rows.length > 0;
  const labels = { mois: (v) => capital(monthLabel(v)), secteur: (v) => v, taille: (v) => (v === "50" ? "50 salariés et plus" : "Moins de 50"), statut: (v) => STATUS_LABEL[v], canal: (v) => ({ tel: "Avec standard", email: "Avec email", site: "Avec site" }[v]), q: (v) => `« ${v} »` };
  const active = Object.keys(labels).filter((k) => state[k]);
  $("#chips").innerHTML = `<span><b>${rows.length}</b> sur ${ROWS.length} établissements · <b>${rows.filter((r) => r.tel).length}</b> avec standard</span>`
    + active.map((k) => `<button class="chip" data-clear="${k}" type="button" aria-label="Retirer ce filtre">${esc(labels[k](state[k]))}<svg class="ic"><use href="#i-x"/></svg></button>`).join("");
}

/* ---------- Panel ---------- */

function openPanel(siret) {
  const r = ROWS.find((x) => x.siret === siret);
  if (!r) return;
  const s = statusOf(r);
  const soon = isSoon(r.mois);
  const line = `${r.entreprise}, ${cityCase(r.ville)}, élection CSE estimée ${monthLabel(r.mois)}${r.tel ? ", standard " + fmtTel(r.tel) : ""}`;
  const subject = encodeURIComponent("Élections du CSE et formation des élus");
  $("#panelBody").innerHTML = `
    <div class="p-head"><div><h2 id="pTitle">${esc(r.entreprise)}</h2><p>${esc(cityCase(r.ville))} · ${esc(r.secteur)}</p></div>
      <button class="btn icon ghost" data-close aria-label="Fermer" data-tip="Fermer (Échap)"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="p-when ${soon ? "" : "later"}"><b>Élection estimée en ${monthLabel(r.mois)}</b><span>${capital(untilLabel(r.mois))} · ${soon ? "dans la fenêtre d'appel, le vote se prépare maintenant" : "à rappeler avant l'organisation du vote"}</span></div>
    <section class="p-sec"><h3>Élus du CSE <span class="ex">exemples fictifs</span></h3>
      ${r.elus.map((e) => `<div class="person"><span class="avatar">${initials(e.nom)}</span><div><b>${esc(e.nom)}</b><span>${esc(e.role)}</span></div></div>`).join("")}
      <p class="muted" style="font-size:var(--t-xs);margin:6px 0 0">${D.txt.noms}</p></section>
    <section class="p-sec"><h3>Contact de l'entreprise</h3>
      ${r.tel ? `<div class="p-row"><svg class="ic"><use href="#i-phone"/></svg><span class="v"><a class="mono" href="${telHref(r.tel)}">${fmtTel(r.tel)}</a> <span class="muted">${r.tel_local ? "standard" : "standard, probablement le siège"}</span></span><button class="mini" data-copy="${r.tel}" aria-label="Copier le numéro"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
      ${r.email ? `<div class="p-row"><svg class="ic"><use href="#i-mail"/></svg><span class="v"><a href="mailto:${esc(r.email)}?subject=${subject}" data-tip="Ouvre votre messagerie avec un objet déjà rempli.">${esc(r.email)}</a></span><button class="mini" data-copy="${esc(r.email)}" aria-label="Copier l'email"><svg class="ic"><use href="#i-copy"/></svg></button></div>` : ""}
      ${r.site ? `<div class="p-row"><svg class="ic"><use href="#i-globe"/></svg><span class="v"><a href="${esc(siteUrl(r.site))}" target="_blank" rel="noopener">${esc(r.site)}</a></span></div>` : ""}
      ${r.adresse ? `<div class="p-row"><svg class="ic"><use href="#i-pin"/></svg><span class="v"><a href="https://www.google.com/maps/search/${encodeURIComponent(r.adresse)}" target="_blank" rel="noopener">${esc(r.adresse)}</a></span></div>` : ""}
    </section>
    <section class="p-sec"><h3>Mon suivi</h3>
      <div class="seg">${STATUSES.map(([v, l]) => `<button type="button" data-st="${v}" data-siret="${r.siret}" aria-pressed="${v === s}" data-tip="${STATUS_TIP[v]}">${l}</button>`).join("")}</div></section>
    <section class="p-sec"><h3><label for="note">Notes</label></h3>
      <textarea id="note" data-siret="${r.siret}" placeholder="Ex. secrétaire du CSE absente, rappeler mardi matin">${esc(noteOf(r))}</textarea></section>
    <section class="p-sec"><h3>Formations à proposer <span class="ex">maquette</span></h3>
      <div class="trainings">
        <div class="training"><b>SSCT · santé, sécurité, conditions de travail</b><span>Tous les élus · 5 jours au premier mandat · payée par l'employeur</span><button class="btn" data-mock>Préparer un devis</button></div>
        ${big(r) ? `<div class="training"><b>Formation économique</b><span>Titulaires, dès 50 salariés · budget du CSE</span><button class="btn" data-mock>Préparer un devis</button></div>` : ""}
        <div class="training"><b>Référent harcèlement</b><span>L'élu désigné par le CSE</span><button class="btn" data-mock>Préparer un devis</button></div>
      </div></section>
    <section class="p-sec"><h3>Fiche</h3><dl class="facts">
      <dt>Électeurs inscrits</dt><dd>${r.inscrits}</dd>
      <dt>Effectif</dt><dd>${esc(r.effectif)} salariés</dd>
      ${r.dirigeant ? `<dt data-tip="Dirigeant déclaré au registre officiel (donnée publique).">Dirigeant publié</dt><dd>${esc(r.dirigeant)}</dd>` : ""}
      <dt>Code NAF</dt><dd>${esc(r.naf)}</dd>
      <dt>SIRET</dt><dd class="mono">${r.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4")}</dd></dl></section>
    <div class="p-actions">
      <button class="btn" data-copy="${esc(line)}" data-tip="Résumé en une ligne."><svg class="ic"><use href="#i-copy"/></svg>Copier la fiche</button>
      <button class="btn" data-ics="${r.siret}" data-tip="Rappel trois mois avant l'élection."><svg class="ic"><use href="#i-cal"/></svg>Rappel agenda</button>
      <a class="btn" href="https://annuaire-entreprises.data.gouv.fr/etablissement/${r.siret}" target="_blank" rel="noopener" data-tip="Fiche publique sur l'annuaire officiel de l'État."><svg class="ic"><use href="#i-ext"/></svg>Fiche officielle</a>
    </div>`;
  const p = $("#panel");
  if (!p.open) p.showModal();
}

/* ---------- Formations (mock) ---------- */

function viewFormations() {
  const bigRows = ROWS.filter(big);
  const byMonth = Object.entries(ROWS.reduce((a, r) => ((a[r.mois] = (a[r.mois] || 0) + 1), a), {})).sort();
  $("#main").innerHTML = `
    <header class="view-head"><div><h1>Formations</h1>
      <p>Chaque élection crée des élus qui doivent être formés. Cette vue relie les prospects aux formations du catalogue.</p></div></header>
    <div class="banner"><svg class="ic"><use href="#i-grad"/></svg><p><b>Maquette.</b> Les chiffres viennent des ${ROWS.length} prospects de la démo ; le catalogue, les prix et les devis seraient ceux de Qualyz.</p></div>
    <div class="catalog">
      <section class="surface course"><h2>SSCT</h2><p>Santé, sécurité et conditions de travail. Obligatoire pour tous les élus, 5 jours au premier mandat, payée par l'employeur.</p><div class="big">${ROWS.length} <small>établissements concernés</small></div></section>
      <section class="surface course"><h2>Formation économique</h2><p>Lire les comptes et la stratégie de l'entreprise. Pour les titulaires dès 50 salariés, sur le budget du CSE.</p><div class="big">${bigRows.length} <small>établissements de 50 salariés et plus</small></div></section>
      <section class="surface course"><h2>Référent harcèlement</h2><p>Réagir face au harcèlement sexuel et aux agissements sexistes. Le CSE désigne un référent parmi ses membres.</p><div class="big">${ROWS.length} <small>référents à former</small></div></section>
    </div>
    <section class="surface card"><h2>Quand vendre</h2><p class="sub">Les nouveaux élus se forment dans les mois qui suivent le vote. Ici, le nombre d'établissements qui votent chaque mois : autant de sessions à remplir juste après.</p>
      ${strip(byMonth, { compact: true })}</section>`;
}

/* ---------- Assistant (rule-based mock over the data) ---------- */

const SUGGESTIONS = ["Qui vote en mars ?", "Les plus gros CSE", "Établissements à Lyon", "Santé et médico-social", "Lesquels ont un email ?", "Combien à appeler maintenant ?"];

function answer(qRaw) {
  const q = norm(qRaw);
  const list = (rows, n = 6) => `<ul>${rows.slice(0, n).map((r) => `<li><a data-open="${r.siret}">${esc(r.entreprise)}</a> · ${esc(cityCase(r.ville))} · ${monthLabel(r.mois)} · ${r.inscrits} électeurs</li>`).join("")}</ul>${rows.length > n ? `<p class="muted">… et ${rows.length - n} autres, à voir dans Prospects.</p>` : ""}`;
  const mi = MONTHS.findIndex((m) => q.includes(norm(m)));
  if (mi >= 0) {
    const m = `2027-${String(mi + 1).padStart(2, "0")}`;
    const rows = ROWS.filter((r) => r.mois === m).sort((a, b) => b.inscrits - a.inscrits);
    const nat = (D.stats.months.find(([k]) => k === m) || [0, 0])[1];
    return rows.length ? `<b>${rows.length} prospects</b> de la démo votent en ${monthLabel(m)} (${fmt(nat)} dans toute la France). Les plus gros :${list(rows)}` : `Aucun prospect de la démo ne vote en ${monthLabel(m)}. Dans toute la France : ${fmt(nat)} établissements.`;
  }
  if (/gros|grand|plus d.electeurs|important/.test(q)) return `Les CSE avec le plus d'électeurs, donc le plus d'élus à former :${list([...ROWS].sort((a, b) => b.inscrits - a.inscrits))}`;
  if (/email|mail/.test(q)) { const r = ROWS.filter((x) => x.email); return `<b>${r.length}</b> établissements ont un email générique :${list(r)}`; }
  if (/maintenant|urgent|bientot|priorit|fenetre/.test(q)) { const r = ROWS.filter((x) => isSoon(x.mois)); return `<b>${r.length}</b> prospects votent dans les ${WINDOW} prochains mois : c'est le moment d'appeler.${list(r.sort((a, b) => a.mois.localeCompare(b.mois)))}`; }
  const sec = [...new Set(ROWS.map((r) => r.secteur))].find((s) => norm(s).split(/[ ,]+/).some((w) => w.length > 4 && q.includes(w)));
  if (sec) { const r = ROWS.filter((x) => x.secteur === sec); return `<b>${r.length}</b> établissements en ${esc(sec.toLowerCase())} :${list(r)}`; }
  const city = [...new Set(ROWS.map((r) => norm(r.ville).replace(/ \d+$/, "")))].find((c) => c.length > 2 && q.includes(c));
  if (city) { const r = ROWS.filter((x) => norm(x.ville).startsWith(city)); return `<b>${r.length}</b> établissements à ${esc(cityCase(city))} :${list(r)}`; }
  if (/combien|total|resume/.test(q)) return `La démo compte <b>${ROWS.length} prospects</b> en ${esc(D.region)}, dont ${ROWS.filter((r) => r.tel).length} avec standard. En France, <b>${fmt(D.stats.s1_elus)}</b> établissements avec élus revotent au 1er semestre 2027.`;
  return "Je réponds pour l'instant aux questions sur les prospects : un mois, une ville, un secteur, les plus gros CSE, ceux à appeler maintenant. Branché sur un modèle d'IA, cet assistant répondrait aussi aux questions juridiques des élus, avec les sources.";
}

function viewAssistant() {
  $("#main").innerHTML = `
    <header class="view-head"><div><h1>Assistant</h1><p>Posez une question en français sur vos prospects.</p></div></header>
    <div class="banner"><svg class="ic"><use href="#i-chat"/></svg><p><b>Maquette.</b> Les réponses sont calculées sur les données de la démo, sans modèle d'IA. La version réelle répondrait aussi aux questions des élus (droit du CSE, budgets, consultations), avec les sources.</p></div>
    <section class="surface chatbox"><div class="msgs" id="msgs" aria-live="polite">
      <div class="msg bot">Bonjour. Je connais les ${ROWS.length} prospects de la démo. Essayez une des questions ci-dessous.</div></div>
      <div><div class="suggest">${SUGGESTIONS.map((s) => `<button type="button" data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <form class="composer" id="ask"><input id="askIn" placeholder="Ex. qui vote en avril à Grenoble ?" aria-label="Votre question" autocomplete="off"><button class="btn primary icon" aria-label="Envoyer"><svg class="ic"><use href="#i-send"/></svg></button></form></div>
    </section>`;
  $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#askIn").value); $("#askIn").value = ""; });
}

function ask(q) {
  if (!q.trim()) return;
  const box = $("#msgs");
  box.insertAdjacentHTML("beforeend", `<div class="msg me">${esc(q)}</div><div class="msg bot">${answer(q)}</div>`);
  box.scrollTop = box.scrollHeight;
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
  ].map(([n, l]) => `<li><b>${fmt(n)}</b><span>${esc(l)}</span></li>`).join("");
}

/* ---------- Exports ---------- */

function exportRows() {
  const rows = exportScope === "all" ? filtered(true) : filtered();
  return rows.map((r) => ({
    "Élection estimée": monthLabel(r.mois), "Mois (AAAA-MM)": r.mois, "Entreprise": r.entreprise, "Ville": cityCase(r.ville),
    "Code postal": r.cp, "Adresse": r.adresse, "Secteur": r.secteur, "NAF": r.naf, "Effectif": r.effectif, "Électeurs inscrits": r.inscrits,
    "Standard": fmtTel(r.tel), "Email": r.email, "Site": r.site, "Dirigeant publié": r.dirigeant,
    "Élus (exemples fictifs)": r.elus.map((e) => `${e.nom} (${e.role})`).join(" ; "),
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
    const y = +r.mois.slice(0, 4), m = +r.mois.slice(5);
    const t = y * 12 + m - 1 - 3;
    const d = `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}01`;
    return ["BEGIN:VEVENT", `UID:${r.siret}@mandat`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${vEsc(`Appeler ${r.entreprise} (élection CSE ${monthLabel(r.mois)})`)}`,
      `DESCRIPTION:${vEsc(`${cityCase(r.ville)}. Standard ${fmtTel(r.tel) || "non trouvé"}. ${r.inscrits} électeurs.`)}`, "END:VEVENT"].join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mandat//FR", ...ev, "END:VCALENDAR"].join("\r\n");
}

function doExport(kind) {
  const name = `mandat-prospects-${new Date().toISOString().slice(0, 10)}`;
  const rows = exportRows();
  if (kind === "print") return window.print();
  if (kind === "csv") {
    const head = Object.keys(rows[0] || {});
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return download("﻿" + [head.map(cell).join(";"), ...rows.map((r) => head.map((h) => cell(r[h])).join(";"))].join("\r\n"), name + ".csv", "text/csv");
  }
  if (kind === "xlsx") {
    if (!window.XLSX) return toast("Excel se charge, réessayez dans une seconde");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prospects");
    return XLSX.writeFile(wb, name + ".xlsx");
  }
  const src = filtered();
  if (kind === "vcf") return download(src.filter((r) => r.tel).map((r) => ["BEGIN:VCARD", "VERSION:3.0", `FN:${vEsc(r.entreprise)}`, `ORG:${vEsc(r.entreprise)}`, `TEL;TYPE=WORK:${r.tel}`, r.email ? `EMAIL:${r.email}` : "", `NOTE:${vEsc(`Élection CSE estimée ${monthLabel(r.mois)}`)}`, "END:VCARD"].filter(Boolean).join("\r\n")).join("\r\n"), name + ".vcf", "text/vcard");
  if (kind === "ics") return download(icsFor(src), name + ".ics", "text/calendar");
}

/* ---------- Tooltip ---------- */

function initTips() {
  const tip = $("#tip");
  let cur = null;
  const show = (el) => {
    cur = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + t.height > innerHeight - 8) top = r.top - t.height - 8;
    tip.style.top = top + "px";
    tip.style.left = Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2)) + "px";
  };
  document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el) { tip.hidden = true; cur = null; } });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el && e.target.matches(":focus-visible")) show(el); });
  document.addEventListener("focusout", () => { tip.hidden = true; cur = null; });
  addEventListener("scroll", () => { tip.hidden = true; cur = null; }, true);
}

/* ---------- Events ---------- */

document.addEventListener("click", (e) => {
  const t = e.target;
  const c = t.closest("[data-copy]");
  if (c) { e.stopPropagation(); return copy(c.dataset.copy, "Copié"); }
  const o = t.closest("[data-open]");
  if (o) return openPanel(o.dataset.open);
  const m = t.closest(".mcol");
  if (m && !location.hash.startsWith("#/formations")) { Object.assign(state, { mois: m.dataset.month }); location.hash = "#/prospects"; if (location.hash === "#/prospects") route(); return; }
  const srt = t.closest("[data-sort]");
  if (srt) { state.dir = state.sort === srt.dataset.sort && state.dir === "asc" ? "desc" : "asc"; state.sort = srt.dataset.sort; return renderRows(); }
  const ch = t.closest("[data-clear]");
  if (ch) { state[ch.dataset.clear] = ""; return viewProspects(); }
  const ex = t.closest("[data-exp]");
  if (ex) { $("#exportMenu").hidePopover?.(); return doExport(ex.dataset.exp); }
  if (t.closest("#copyTels")) { const tels = filtered().filter((r) => r.tel).map((r) => fmtTel(r.tel)); return copy(tels.join("\n"), `${tels.length} numéros copiés`); }
  const st = t.closest("[data-st]");
  if (st) { save(st.dataset.siret, { s: st.dataset.st }); document.querySelectorAll("[data-st]").forEach((b) => b.setAttribute("aria-pressed", b === st)); if ($("#rows")) renderRows(); return; }
  const ic = t.closest("[data-ics]");
  if (ic) { const r = ROWS.find((x) => x.siret === ic.dataset.ics); return download(icsFor([r]), `rappel-${r.siret}.ics`, "text/calendar"); }
  if (t.closest("[data-mock]")) return toast("Maquette : le devis serait généré depuis le catalogue Qualyz");
  if (t.closest("[data-close]")) return $("#panel").close();
  const ak = t.closest("[data-ask]");
  if (ak) return ask(ak.dataset.ask);
  if (t.closest("#logout")) { localStorage.removeItem(KEY_STORE); return location.reload(); }
  if (t.closest("#railToggle")) { const r = $(".rail"); r.classList.toggle("open"); return $("#railToggle").setAttribute("aria-expanded", r.classList.contains("open")); }
  const tr = t.closest("tbody tr");
  if (tr && !t.closest("select, a, button")) openPanel(tr.dataset.siret);
});

document.addEventListener("change", (e) => {
  if (e.target.matches("select.status")) { save(e.target.dataset.siret, { s: e.target.value }); renderRows(); }
});
document.addEventListener("input", (e) => { if (e.target.id === "note") save(e.target.dataset.siret, { n: e.target.value }); });
$("#panel").addEventListener("click", (e) => { if (e.target.id === "panel") $("#panel").close(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.matches("input, textarea, select") && $("#q")) { e.preventDefault(); $("#q").focus(); }
});
addEventListener("hashchange", route);
$("#lockForm").addEventListener("submit", unlock);
initTips();

(async () => {
  const data = await tryStoredKey();
  if (data) start(data);
  else { $("#lock").hidden = false; $("#pw").focus(); }
})();
