"use strict";

// ntfy.sh keeps messages 12 hours: everything read is copied here so the history survives on this device.
const STORE = "hw.admin.events";
const KEY_STORE = "hw.admin.key";
const MY_IPS = "hw.admin.myips";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const PAGE = { "#/accueil": "Accueil", "#/prospects": "Prospects", "#/calendrier": "Calendrier", "#/assistant": "Assistant", "#/methode": "Méthode" };

let CFG = null, PRIV = null;
let events = JSON.parse(localStorage.getItem(STORE) || "{}");
let myIps = JSON.parse(localStorage.getItem(MY_IPS) || "[]");
let site = "";

async function decryptCfg(key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(ENC.iv) }, key, b64(ENC.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function deriveKey(pw) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(ENC.salt), iterations: ENC.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function open(cfg) {
  CFG = cfg;
  PRIV = await crypto.subtle.importKey("jwk", cfg.key, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  localStorage.setItem("hw.me", "1"); // this browser is yours: its future visits are marked as yours on every site
  $("#lock").hidden = true;
  $("#app").hidden = false;
  $("#note").innerHTML = `Ce navigateur est marqué comme <b>le vôtre</b> : vos visites depuis lui sont grisées. ntfy.sh ne garde les signaux que <b>12 heures</b> ; l'historique est conservé sur cet appareil à chaque ouverture de cette page. Pour être prévenu en direct sur téléphone, installez l'app <b>ntfy</b> et abonnez-vous au sujet <code>${esc(cfg.topic)}</code> (vous verrez « Mandat : ouverture », « code saisi »…).`;
  fetch("https://get.geojs.io/v1/ip/geo.json").then((r) => r.json()).then((g) => {
    if (g.ip && !myIps.includes(g.ip)) { myIps.push(g.ip); localStorage.setItem(MY_IPS, JSON.stringify(myIps)); render(); }
  }).catch(() => {});
  await poll();
  live();
}

async function unseal(line) {
  const [w, iv, ct] = line.split(".");
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, PRIV, b64(w));
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) }, aes, b64(ct))));
}

async function ingest(msg) {
  if (msg.event !== "message" || events[msg.id]) return false;
  const sealed = (msg.message || "").split("\n")[1];
  if (!sealed) return false;
  try {
    events[msg.id] = { ...(await unseal(sealed)), ts: msg.time };
    return true;
  } catch { return false; }
}

async function poll() {
  try {
    const txt = await (await fetch(`https://ntfy.sh/${CFG.topic}/json?poll=1&since=all`)).text();
    for (const l of txt.split("\n").filter(Boolean)) await ingest(JSON.parse(l));
    localStorage.setItem(STORE, JSON.stringify(events));
  } catch { /* offline: keep what is stored */ }
  render();
}

function live() {
  const es = new EventSource(`https://ntfy.sh/${CFG.topic}/sse`);
  es.onopen = () => { $("#live").textContent = "En direct"; };
  es.onerror = () => { $("#live").textContent = "Reconnexion…"; };
  es.onmessage = async (e) => {
    if (await ingest(JSON.parse(e.data))) { localStorage.setItem(STORE, JSON.stringify(events)); render(); }
  };
}

