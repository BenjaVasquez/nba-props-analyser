// "🎟 Mis apuestas" y "🔴 En vivo".
// - Cargar la apuesta tal cual la casa (jugador, Más/Menos de X.5, cuota, monto):
//   la web calcula la probabilidad del modelo, la cuota justa y si tiene valor.
// - Armar parlays con mis filtros (patas, cuota, props, partidos).
// - Seguir parlays (⭐) y verlos avanzar en vivo, todos en una pantalla.
// Las apuestas se guardan en este teléfono/navegador (localStorage).
import { STATS } from "./propchart.js";
import { TEAMS, logoHTML } from "./teams.js";
import { injuryFor } from "./players.js";
import { playerContext, statModel, legProb, legWon, legText, corrFactor, buildCandidates, generateParlays } from "./engine.js";
import { live, liveStat } from "./live.js";
import { findParlay, findLeg, legStatus, pc, odds, shortName } from "./parlayview.js";

const KEY = "nba-bets-v1";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);
const num = (s) => { const v = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
const PROPS = ["pts", "reb", "ast", "tpm", "pra", "pts_reb", "pts_ast", "reb_ast", "stl", "blk"];
const legKey = (l) => `${l.pid}:${l.stat}:${l.side}:${l.line}`;

/* ---------------- almacenamiento ---------------- */
let bets = [];
try { bets = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { bets = []; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(bets)); } catch { /* sin almacenamiento */ } };
export const allBets = () => bets;

const toSaved = (l, game) => ({
  gameId: l.gameId, day: game?.day, pid: String(l.player.id), name: l.player.name, team: l.team, opp: l.opp,
  isHome: l.isHome, stat: l.stat, line: l.line, side: l.side, prob: Math.round(l.prob * 1000) / 1000,
});
const betKey = (b) => b.legs.map(legKey).sort().join("~");

export function followedSet() {
  return new Set(bets.map((b) => b.legs.map((l) => `${l.pid}:${l.stat}:${l.side}:${l.line}`).sort().join("~")));
}

function addBet(legs, { source, odds: o = null, stake = null, byId }) {
  const saved = legs.map((l) => (l.player ? toSaved(l, byId(l.gameId)) : l));
  const prob = saved.reduce((a, l) => a * l.prob, 1) * corrFactor(saved);
  const b = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, created: new Date().toISOString(), source, legs: saved, prob, odds: o, stake };
  const k = betKey(b);
  bets = bets.filter((x) => betKey(x) !== k);
  bets.unshift(b);
  persist();
  return b;
}

// ⭐ Seguir / dejar de seguir un parlay sugerido
export function toggleFollow(parlayId, ctx) {
  const p = findParlay(parlayId);
  if (!p) return false;
  const k = p.legs.map((l) => l.id).sort().join("~");
  const i = bets.findIndex((b) => betKey(b) === k);
  if (i >= 0) { bets.splice(i, 1); persist(); return false; }
  addBet(p.legs, { source: "sugerido", byId: ctx.byId });
  return true;
}

export function savePicked(legIds, ctx) {
  const legs = legIds.map((id) => findLeg(id)).filter(Boolean);
  if (legs.length) addBet(legs, { source: "armado", byId: ctx.byId });
}

/* ---------------- valor actual de una pata ---------------- */
// devuelve { v, state } · state: "pre" | "in" | "post"
function legNow(l, ctx) {
  const g = ctx.byId(l.gameId);
  const L = live.games.get(l.gameId);
  const get = STATS[l.stat].get;
  if (L && L.state !== "pre") {
    const v = liveStat(l.gameId, l.pid, get);
    if (v != null || L.state === "post") return { v, state: L.state, waiting: v == null && !live.box.has(L.espnId) };
  }
  if (g && ctx.status(g) === "final") {
    const p = ctx.teamData(l.team)?.players?.find((x) => String(x.id) === l.pid);
    const pg = p?.games?.find((x) => x.date === l.day);
    if (pg) return { v: pg.min > 0 ? get(pg) : null, state: "post" };
    // el equipo ya tiene ese partido cargado pero el jugador no aparece: no jugó
    const teamHas = ctx.teamData(l.team)?.players?.some((x) => x.games?.some((y) => y.date === l.day));
    return { v: null, state: "post", waiting: !teamHas };
  }
  return { v: null, state: g && ctx.status(g) === "live" ? "in" : "pre" };
}

