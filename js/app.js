import { TEAMS, logoHTML } from "./teams.js";
import { dataUrl } from "./config.js";
import { indexInjuries, injuryFor, injuryLabel, rosterSectionHTML, playerPanelHTML } from "./players.js";
import { mountPropView, unmountPropView, setStat, presetLine } from "./propview.js";
import { parlaysHTML, dayParlaysHTML, myLegs, findLeg } from "./parlayview.js";
import { live, startLive } from "./live.js";
import { trackingHTML } from "./trackview.js";

const DATA_URL = dataUrl("fixture.json");
const REFRESH_MS = 10 * 60 * 1000;     // vuelve a leer los datos cada 10 min
const GAME_LENGTH_MS = 3 * 60 * 60 * 1000; // ~duración de un partido para marcar "en juego"
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // zona horaria del visitante (horas)
// Las jornadas se agrupan por fecha NBA (hora de EE.UU. Este), como en las casas de apuestas:
// así un partido de las 00:30 en Chile sigue apareciendo en la jornada del día anterior.
const SLATE_TZ = "America/New_York";
const STALE_MS = 14 * 60 * 60 * 1000; // si los datos tienen más de esto, se avisa
let liveCtl = null;

const $ = (s, el = document) => el.querySelector(s);

const state = {
  games: [],
  updated: null,
  byId: new Map(),
  team: "ALL",
  status: "all",
  selectedId: null,
  weekStart: null,     // lunes (clave YYYY-MM-DD) de la semana visible en la tira
  activeDay: null,     // día visible arriba en la lista
  stats: {},
  injIdx: null,        // lesionados indexados por id y nombre
  model: null,         // rendimiento del modelo de parlays (data/model.json)
  tracking: null,      // registro real de picks (data/tracking.json)
  teamCache: new Map(),// abreviatura -> datos de data/players/XXX.json
  playerId: null,      // jugador abierto en la columna derecha
  query: "",           // búsqueda en la columna de plantillas
  dayView: null,       // fecha (YYYY-MM-DD) cuando se muestran los parlays del día
};

/* ================= Utilidades de fecha ================= */
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: SLATE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayKey = (d) => keyFmt.format(d);
const todayKey = () => dayKey(new Date());