const fmtDur = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`);

function visits() {
  const by = {};
  Object.values(events).forEach((e) => {
    const v = (by[e.i] ||= { sid: e.i, vid: e.v, site: e.s, start: e.ts, end: e.ts, dur: 0, unlock: false, pages: [], me: false, ip: e.ip, c: e.c, r: e.r, co: e.co, dv: e.dv, mb: e.mb, ref: e.ref });
    v.start = Math.min(v.start, e.ts);
    v.end = Math.max(v.end, e.ts);
    v.dur = Math.max(v.dur, e.t || 0, v.end - v.start);
    v.unlock ||= e.e === "unlock";
    v.me ||= !!e.me || (e.ip && myIps.includes(e.ip));
    const pg = PAGE[e.p] || (e.p && e.p.startsWith("#/") ? e.p.slice(2) : null);
    if (pg && !v.pages.includes(pg)) v.pages.push(pg);
    v.ip ||= e.ip; v.c ||= e.c;
  });
  const list = Object.values(by).sort((a, b) => b.start - a.start);
  const seen = {};
  [...list].reverse().forEach((v) => { seen[v.vid] = (seen[v.vid] || 0) + 1; v.nth = seen[v.vid]; });
  return list;
}

function render() {
  const all = visits();
  const sites = [...new Set(all.map((v) => v.site))].sort();
  const seg = $("#segSite");
  seg.innerHTML = `<span class="seg-ind"></span>` + [["", "Tous les sites"], ...sites.map((s) => [s, s])].map(([v, l]) => `<button type="button" data-site="${esc(v)}" aria-pressed="${site === v}">${esc(l)}</button>`).join("");
  requestAnimationFrame(() => { const on = seg.querySelector("[aria-pressed=true]"), ind = seg.querySelector(".seg-ind"); if (on) { ind.style.transform = `translateX(${on.offsetLeft - 3}px)`; ind.style.width = on.offsetWidth + "px"; } });
  const inSite = all.filter((v) => !site || v.site === site);
  const others = inSite.filter((v) => !v.me);
  const shown = $("#showMine").checked ? inSite : others;
  $("#sub").textContent = `${others.length} visite${others.length > 1 ? "s" : ""} d'autres personnes, ${inSite.length - others.length} de vous.`;
  $("#stats").innerHTML = [
    [others.length, "visites (hors vous)"],
    [new Set(others.map((v) => v.vid)).size, "visiteurs différents"],
    [others.filter((v) => v.unlock).length, "codes saisis"],
    [others.length ? fmtDur(Math.round(others.reduce((a, v) => a + v.dur, 0) / others.length)) : "0 s", "durée moyenne"],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
  $("#list").innerHTML = shown.map((v) => `<li class="visit ${v.me ? "mine" : ""}">
    <div><b>${esc(new Date(v.start * 1000).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }))}</b><span class="sub">${esc(new Date(v.start * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}</span></div>
    <div><b>${esc(v.site)}</b><span class="sub">${v.nth > 1 ? `${v.nth}e visite de ce visiteur` : "Premier passage"}</span></div>
    <div><b>${esc([v.c, v.r].filter(Boolean).join(", ") || "Lieu inconnu")}</b><span class="sub mono">${esc(v.ip || "IP inconnue")}${v.co ? ", " + esc(v.co) : ""}</span></div>
    <div><b>${esc(v.dv || "?")}</b><span class="sub">${v.mb ? "Téléphone" : "Ordinateur"}</span></div>
    <div><b>${fmtDur(v.dur)}</b><span class="sub">sur le site</span></div>
    <div class="tags">${v.me ? '<span class="pill">Vous</span>' : ""}${v.unlock ? '<span class="pill ok">Code saisi</span>' : '<span class="pill">Code non saisi</span>'}${v.pages.length ? `<span class="pages">${esc(v.pages.join(", "))}</span>` : ""}</div>
  </li>`).join("");
  $("#empty").hidden = shown.length > 0;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-site]");
  if (b) { site = b.dataset.site; render(); }
  if (e.target.closest("#refresh")) poll();
});
$("#showMine").addEventListener("change", render);
$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#lockBtn").classList.add("busy");
  try {
    const key = await deriveKey($("#pw").value.trim());
    const cfg = await decryptCfg(key);
    localStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", key)))));
    open(cfg);
  } catch {
    $("#lockBtn").classList.remove("busy");
    $("#lockErr").classList.add("on");
  }
});

(async () => {
  const raw = localStorage.getItem(KEY_STORE);
  if (raw) {
    try { return open(await decryptCfg(await crypto.subtle.importKey("raw", b64(raw), "AES-GCM", true, ["decrypt"]))); } catch { localStorage.removeItem(KEY_STORE); }
  }
  $("#pw").focus();
})();