export function evalBet(b, ctx) {
  const legs = b.legs.map((l) => ({ ...l, now: legNow(l, ctx) }));
  let status = "pendiente";
  const won = legs.map((l) => (l.now.state === "post" && !l.now.waiting ? (l.now.v == null ? "void" : legWon(l, l.now.v) ? "win" : "lose") : null));
  const lostLive = legs.some((l) => l.now.state === "in" && l.side === "under" && l.now.v != null && l.now.v >= l.line);
  if (won.includes("lose") || lostLive) status = "perdida";
  else if (won.every((x) => x === "win")) status = "ganada";
  else if (won.every((x) => x)) status = "nula";
  else if (legs.some((l) => l.now.state === "in" || l.now.state === "post")) status = "en vivo";
  return { legs, status };
}

/* ---------------- tarjeta de una apuesta (con avance en vivo) ---------------- */
const STATUS_TXT = { pendiente: "Pendiente", "en vivo": "● En vivo", ganada: "✓ Ganada", perdida: "✗ Perdida", nula: "Nula" };
function betCard(b, ctx, { compact = false } = {}) {
  const { legs, status } = evalBet(b, ctx);
  const ev = b.odds ? b.prob * b.odds - 1 : null;
  const rows = legs.map((l) => {
    const st = l.now.state === "pre" ? null : legStatus(l, l.now.v, l.now.state === "post" && l.now.waiting ? undefined : l.now.state);
    const pct = l.now.v != null && l.side === "over" ? Math.min(100, Math.round((l.now.v / (l.line + 0.5)) * 100)) : 0;
    const g = ctx.byId(l.gameId);
    return `<div class="bl ${st?.cls || ""}">
      <div class="bl-top"><span class="bl-name">${esc(shortName(l.name))} <small>${l.team} ${l.isHome ? "vs" : "@"} ${l.opp}</small></span>
        <span class="bl-line">${legText(l)}</span><span class="bl-p">${pc(l.prob)}</span>
        ${st ? `<span class="rs ${st.cls}" title="${esc(st.title)}">${esc(st.txt)}</span>` : `<span class="bl-time">${g ? ctx.timeFmt(g) : ""}</span>`}</div>
      ${l.side === "over" && l.now.state !== "pre" ? `<div class="bl-bar"><i style="width:${pct}%"></i></div>` : ""}
    </div>`;
  }).join("");
  const payout = b.odds && b.stake ? b.odds * b.stake : null;
  return `<div class="bet st-${status.replace(" ", "-")}">
    <div class="bet-h"><span class="bet-st">${STATUS_TXT[status]}</span>
      <span class="bet-src">${{ sugerido: "⭐ Sugerido", manual: "🎟 Casa", armado: "✎ Armado" }[b.source] || ""}</span>
      <span class="bet-n">${b.legs.length} patas · Prob. <b>${pc(b.prob)}</b> · Justa <b>${odds(b.prob)}</b>${b.odds ? ` · Casa <b>${String(b.odds).replace(".", ",")}</b>` : ""}</span>
      ${compact ? "" : `<button type="button" class="lnk bet-del" data-del-bet="${b.id}" title="Eliminar">✕</button>`}</div>
    <div class="bet-legs">${rows}</div>
    ${!compact && (b.stake || ev != null) ? `<div class="bet-f">${b.stake ? `Monto <b>${money(b.stake)}</b>` : ""}${payout ? ` · Paga <b>${money(payout)}</b>` : ""}${ev != null ? ` · Valor esperado <b class="${ev >= 0 ? "ok" : "ko"}">${ev >= 0 ? "+" : ""}${Math.round(ev * 100)}%</b>` : ""}</div>` : ""}
  </div>`;
}

/* ---------------- formulario: cargar mi apuesta de la casa ---------------- */
export const form = { rows: [{ stat: "pts", side: "over" }], odds: "", stake: "" };

function formRowProb(r, ctx) {
  const g = ctx.byId(+r.gameId);
  if (!g || !r.pid || !r.stat || num(r.line) == null) return null;
  const team = r.team;
  const p = ctx.teamData(team)?.players?.find((x) => String(x.id) === String(r.pid));
  if (!p) return null;
  const isHome = team === g.home;
  const c = playerContext(p, { cutoffDay: g.day, isHome, opp: isHome ? g.away : g.home, minMin: 0 });
  if (!c) return { none: true };
  const m = statModel(c, r.stat);
  return { prob: legProb(m, num(r.line), r.side || "over"), proj: m.proj, p, g, isHome, inj: injuryFor(p, ctx.injIdx) };
}