// Fecha "de calendario" a partir de una clave (mediodía UTC para evitar saltos de zona)
const keyToDate = (k) => new Date(k + "T12:00:00Z");
const addDays = (k, n) => { const d = keyToDate(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (k) => { const dow = (keyToDate(k).getUTCDay() + 6) % 7; return addDays(k, -dow); };

function longDay(k) {
  const s = keyToDate(k).toLocaleDateString("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  return s.replace(",", "");
}
const shortDow = (k) => keyToDate(k).toLocaleDateString("es-CL", { timeZone: "UTC", weekday: "short" }).replace(".", "").toUpperCase();

/* ================= Datos ================= */
async function loadData() {
  const [res, injRes, modelRes] = await Promise.all([
    fetch(DATA_URL, { cache: "no-cache" }),
    fetch(dataUrl("injuries.json"), { cache: "no-cache" }).catch(() => null),
    fetch(dataUrl("model.json"), { cache: "no-cache" }).catch(() => null),
  ]);
  fetch(dataUrl("tracking.json"), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((t) => { state.tracking = t; if (state.dayView === "registro") renderSelection(); });
  try { state.model = modelRes && modelRes.ok ? await modelRes.json() : null; } catch { state.model = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  try { state.injIdx = indexInjuries(injRes && injRes.ok ? await injRes.json() : {}); }
  catch { state.injIdx = indexInjuries({}); }
  state.updated = json.updated ? new Date(json.updated) : null;
  state.games = json.games
    .map((g) => ({ ...g, start: new Date(g.date) }))
    .sort((a, b) => a.start - b.start || a.id - b.id);
  state.games.forEach((g) => (g.day = dayKey(g.start)));
  state.byId = new Map(state.games.map((g) => [g.id, g]));
  applyLive();
}

// Resultados que llegan del marcador en vivo antes que el robot los guarde
function applyLive() {
  for (const g of state.games) {
    const L = live.games.get(g.id);
    if (L?.state === "post" && g.hs == null && Number.isFinite(L.hs)) { g.hs = L.hs; g.as = L.as; g.fromLive = true; }
  }
  state.stats = buildStats(state.games);
}

function gameStatus(g, now = Date.now()) {
  if (g.hs != null && g.as != null) return "final";
  const L = live.games.get(g.id);
  if (L?.state === "in") return "live";
  if (L?.state === "pre") return "upcoming";
  const t = g.start.getTime();
  if (now < t) return "upcoming";
  if (now < t + GAME_LENGTH_MS) return "live";
  return "pending"; // ya debería haber terminado pero aún no llega el resultado
}

// Récords y tendencias por equipo, calculados solo con los resultados del calendario
function buildStats(games) {
  const s = {};
  const blank = () => ({ w: 0, l: 0, hw: 0, hl: 0, aw: 0, al: 0, pf: 0, pa: 0, gp: 0, seq: [] });
  for (const g of games) {
    if (g.hs == null) continue;
    for (const side of ["home", "away"]) {
      const abbr = g[side];
      if (abbr === "TBD") continue;
      const t = (s[abbr] ||= blank());
      const pf = side === "home" ? g.hs : g.as;
      const pa = side === "home" ? g.as : g.hs;
      const won = pf > pa;
      t.gp++; t.pf += pf; t.pa += pa;
      won ? t.w++ : t.l++;
      if (side === "home") won ? t.hw++ : t.hl++; else won ? t.aw++ : t.al++;
      t.seq.push(won ? "W" : "L");
    }
  }
  for (const t of Object.values(s)) {
    let streak = 0;
    const last = t.seq.at(-1);
    for (let i = t.seq.length - 1; i >= 0 && t.seq[i] === last; i--) streak++;
    t.streak = last ? `${last === "W" ? "G" : "P"}${streak}` : "-";
  }
  return s;
}
const rec = (abbr) => { const t = state.stats[abbr]; return t ? `${t.w}-${t.l}` : "0-0"; };
const formHTML = (abbr, n = 5) => {
  const t = state.stats[abbr];
  if (!t || !t.seq.length) return `<span class="muted">—</span>`;
  return `<span class="form">${t.seq.slice(-n).map((r) => `<i class="${r === "W" ? "w" : "l"}">${r === "W" ? "G" : "P"}</i>`).join("")}</span>`;
};

/* ================= Filtros ================= */
function visibleGames() {
  return state.games.filter((g) => {
    if (state.team !== "ALL" && g.home !== state.team && g.away !== state.team) return false;
    if (state.status === "final") return gameStatus(g) === "final";
    if (state.status === "upcoming") return gameStatus(g) !== "final";
    return true;
  });
}

/* ================= Render: lista ================= */
function gameCard(g) {
  const st = gameStatus(g);
  const final = st === "final";
  const awayWon = final && g.as > g.hs;
  const homeWon = final && g.hs > g.as;
  const side = (abbr, won, isFinal) => `
    <div class="side ${isFinal && !won ? "lost" : ""}">
      ${logoHTML(abbr, 34)}
      <span class="abbr">${abbr === "TBD" ? "TBD" : abbr}</span>
      ${isFinal ? "" : `<span class="rec">${abbr === "TBD" ? "&nbsp;" : rec(abbr)}</span>`}
    </div>`;

  let mid;
  const L = live.games.get(g.id);
  if (st === "live" && L?.state === "in") {
    const aLead = L.as > L.hs, hLead = L.hs > L.as;
    mid = `<div class="score live-score"><span class="${aLead ? "" : "l"}">${L.as}</span><span class="sep">–</span><span class="${hLead ? "" : "l"}">${L.hs}</span></div>
           <div class="state live">${L.detail || "EN JUEGO"}</div>`;
  } else if (final) {
    mid = `<div class="score"><span class="${awayWon ? "" : "l"}">${g.as}</span><span class="sep">–</span><span class="${homeWon ? "" : "l"}">${g.hs}</span></div>
           <div class="state">FINAL</div>`;
  } else {
    const label = st === "live" ? `<div class="state live">EN JUEGO</div>`
      : st === "pending" ? `<div class="state">SIN RESULTADO</div>` : `<div class="at">@</div>`;
    mid = `${st === "upcoming" ? label : ""}<div class="time">${timeFmt.format(g.start)}</div>${st !== "upcoming" ? label : ""}`;
  }
  const sel = g.id === state.selectedId ? "selected" : "";
  const title = `${TEAMS[g.away]?.name} @ ${TEAMS[g.home]?.name}`;
  return `<button class="game ${st} ${sel}" data-id="${g.id}" type="button" title="${title}">
      ${side(g.away, awayWon, final)}
      <div class="mid">${mid}<div class="venue">${g.venue || ""}</div></div>
      ${side(g.home, homeWon, final)}
    </button>`;
}

function renderList({ keepScroll = false } = {}) {
  const list = $("#calList");
  const prevScroll = list.scrollTop;
  const games = visibleGames();
  if (!games.length) {
    list.innerHTML = `<div class="empty">No hay partidos con estos filtros.</div>`;
    renderWeek();
    return;
  }
  const today = todayKey();
  const groups = new Map();
  for (const g of games) (groups.get(g.day) || groups.set(g.day, []).get(g.day)).push(g);

  let html = "";
  for (const [day, gs] of groups) {
    html += `<section class="day" data-day="${day}">
      <div class="day-head">${longDay(day)} ${day === today ? `<span class="tag-today">HOY</span>` : ""}
        <span class="cnt">${gs.length} ${gs.length === 1 ? "partido" : "partidos"}</span>
        <button type="button" class="dh-parlay" data-dayparlay="${day}" title="Parlays de esta jornada">🎯</button></div>
      ${gs.map(gameCard).join("")}
    </section>`;
  }
  list.innerHTML = html;
  if (keepScroll) list.scrollTop = prevScroll;
  updateActiveDay();
}

function scrollToDay(k, { smooth = false } = {}) {
  const list = $("#calList");
  const sections = [...list.querySelectorAll(".day")];
  if (!sections.length) return;
  // el día pedido o, si no tiene partidos, el siguiente que sí tenga (o el último)
  const target = sections.find((s) => s.dataset.day >= k) || sections.at(-1);
  list.scrollTo({ top: target.offsetTop, behavior: smooth ? "smooth" : "auto" });
  state.activeDay = target.dataset.day;
  state.weekStart = mondayOf(state.activeDay);
  renderWeek();
}

function updateActiveDay() {
  const list = $("#calList");
  const top = list.scrollTop + 4;
  let active = null;
  for (const s of list.querySelectorAll(".day")) {
    if (s.offsetTop <= top) active = s.dataset.day; else break;
  }
  active ||= list.querySelector(".day")?.dataset.day;
  if (active && active !== state.activeDay) {
    state.activeDay = active;
    const wk = mondayOf(active);
    if (wk !== state.weekStart) state.weekStart = wk;
    renderWeek();
  }
}

/* ================= Render: tira semanal ================= */
function renderWeek() {
  if (!state.weekStart) state.weekStart = mondayOf(todayKey());
  const counts = {};
  for (const g of visibleGames()) counts[g.day] = (counts[g.day] || 0) + 1;
  const today = todayKey();
  let html = "";
  for (let i = 0; i < 7; i++) {
    const k = addDays(state.weekStart, i);
    const c = counts[k] || 0;
    const cls = ["day-chip", c ? "" : "none", k === today ? "today" : "", k === state.activeDay ? "active" : ""].join(" ");
    html += `<button type="button" class="${cls}" data-day="${k}" ${c ? "" : "disabled"} title="${longDay(k)}">
      <span class="dw">${shortDow(k)}</span><span class="dn">${+k.slice(8)}</span>
      <span class="dc">${c || "—"}</span></button>`;
  }
  $("#weekDays").innerHTML = html;
}

/* ================= Render: equipo filtrado ================= */
function renderTeamStrip() {
  const el = $("#teamStrip");
  if (state.team === "ALL") { el.hidden = true; return; }
  const t = state.stats[state.team];
  el.hidden = false;
  el.innerHTML = `${logoHTML(state.team, 30)}
    <div><div class="tn">${TEAMS[state.team].name}</div>
    <div class="ts">${rec(state.team)} · Local ${t ? `${t.hw}-${t.hl}` : "0-0"} · Visita ${t ? `${t.aw}-${t.al}` : "0-0"} · Racha ${t?.streak ?? "-"}</div></div>
    ${formHTML(state.team, 5)}`;
}

/* ================= Render: partido seleccionado ================= */
function renderSelection() {
  if (state.dayView === "registro") { unmountPropView(); $("#matchup").innerHTML = trackingHTML(state.tracking); return; }
  if (state.dayView) { renderDayView(); return; }
  const g = state.byId.get(state.selectedId);
  const box = $("#matchup");
  if (!g) {
    box.innerHTML = `<div class="placeholder"><div class="ph-icon">🏀</div><p>Selecciona un partido del calendario.</p></div>`;
    return;
  }
  if (state.playerId) {
    const p = findPlayer(state.playerId);
    if (p) {
      box.innerHTML = playerPanelHTML(p, injuryFor(p, state.injIdx), g);
      const opp = p.team === g.home ? g.away : p.team === g.away ? g.home : null;
      mountPropView(box.querySelector("#propView"), p, opp && opp !== "TBD" ? opp : null);
      return;
    }
  }
  unmountPropView();

  const st = gameStatus(g);
  const A = state.stats[g.away], H = state.stats[g.home];
  const ppg = (t) => (t && t.gp ? t.pf / t.gp : null);
  const opp = (t) => (t && t.gp ? t.pa / t.gp : null);
  const f1 = (v) => (v == null ? "—" : v.toFixed(1));
  const net = (t) => (t && t.gp ? (t.pf - t.pa) / t.gp : null);
  const sign = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1));
  const better = (a, b, higher = true) => (a == null || b == null || a === b ? ["", ""] : (a > b) === higher ? ["better", ""] : ["", "better"]);

  const rows = [];
  const row = (label, a, b, cls = ["", ""]) => rows.push(`<tr><td class="${cls[0]}">${a}</td><td>${label}</td><td class="${cls[1]}">${b}</td></tr>`);
  const pct = (t) => (t && t.gp ? t.w / t.gp : null);
  row("Récord", rec(g.away), rec(g.home), better(pct(A), pct(H)));
  row("Visita / Local", A ? `${A.aw}-${A.al}` : "0-0", H ? `${H.hw}-${H.hl}` : "0-0");
  row("Pts anotados", f1(ppg(A)), f1(ppg(H)), better(ppg(A), ppg(H)));
  row("Pts recibidos", f1(opp(A)), f1(opp(H)), better(opp(A), opp(H), false));
  row("Diferencial", sign(net(A)), sign(net(H)), better(net(A), net(H)));
  row("Últimos 5", formHTML(g.away), formHTML(g.home));
  row("Racha", A?.streak ?? "-", H?.streak ?? "-");

  const h2h = state.games.filter((x) => x.hs != null && x.id !== g.id &&
    ((x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home)));

  const L = live.games.get(g.id);
  const lineTbl = L?.lines?.home?.length ? `<table class="linescore"><tr><th></th>${L.lines.home.map((_, i) => `<th>${i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>`).join("")}<th>T</th></tr>
      <tr><td>${g.away}</td>${L.lines.away.map((v) => `<td>${v}</td>`).join("")}<td><b>${L.as}</b></td></tr>
      <tr><td>${g.home}</td>${L.lines.home.map((v) => `<td>${v}</td>`).join("")}<td><b>${L.hs}</b></td></tr></table>` : "";
  const mid = st === "live" && L?.state === "in"
    ? `<div class="big live-big">${L.as} – ${L.hs}</div><div class="sub live-tag">● ${L.detail || "En vivo"}</div>${lineTbl}`
    : st === "final"
    ? `<div class="big">${g.as} – ${g.hs}</div><div class="sub">Final</div>${lineTbl}`
    : `<div class="big">${timeFmt.format(g.start)}</div><div class="sub">${longDay(g.day)}</div>`;

  box.innerHTML = `
    <div class="mu-head">
      <div class="mu-team">${logoHTML(g.away, 72)}<div class="nm">${TEAMS[g.away].short}</div><div class="rc">Visita · ${rec(g.away)}</div></div>
      <div class="mu-mid">${mid}<div class="sub">${g.venue || ""}</div></div>
      <div class="mu-team">${logoHTML(g.home, 72)}<div class="nm">${TEAMS[g.home].short}</div><div class="rc">Local · ${rec(g.home)}</div></div>
    </div>
    ${parlaysHTML({
      game: g, isFinal: st === "final", injIdx: state.injIdx,
      teams: { [g.away]: teamData(g.away), [g.home]: teamData(g.home) },
    }, state.model)}
    <div class="card"><h3>Comparativa de temporada</h3><table class="cmp">${rows.join("")}</table></div>
    <div class="card"><h3>Enfrentamientos esta temporada</h3>${
      h2h.length
        ? `<ul class="h2h">${h2h.map((x) => `<li><span>${x.away} ${x.as} – ${x.hs} ${x.home}</span><span class="d">${longDay(x.day)}</span></li>`).join("")}</ul>`
        : `<div class="muted">Aún no se han enfrentado esta temporada.</div>`
    }</div>
    ${injuriesCardHTML(g)}
    <p class="note">Toca un jugador en la columna de plantillas para ver su ficha.</p>`;
}

function injuriesCardHTML(g) {
  const all = state.injIdx ? [...state.injIdx.byName.values()] : [];
  const col = (abbr) => {
    const list = all.filter((i) => i.team === abbr).sort((a, b) => (a.status === b.status ? 0 : a.status === "red" ? -1 : 1));
    return `<div class="bajas-col"><div class="bajas-team">${logoHTML(abbr, 20)} ${abbr}</div>${
      list.length ? list.map((i) => `<div class="baja ${i.status}" title="${(i.comment || "").replace(/"/g, "&quot;")}">
        <span class="dot"></span><span class="bn">${i.name}</span><span class="bs">${injuryLabel(i)}</span></div>`).join("")
      : `<div class="muted">Sin bajas reportadas</div>`}</div>`;
  };
  return `<div class="card"><h3>Bajas y dudas</h3><div class="bajas">${col(g.away)}${col(g.home)}</div></div>`;
}

/* ================= Parlays del día ================= */
function dayGames(day) {
  return state.games.filter((g) => g.day === day && g.home !== "TBD" && g.away !== "TBD");
}

function selectTracking({ fromHash = false } = {}) {
  state.dayView = "registro";
  state.selectedId = null;
  state.playerId = null;
  myLegs.clear();
  document.querySelectorAll(".game.selected").forEach((b) => b.classList.remove("selected"));
  if (!fromHash) { try { history.replaceState(null, "", "#registro"); } catch { location.hash = "registro"; } }
  renderRoster();
  renderSelection();
  $(".col-analysis").scrollTop = 0;
  if (!fromHash && window.matchMedia("(max-width: 900px)").matches) $(".col-analysis").scrollIntoView({ behavior: "smooth" });
}

function selectDay(day, { fromHash = false } = {}) {
  state.dayView = day;
  state.selectedId = null;
  state.playerId = null;
  myLegs.clear();
  unmountPropView();
  document.querySelectorAll(".game.selected").forEach((b) => b.classList.remove("selected"));
  if (!fromHash) { try { history.replaceState(null, "", `#dia-${day}`); } catch { location.hash = `dia-${day}`; } }
  renderRoster();
  renderSelection();
  const teams = [...new Set(dayGames(day).flatMap((g) => [g.away, g.home]))];
  Promise.all(teams.map((t) => loadTeam(t))).then(() => { if (state.dayView === day) renderSelection(); });
  $(".col-analysis").scrollTop = 0;
  if (!fromHash && window.matchMedia("(max-width: 900px)").matches) $(".col-analysis").scrollIntoView({ behavior: "smooth" });
}

function renderDayView() {
  const day = state.dayView;
  const games = dayGames(day);
  const box = $("#matchup");
  const items = games.map((g) => ({
    game: g, isFinal: gameStatus(g) === "final",
    teams: { [g.away]: teamData(g.away), [g.home]: teamData(g.home) },
  }));
  const loading = items.some((it) => !it.teams[it.game.away] || !it.teams[it.game.home]);
  const label = longDay(day);
  box.innerHTML = `
    <div class="day-hero"><div class="big">🎯 ${label.charAt(0).toUpperCase() + label.slice(1)}</div>
      <div class="sub">${games.length ? `${games.length} partidos · ${games.map((g) => `${g.away}@${g.home}`).join(" · ")}` : "No hay partidos este día."}</div></div>
    ${games.length ? dayParlaysHTML({ dayLabel: label, items, injIdx: state.injIdx, loading }, state.model) : ""}`;
}

function setHash() {
  const h = `#g${state.selectedId}${state.playerId ? `-p${state.playerId}` : ""}`;
  try { history.replaceState(null, "", h); } catch { location.hash = h.slice(1); }
}

function selectGame(id, { fromHash = false, playerId = null } = {}) {
  const changed = id !== state.selectedId || !!state.dayView;
  if (changed && live.games.get(id)?.state === "in") setTimeout(() => liveCtl?.now(), 0); // trae su box score ya
  state.dayView = null;
  state.selectedId = id;
  state.playerId = playerId;
  if (changed) { state.query = ""; $("#rosterSearch").value = ""; myLegs.clear(); }
  document.querySelectorAll(".game.selected").forEach((b) => b.classList.remove("selected"));
  document.querySelector(`.game[data-id="${id}"]`)?.classList.add("selected");
  if (!fromHash) setHash();
  renderSelection();
  renderRoster();
  const g = state.byId.get(id);
  if (g) [g.away, g.home].forEach((t) => loadTeam(t).then(() => {
    if (state.selectedId !== id) return;
    renderRoster();
    renderSelection();
  }));
  if (changed) $("#rosterList").scrollTop = 0;
}

/* ================= Plantillas ================= */
function loadTeam(abbr, { force = false } = {}) {
  if (!abbr || abbr === "TBD") return Promise.resolve(null);
  const cached = state.teamCache.get(abbr);
  if (cached && !force) return cached instanceof Promise ? cached : Promise.resolve(cached);
  const pr = fetch(dataUrl(`players/${abbr}.json`), { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => ({ error: true, players: [] }))
    .then((d) => { state.teamCache.set(abbr, d); return d; });
  if (!cached || cached instanceof Promise) state.teamCache.set(abbr, pr);
  return pr;
}
const teamData = (abbr) => { const d = state.teamCache.get(abbr); return d instanceof Promise ? null : d; };

function findPlayer(pid) {
  const g = state.byId.get(state.selectedId);
  for (const t of g ? [g.away, g.home] : []) {
    const p = teamData(t)?.players?.find((x) => x.id === String(pid));
    if (p) return p;
  }
  return null;
}

function renderRoster() {
  const g = state.byId.get(state.selectedId);
  const head = $("#rosterHead"), list = $("#rosterList");
  if (!g) { head.innerHTML = ""; list.innerHTML = `<div class="pl-empty">Selecciona un partido.</div>`; return; }
  head.innerHTML = [[g.away, "Visita"], [g.home, "Local"]].map(([a, lbl]) =>
    `<button type="button" class="rt" data-jump="${a}">${logoHTML(a, 22)}<span>${a}</span><small>${lbl}</small></button>`).join("");
  const opts = { query: state.query, selectedId: state.playerId };
  list.innerHTML =
    rosterSectionHTML(g.away, teamData(g.away), state.injIdx, { ...opts, side: "Visita" }) +
    rosterSectionHTML(g.home, teamData(g.home), state.injIdx, { ...opts, side: "Local" });
}

function selectPlayer(pid) {
  state.playerId = pid;
  document.querySelectorAll(".pl.sel").forEach((b) => b.classList.remove("sel"));
  document.querySelector(`.pl[data-pid="${CSS.escape(pid)}"]`)?.classList.add("sel");
  setHash();
  renderSelection();
  $(".col-analysis").scrollTop = 0;
  // en el celular las columnas van una debajo de otra: llevamos la vista a la ficha
  if (window.matchMedia("(max-width: 900px)").matches) $(".col-analysis").scrollIntoView({ behavior: "smooth" });
}

/* ================= Encabezado ================= */
function renderMeta() {
  const upd = state.updated
    ? state.updated.toLocaleString("es-CL", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
  const played = state.games.filter((g) => g.hs != null).length;
  const stale = state.updated && Date.now() - state.updated > STALE_MS;
  const nLive = [...live.games.values()].filter((x) => x.state === "in").length;
  $("#meta").innerHTML = `${nLive ? `<span class="live-pill">● ${nLive} en vivo</span> ` : ""}Temporada 2026-27 · <b>${played}</b>/${state.games.length} jugados · Datos: <b class="${stale ? "stale" : ""}" title="${stale ? "La actualización automática no ha corrido en más de 14 horas: revisa GitHub → Actions" : ""}">${stale ? "⚠ " : ""}${upd}</b><span class="tz"><br>Jornadas por fecha NBA (EE.UU.) · horarios en tu zona: ${TZ.replace("_", " ")}</span>`;
}

/* ================= Eventos ================= */
function bindEvents() {
  $("#calList").addEventListener("click", (e) => {
    const btn = e.target.closest(".game");
    if (btn) selectGame(+btn.dataset.id);
  });
  $("#calList").addEventListener("scroll", () => requestAnimationFrame(updateActiveDay), { passive: true });

  $("#weekDays").addEventListener("click", (e) => {
    const chip = e.target.closest(".day-chip");
    if (chip && !chip.disabled) scrollToDay(chip.dataset.day, { smooth: true });
  });
  $("#weekPrev").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); renderWeek(); });
  $("#weekNext").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); renderWeek(); });
  $("#btnToday").addEventListener("click", () => scrollToDay(todayKey(), { smooth: true }));

  $("#teamFilter").addEventListener("change", (e) => {
    state.team = e.target.value;
    renderTeamStrip();
    renderList();
    scrollToDay(todayKey());
  });
  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      state.status = b.dataset.status;
      renderList();
      // en "Finales" lo útil es lo más reciente: vamos a hoy (o al último día jugado)
      scrollToDay(state.status === "final" ? addDays(todayKey(), 1) : todayKey());
    })
  );

  $("#btnDayParlays").addEventListener("click", () => selectDay(state.activeDay || todayKey()));
  $("#calList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dayparlay]");
    if (b) { e.stopPropagation(); selectDay(b.dataset.dayparlay); }
  }, true);
  $("#btnTracking").addEventListener("click", () => selectTracking());
  window.addEventListener("hashchange", () => {
    if (location.hash === "#registro") { if (state.dayView !== "registro") selectTracking({ fromHash: true }); return; }
    const { id, pid, day } = parseHash();
    if (day && day !== state.dayView) { selectDay(day, { fromHash: true }); return; }
    if (id && state.byId.has(id) && (id !== state.selectedId || pid !== state.playerId)) selectGame(id, { fromHash: true, playerId: pid });
  });

  // plantillas: clic en jugador, saltar a un equipo, búsqueda
  $("#rosterList").addEventListener("click", (e) => {
    const b = e.target.closest(".pl");
    if (b) selectPlayer(b.dataset.pid);
  });
  $("#rosterHead").addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    const sec = b && $(`#rosterList .team-sec[data-team="${b.dataset.jump}"]`);
    if (sec) $("#rosterList").scrollTo({ top: sec.offsetTop, behavior: "smooth" });
  });
  $("#rosterSearch").addEventListener("input", (e) => { state.query = e.target.value; renderRoster(); });
  $("#matchup").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-pick]");
    if (!cb) return;
    cb.checked ? myLegs.add(cb.dataset.pick) : myLegs.delete(cb.dataset.pick);
    const sc = $(".col-analysis").scrollTop;
    renderSelection();
    $(".col-analysis").scrollTop = sc;
  });
  $("#propTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-stat]");
    if (!b) return;
    document.querySelectorAll("#propTabs button").forEach((x) => x.classList.toggle("on", x === b));
    setStat(b.dataset.stat);
  });
  $("#matchup").addEventListener("click", (e) => {
    const legBtn = e.target.closest("[data-leg]");
    if (legBtn) {
      const l = findLeg(legBtn.dataset.leg);
      if (l) {
        presetLine(l.player.id, l.stat, l.t - 0.5);
        document.querySelectorAll("#propTabs button").forEach((x) => x.classList.toggle("on", x.dataset.stat === l.stat));
        if (state.dayView || state.selectedId !== l.gameId) selectGame(l.gameId, { playerId: l.player.id });
        else selectPlayer(l.player.id);
      }
      return;
    }
    const gameBtn = e.target.closest("[data-game]");
    if (gameBtn) { selectGame(+gameBtn.dataset.game); return; }
    if (e.target.closest("[data-clear]")) { myLegs.clear(); renderSelection(); return; }
    if (e.target.closest('[data-action="back"]')) {
      state.playerId = null;
      document.querySelectorAll(".pl.sel").forEach((b) => b.classList.remove("sel"));
      setHash(); renderSelection();
    }
  });

  // refresco de datos: periódico y al volver a la pestaña
  const refresh = async () => {
    try {
      await loadData(); renderMeta(); renderTeamStrip(); renderList({ keepScroll: true });
      liveCtl?.now();
      const g = state.byId.get(state.selectedId);
      const ts = state.dayView ? dayGames(state.dayView).flatMap((x) => [x.away, x.home]) : g ? [g.away, g.home] : [];
      await Promise.all([...new Set(ts)].map((t) => loadTeam(t, { force: true })));
      renderRoster(); renderSelection();
    }
    catch (err) { console.warn("No se pudo refrescar", err); }
  };
  setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