function formHTML(ctx) {
  const games = ctx.upcoming();
  const gameOpts = (sel) => `<option value="">Partido…</option>` + games.map((g) => `<option value="${g.id}" ${+sel === g.id ? "selected" : ""}>${g.away} @ ${g.home} · ${ctx.dayShort(g)} ${ctx.timeFmt(g)}</option>`).join("");
  const rowsOut = [];
  const legsOk = [];
  form.rows.forEach((r, i) => {
    const g = ctx.byId(+r.gameId);
    let playerOpts = `<option value="">Jugador…</option>`;
    if (g) {
      for (const t of [g.away, g.home]) {
        const d = ctx.teamData(t);
        if (!d) { ctx.loadTeam(t); playerOpts += `<option disabled>Cargando ${t}…</option>`; continue; }
        playerOpts += `<optgroup label="${TEAMS[t]?.short || t}">` + (d.players || []).map((p) => {
          const inj = injuryFor(p, ctx.injIdx);
          return `<option value="${t}|${p.id}" ${String(r.pid) === String(p.id) ? "selected" : ""}>${esc(p.name)}${inj ? (inj.status === "red" ? " (fuera)" : " (duda)") : ""}</option>`;
        }).join("") + `</optgroup>`;
      }
    }
    const pr = formRowProb(r, ctx);
    if (pr?.prob != null) legsOk.push({ gameId: g.id, day: g.day, pid: String(r.pid), name: pr.p.name, team: r.team, opp: pr.isHome ? g.away : g.home, isHome: pr.isHome, stat: r.stat, line: num(r.line), side: r.side || "over", prob: Math.round(pr.prob * 1000) / 1000 });
    rowsOut.push(`<div class="fr" data-row="${i}">
      <select data-f="gameId">${gameOpts(r.gameId)}</select>
      <select data-f="player" ${g ? "" : "disabled"}>${playerOpts}</select>
      <select data-f="stat">${PROPS.map((s) => `<option value="${s}" ${(r.stat || "pts") === s ? "selected" : ""}>${STATS[s].label}</option>`).join("")}</select>
      <select data-f="side"><option value="over" ${r.side !== "under" ? "selected" : ""}>Más de</option><option value="under" ${r.side === "under" ? "selected" : ""}>Menos de</option></select>
      <input data-f="line" type="text" inputmode="decimal" placeholder="Línea ej. 24,5" value="${esc(r.line ?? "")}">
      <span class="fr-p">${pr?.none ? `<small>sin datos</small>` : pr?.prob != null ? `<b class="${pr.prob >= 0.75 ? "ok" : pr.prob >= 0.55 ? "mid" : "ko"}">${pc(pr.prob)}</b><small>Proy. ${String(Math.round(pr.proj * 10) / 10).replace(".", ",")}${pr.inj ? ` · ${pr.inj.status === "red" ? "FUERA" : "DUDA"}` : ""}</small>` : ""}</span>
      <button type="button" class="lnk" data-row-del="${i}" title="Quitar pata">✕</button>
    </div>`);
  });
  const prob = legsOk.length ? legsOk.reduce((a, l) => a * l.prob, 1) * corrFactor(legsOk) : null;
  const o = num(form.odds), stake = num(form.stake);
  const ev = prob != null && o ? prob * o - 1 : null;
  const verdict = ev == null ? "" : ev >= 0.05 ? `<span class="vd ok">✓ Tiene valor: la casa paga más que la cuota justa</span>` : ev >= -0.05 ? `<span class="vd mid">≈ Justa: sin ventaja clara</span>` : `<span class="vd ko">✗ Sin valor: la casa paga menos de lo que vale</span>`;
  return { html: `
    <div class="card">
      <h3>🎟 Cargar mi apuesta de la casa</h3>
      <p class="muted small">Ingresa cada pata como aparece en tu casa. La web calcula la probabilidad con el modelo y te dice si la cuota conviene.</p>
      <div class="frows">${rowsOut.join("")}</div>
      <button type="button" class="btn-sm" data-row-add>＋ Agregar pata</button>
      <div class="fsum">
        <label>Cuota total de la casa <input data-f2="odds" type="text" inputmode="decimal" placeholder="ej. 1,65" value="${esc(form.odds)}"></label>
        <label>Monto <input data-f2="stake" type="text" inputmode="numeric" placeholder="ej. 5000" value="${esc(form.stake)}"></label>
        <div class="fres">
          <span>Prob. <b>${prob != null ? pc(prob) : "—"}</b></span><span>Cuota justa <b>${prob ? odds(prob) : "—"}</b></span>
          ${ev != null ? `<span>Valor esperado <b class="${ev >= 0 ? "ok" : "ko"}">${ev >= 0 ? "+" : ""}${Math.round(ev * 100)}%</b>${stake ? ` (${money(stake * ev)})` : ""}</span>` : ""}
        </div>
        ${verdict}
        <button type="button" class="btn-main" data-save-form ${legsOk.length ? "" : "disabled"}>Guardar y seguir en vivo</button>
      </div>
    </div>`, legsOk };
}

/* ---------------- generador con mis filtros ---------------- */
export const gen = { scope: "day", gameId: null, minLegs: 2, maxLegs: 3, oddsMin: 1.3, oddsMax: 1.8, props: [...PROPS.slice(0, 8)], doubt: false, count: 15, results: null, ran: false };

function genHTML(ctx, followed) {
  const games = ctx.upcoming();
  const day = ctx.genDay();
  const res = gen.results;
  const cards = res ? (res.length ? res.map((p, i) => {
    const k = p.legs.map((l) => l.id).sort().join("~");
    return `<div class="parlay"><div class="pz-head"><b>#${i + 1}</b><span class="pz-n">${p.legs.length} patas</span><span class="pz-odds">Cuota justa <b>${odds(p.prob)}</b></span></div>
      <div class="pz-legs">${p.legs.map((l) => `<div class="leg static"><span class="lg-main"><span class="lg-name">${esc(shortName(l.player.name))} <small>${l.team} ${l.isHome ? "vs" : "@"} ${l.opp}</small></span></span><span class="lg-line">${legText(l)}</span><span class="lg-prob">${pc(l.prob)}</span></div>`).join("")}</div>
      <div class="pz-foot2"><span>Prob. <b>${pc(p.prob)}</b></span><button type="button" class="follow ${followed.has(k) ? "on" : ""}" data-follow="${esc(k)}">${followed.has(k) ? "★ Siguiendo" : "☆ Seguir"}</button></div></div>`;
  }).join("") : `<div class="muted">No encontré combinaciones con esos filtros. Prueba ampliar la cuota o permitir más patas.</div>`) : "";
  return `
    <div class="card">
      <h3>⚙ Armar parlays con mis filtros</h3>
      <div class="gform">
        <label>Partidos <select data-g="scope">
          <option value="day" ${gen.scope === "day" ? "selected" : ""}>Todos los de ${day ? ctx.dayLong(day) : "hoy"}</option>
          ${games.map((g) => `<option value="${g.id}" ${gen.scope === String(g.id) ? "selected" : ""}>Solo ${g.away} @ ${g.home}</option>`).join("")}
        </select></label>
        <label>Patas <span class="rng"><input data-g="minLegs" type="number" min="1" max="8" value="${gen.minLegs}"> a <input data-g="maxLegs" type="number" min="1" max="8" value="${gen.maxLegs}"></span></label>
        <label>Cuota justa <span class="rng"><input data-g="oddsMin" type="text" inputmode="decimal" value="${String(gen.oddsMin).replace(".", ",")}"> a <input data-g="oddsMax" type="text" inputmode="decimal" value="${String(gen.oddsMax).replace(".", ",")}"></span></label>
        <label>Cantidad <input data-g="count" type="number" min="1" max="40" value="${gen.count}"></label>
        <div class="gprops">${PROPS.map((s) => `<label class="chk"><input type="checkbox" data-gp="${s}" ${gen.props.includes(s) ? "checked" : ""}> ${STATS[s].short}</label>`).join("")}
          <label class="chk"><input type="checkbox" data-g="doubt" ${gen.doubt ? "checked" : ""}> Incluir jugadores en duda</label></div>
        <button type="button" class="btn-main" data-gen-run>Generar</button>
      </div>
      ${gen.loading ? `<div class="muted">Cargando jugadores…</div>` : res ? `<div class="pz-grid">${cards}</div>` : ""}
    </div>`;
}