function fillTeamFilter() {
  const sel = $("#teamFilter");
  const opts = Object.entries(TEAMS).filter(([a]) => a !== "TBD")
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([a, t]) => `<option value="${a}">${t.name}</option>`).join("");
  sel.insertAdjacentHTML("beforeend", opts);
}

function parseHash() {
  const d = location.hash.match(/^#dia-(\d{4}-\d\d-\d\d)$/);
  if (d) return { id: 0, pid: null, day: d[1] };
  const m = location.hash.match(/^#g(\d+)(?:-p(\d+))?$/);
  return { id: m ? +m[1] : 0, pid: m && m[2] ? m[2] : null, day: null };
}

/* ================= Inicio ================= */
async function init() {
  fillTeamFilter();
  bindEvents();
  try {
    await loadData();
  } catch (err) {
    $("#calList").innerHTML = `<div class="empty">No se pudo cargar <code>${DATA_URL}</code>.<br>${err.message}</div>`;
    $("#meta").textContent = "Sin datos";
    return;
  }
  renderMeta();
  renderList();
  scrollToDay(todayKey());

  // partido inicial: el del hash, o el primero pendiente de hoy en adelante
  const { id: hashId, pid, day: hashDay } = parseHash();
  if (location.hash === "#registro") { selectTracking({ fromHash: true }); return; }
  if (hashDay) { selectDay(hashDay, { fromHash: true }); return; }
  const fromHash = state.byId.get(hashId);
  const first = fromHash ||
    state.games.find((g) => g.day >= todayKey() && gameStatus(g) !== "final") || state.games.at(-1);
  if (first) selectGame(first.id, { fromHash: !!fromHash, playerId: fromHash ? pid : null });
}

function startLiveScores() {
  liveCtl = startLive({
    getGames: () => state.games,
    getWatched: () => state.selectedId,
    onUpdate: (ids) => {
      applyLive();
      renderMeta();
      renderList({ keepScroll: true });
      // no redibujamos la ficha del jugador (cerraría el gráfico que estás mirando)
      if (!state.playerId && (state.dayView || ids.includes(state.selectedId))) {
        const sc = $(".col-analysis").scrollTop;
        renderSelection();
        $(".col-analysis").scrollTop = sc;
      }
    },
  });
}

init().then(startLiveScores);

// App instalable (Android/iPhone/PC): registra el service worker
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