export async function runGenerator(ctx) {
  const day = ctx.genDay();
  const games = gen.scope === "day" ? ctx.games().filter((g) => g.day === day && g.home !== "TBD") : [ctx.byId(+gen.scope)].filter(Boolean);
  gen.loading = true;
  await Promise.all(games.flatMap((g) => [g.away, g.home].map((t) => ctx.loadTeam(t))));
  gen.loading = false;
  const teams = {};
  games.forEach((g) => [g.away, g.home].forEach((t) => (teams[t] = ctx.teamData(t))));
  const pool = games.flatMap((g) => buildCandidates({ teams, game: g, injIdx: ctx.injIdx, cutoffDay: g.day, isFinal: false, stats: gen.props.filter((s) => s !== "stl" && s !== "blk").length ? gen.props : ["pts"], minProb: 0.58 }));
  pool.forEach((l) => findLegRegister(l));
  const oMin = Math.max(1.01, num(gen.oddsMin) || 1.3), oMax = Math.max(oMin + 0.01, num(gen.oddsMax) || 1.8);
  const lo = Math.max(1, Math.min(+gen.minLegs || 2, 8)), hi = Math.max(lo, Math.min(+gen.maxLegs || 3, 8));
  gen.results = generateParlays(pool, {
    count: Math.min(40, +gen.count || 15), minLegs: lo, maxLegs: hi, oddsMin: oMin, oddsMax: oMax,
    allowDoubt: gen.doubt, maxLegProb: 0.95, poolSize: hi > 4 ? 30 : 45, perGameMax: gen.scope === "day" ? 2 : 99, maxPerPlayer: 5,
  });
  gen.results.forEach((p) => registerParlay(p));
}
// registro local para que ⭐ Seguir encuentre los parlays generados aquí
const genParlays = new Map();
function registerParlay(p) { genParlays.set(p.legs.map((l) => l.id).sort().join("~"), p); }
function findLegRegister() { /* las patas viajan dentro del parlay */ }
export function toggleFollowGenerated(id, ctx) {
  const p = genParlays.get(id) || findParlay(id);
  if (!p) return false;
  const i = bets.findIndex((b) => betKey(b) === id);
  if (i >= 0) { bets.splice(i, 1); persist(); return false; }
  addBet(p.legs, { source: "sugerido", byId: ctx.byId });
  return true;
}

/* ---------------- vista: Mis apuestas ---------------- */
export function betsViewHTML(ctx) {
  const followed = followedSet();
  const f = formHTML(ctx);
  ctx.setFormLegs(f.legsOk);
  const decided = bets.map((b) => ({ b, e: evalBet(b, ctx) })).filter((x) => x.b.stake && x.b.odds && ["ganada", "perdida"].includes(x.e.status));
  const staked = decided.reduce((a, x) => a + x.b.stake, 0);
  const ret = decided.reduce((a, x) => a + (x.e.status === "ganada" ? x.b.stake * x.b.odds : 0), 0);
  const wins = bets.filter((b) => evalBet(b, ctx).status === "ganada").length;
  const losses = bets.filter((b) => evalBet(b, ctx).status === "perdida").length;
  return `
    <div class="day-hero"><div class="big">🎟 Mis apuestas</div>
      <div class="sub">Carga tu apuesta tal cual la casa, arma parlays con tus filtros y síguelos en vivo. Se guardan en este teléfono.</div></div>
    ${f.html}
    ${genHTML(ctx, followed)}
    <div class="card"><h3>Mis parlays (${bets.length}) <span class="h3-note">· ${wins} ganados · ${losses} perdidos${staked ? ` · Apostado ${money(staked)} · Resultado <b class="${ret - staked >= 0 ? "ok" : "ko"}">${ret - staked >= 0 ? "+" : ""}${money(ret - staked)}</b>` : ""}</span>
      <button type="button" class="lnk h3-act" data-open-live>🔴 Ver en vivo</button></h3>
      ${bets.length ? `<div class="bets">${bets.map((b) => betCard(b, ctx)).join("")}</div>` : `<div class="muted">Aún no sigues ningún parlay. Usa ☆ Seguir en los sugeridos o guarda tu apuesta arriba.</div>`}
    </div>`;
}

/* ---------------- vista: En vivo (marcador de todo el día) ---------------- */
export function liveViewHTML(ctx) {
  const day = ctx.liveDay();
  const games = ctx.games().filter((g) => g.day === day && g.home !== "TBD");
  const tiles = games.map((g) => {
    const L = live.games.get(g.id);
    const st = ctx.status(g);
    const score = st === "live" && L?.state === "in" ? { a: L.as, h: L.hs, txt: L.detail || "En vivo", cls: "in" }
      : st === "final" ? { a: g.as, h: g.hs, txt: "Final", cls: "post" } : null;
    const sel = ctx.liveBoxGame() === g.id;
    return `<button type="button" class="sb ${score?.cls || "pre"} ${sel ? "sel" : ""}" data-livebox="${g.id}" title="Ver su box score aquí">
      <div class="sb-t">${logoHTML(g.away, 26)}<b>${g.away}</b><span class="sb-s ${score && score.a > score.h ? "lead" : ""}">${score ? score.a : ""}</span></div>
      <div class="sb-t">${logoHTML(g.home, 26)}<b>${g.home}</b><span class="sb-s ${score && score.h > score.a ? "lead" : ""}">${score ? score.h : ""}</span></div>
      <div class="sb-st">${score ? (score.cls === "in" ? `● ${esc(score.txt)}` : score.txt) : ctx.timeFmt(g)}</div>
    </button>`;
  }).join("");
  const mine = bets.filter((b) => b.legs.some((l) => l.day === day || ctx.byId(l.gameId)?.day === day));
  const order = { "en vivo": 0, pendiente: 1, ganada: 2, perdida: 3, nula: 4 };
  const evals = mine.map((b) => ({ b, s: evalBet(b, ctx).status })).sort((x, y) => order[x.s] - order[y.s]);
  const nLive = [...live.games.values()].filter((x) => x.state === "in").length;
  return `
    <div class="day-hero"><div class="big">🔴 En vivo</div>
      <div class="sub">${ctx.dayLong(day)} · ${games.length} partidos${nLive ? ` · <b class="live-tag">${nLive} en juego</b>` : ""} · se actualiza solo cada 30 s</div></div>
    <div class="card"><h3>Marcador <span class="h3-note">· toca un partido para ver su box score</span></h3><div class="sb-grid">${tiles || `<div class="muted">No hay partidos este día.</div>`}</div></div>
    ${ctx.boxHTML(ctx.liveBoxGame())}
    <div class="card"><h3>Mis parlays de hoy (${mine.length}) <button type="button" class="lnk h3-act" data-open-bets>🎟 Mis apuestas</button></h3>
      ${mine.length ? `<div class="bets">${evals.map(({ b }) => betCard(b, ctx, { compact: true })).join("")}</div>`
        : `<div class="muted">No sigues parlays de esta jornada. Toca ☆ Seguir en cualquier parlay sugerido o carga el tuyo en 🎟 Mis apuestas.</div>`}
    </div>`;
}

// partidos cuyo box score hay que traer (tienen patas seguidas)
export function watchedGames() {
  return [...new Set(bets.flatMap((b) => b.legs.map((l) => l.gameId)))];
}

/* ---------------- eventos del formulario ---------------- */
export function onFormInput(el) {
  const row = el.closest("[data-row]");
  if (row) {
    const r = form.rows[+row.dataset.row];
    const f = el.dataset.f;
    if (f === "player") { const [t, id] = el.value.split("|"); r.team = t; r.pid = id; }
    else if (f === "gameId") { r.gameId = el.value; r.pid = null; r.team = null; }
    else r[f] = el.value;
    return true;
  }
  if (el.dataset.f2) { form[el.dataset.f2] = el.value; return true; }
  if (el.dataset.g) { gen[el.dataset.g] = el.type === "checkbox" ? el.checked : el.value; return false; }
  if (el.dataset.gp) {
    const s = el.dataset.gp;
    gen.props = el.checked ? [...new Set([...gen.props, s])] : gen.props.filter((x) => x !== s);
    return false;
  }
  return false;
}

export function saveForm(legs) {
  if (!legs.length) return;
  addBet(legs, { source: "manual", odds: num(form.odds), stake: num(form.stake), byId: () => null });
  form.rows = [{ stat: "pts", side: "over" }]; form.odds = ""; form.stake = "";
}
export function deleteBet(id) { bets = bets.filter((b) => b.id !== id); persist(); }
