// Parlays sugeridos (motor v3): 15 por partido y 10 del día, con líneas .5 como las de
// las casas, botón ⭐ Seguir (pasa a "Mis apuestas" y al marcador en vivo) y tabla de
// mejores props con armador propio.
import { STATS } from "./propchart.js";
import { avatarHTML } from "./players.js";
import { buildCandidates, generateParlays, combine, legText, legWon } from "./engine.js";
import { live, liveStat } from "./live.js";

export const GAME_OPTS = { count: 15, minLegs: 2, maxLegs: 4, oddsMin: 1.3, oddsMax: 1.8, maxLegProb: 0.93 };
export const DAY_OPTS = { count: 10, minLegs: 2, maxLegs: 3, oddsMin: 1.3, oddsMax: 1.8, maxLegProb: 0.92, perGameMax: 1, poolSize: 60, maxPerPlayer: 3 };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pc = (p) => `${Math.round(p * 100)}%`;
export const odds = (p) => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");
const frac = ([h, n]) => `${h}/${n}`;
const dec1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
export const shortName = (n) => { const w = (n || "").split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; };
export const legLabel = legText;

const cache = new Map();     // partido -> { key, legs }
const known = new Map();     // id de pata -> pata
const parlaysById = new Map(); // id de parlay -> parlay (para ⭐ Seguir)
export const myLegs = new Set();
export const findLeg = (id) => known.get(id) || null;
export const findParlay = (id) => parlaysById.get(id) || null;
const parlayId = (p) => p.legs.map((l) => l.id).sort().join("~");

export function computeCandidates(ctx) {
  const { game, teams, injIdx, isFinal } = ctx;
  const L = live.games.get(game.id);
  const liveDone = L?.state === "post" && live.box.has(L.espnId);
  const key = `${teams[game.away]?.updated}|${teams[game.home]?.updated}|${injIdx?.count}|${isFinal}|${liveDone}`;
  const hit = cache.get(game.id);
  if (hit?.key === key) return hit;
  const legs = buildCandidates({ teams, game, injIdx, cutoffDay: game.day, isFinal });
  if (liveDone) for (const l of legs) if (l.actual == null) l.actual = liveStat(game.id, l.player.id, STATS[l.stat].get);
  legs.forEach((l) => known.set(l.id, l));
  const out = { key, legs, parlays: null };
  cache.set(game.id, out);
  return out;
}

function gameParlays(ctx) {
  const c = computeCandidates(ctx);
  if (!c.parlays) c.parlays = generateParlays(c.legs, GAME_OPTS);
  c.parlays.forEach((p) => parlaysById.set(parlayId(p), p));
  return c;
}

/* ---------- etiquetas de resultado / en vivo ---------- */
export function legStatus(l, v, state) {
  // v: valor actual (en vivo o final) · state: "in" | "post" | undefined
  if (v == null) return state === "post" ? { cls: "void", txt: "NJ", title: "No jugó" } : null;
  const won = legWon(l, v);
  if (state === "in") {
    if (l.side === "under") return won ? { cls: "live", txt: `⏱ ${v}`, title: `Lleva ${v}; debe quedar bajo ${l.line}` } : { cls: "lose", txt: `✗ ${v}`, title: `Ya pasó ${l.line}` };
    return won ? { cls: "win", txt: `✓ ${v}`, title: `Ya la cumplió: lleva ${v}` } : { cls: "live", txt: `⏱ ${v}/${String(l.line).replace(".", ",")}`, title: `En vivo: lleva ${v}` };
  }
  return won ? { cls: "win", txt: `✓ ${v}`, title: `Hizo ${v}` } : { cls: "lose", txt: `✗ ${v}`, title: `Hizo ${v}` };
}
const tag = (s) => (s ? `<span class="rs ${s.cls}" title="${esc(s.title)}">${esc(s.txt)}</span>` : "");

function resultTag(l) {
  if (l.actual !== undefined) return tag(legStatus(l, l.actual, "post"));
  const st = live.games.get(l.gameId)?.state;
  if (st !== "in") return "";
  return tag(legStatus(l, liveStat(l.gameId, l.player.id, STATS[l.stat].get), "in"));
}

function legRow(l) {
  return `<button type="button" class="leg" data-leg="${esc(l.id)}" title="Abrir el gráfico de ${esc(l.player.name)}">
    ${avatarHTML(l.player, 28)}
    <span class="lg-main"><span class="lg-name">${esc(shortName(l.player.name))} <small>${l.team}${l.showOpp ? ` ${l.isHome ? "vs" : "@"} ${l.opp}` : ""}</small></span>
      <span class="lg-freq">Proy. ${dec1(l.proj)} · Temp ${frac(l.season)} · L10 ${frac(l.l10)}</span></span>
    <span class="lg-line">${legLabel(l)}</span>
    <span class="lg-prob">${pc(l.prob)}</span>${resultTag(l)}
  </button>`;
}

function parlayCard(p, i, kind, model, followed) {
  const m = model?.parlays?.find((x) => x.name === `${kind} · ${p.legs.length} patas`);
  const res = p.result ? `<span class="pz-res ${p.result}">${{ win: "✓ Se cumplió", lose: "✗ Falló", void: "Nulo" }[p.result]}</span>` : "";
  const id = parlayId(p);
  const isF = followed?.has(id);
  return `<div class="parlay ${p.result || ""}">
    <div class="pz-head"><b>#${i + 1}</b><span class="pz-n">${p.legs.length} patas</span>
      <span class="pz-odds">Cuota justa <b>${odds(p.prob)}</b></span>${res}</div>
    <div class="pz-legs">${p.legs.map(legRow).join("")}</div>
    <div class="pz-foot2">
      <span>Prob. <b>${pc(p.prob)}</b></span>
      ${m?.real != null ? `<span title="En la prueba con partidos ya jugados">Prueba: <b>${String(m.real).replace(".", ",")}%</b> <small>(${m.win + m.lose})</small></span>` : ""}
      <button type="button" class="follow ${isF ? "on" : ""}" data-follow="${esc(id)}">${isF ? "★ Siguiendo" : "☆ Seguir"}</button>
    </div>
  </div>`;
}

function builderHTML(picked) {
  const mine = combine(picked);
  return `<div class="builder ${picked.length ? "" : "empty"}">
    ${picked.length
      ? `<span><b>Tu parlay:</b> ${picked.map((l) => `${esc(shortName(l.player.name))} ${legLabel(l)}`).join(" + ")}</span>
         <span class="bd-n">Prob. <b>${pc(mine.prob)}</b> · Cuota justa <b>${odds(mine.prob)}</b>${mine.result ? ` · ${{ win: "✓ Se cumplió", lose: "✗ Falló", void: "Nulo" }[mine.result]}` : ""}</span>
         <button type="button" class="btn-sm" data-save-picked>☆ Guardar en Mis apuestas</button>
         <button type="button" class="lnk" data-clear>Limpiar</button>`
      : `Marca props de la tabla para armar tu propio parlay (o usa <button type="button" class="lnk" data-open-bets>🎟 Mis apuestas</button> para cargar el de tu casa).`}
  </div>`;
}

export function parlaysHTML(ctx, model, followed) {
  const { game, teams } = ctx;
  if (game.away === "TBD" || game.home === "TBD") return "";
  if ([game.away, game.home].some((t) => !teams[t])) return `<div class="card"><h3>Parlays sugeridos</h3><div class="muted">Cargando jugadores…</div></div>`;
  const { legs, parlays } = gameParlays(ctx);
  if (!legs.length) return `<div class="card"><h3>Parlays sugeridos</h3><div class="muted">Aún no hay suficientes partidos jugados para sugerir.</div></div>`;

  // tabla: hasta 2 líneas por jugador
  const per = new Map(), list = [];
  for (const l of legs.filter((x) => x.prob <= 0.95)) { const c = per.get(l.player.id) || 0; if (c < 2) { per.set(l.player.id, c + 1); list.push(l); } }
  const top = list.slice(0, 20);
  const showRes = ctx.isFinal || live.games.get(game.id)?.state === "in";
  const rows = top.map((l) => `<tr class="${l.doubt ? "doubt" : ""}${myLegs.has(l.id) ? " picked" : ""}">
      <td><input type="checkbox" data-pick="${esc(l.id)}" ${myLegs.has(l.id) ? "checked" : ""} aria-label="Agregar al parlay"></td>
      <td class="pl-cell"><button type="button" class="lnk" data-leg="${esc(l.id)}">${esc(shortName(l.player.name))}</button> <small>${l.team}</small>
        ${l.doubt ? `<span class="inj-tag yellow">Duda</span>` : ""}</td>
      <td class="lg-line">${legLabel(l)}</td><td>${dec1(l.proj)}</td>
      <td>${frac(l.season)}</td><td>${frac(l.l10)}</td><td>${frac(l.l5)}</td>
      <td>${frac(l.venue)}</td><td>${l.vsOpp ? frac(l.vsOpp) : "—"}</td>
      <td class="prob">${pc(l.prob)}</td><td>${odds(l.prob)}</td>
      ${showRes ? `<td>${resultTag(l)}</td>` : ""}
    </tr>`).join("");
  const picked = [...myLegs].map((id) => known.get(id)).filter(Boolean);

  return `
  <div class="card parlays">
    <h3>${parlays.length} parlays sugeridos <span class="h3-note">· cuota justa 1,3–1,8${ctx.isFinal ? " · con datos previos al partido" : ""}</span>
      <button type="button" class="lnk h3-act" data-custom-game="${game.id}">⚙ Personalizar</button></h3>
    ${parlays.length ? `<div class="pz-grid">${parlays.map((p, i) => parlayCard(p, i, "Partido", model, followed)).join("")}</div>`
      : `<div class="muted">No hay combinaciones en ese rango de cuota para este partido.</div>`}
  </div>
  <div class="card">
    <h3>Mejores props del partido</h3>
    <div class="tbl-wrap"><table class="props-tbl">
      <thead><tr><th></th><th>Jugador</th><th>Línea</th><th>Proy.</th><th>Temp</th><th>L10</th><th>L5</th><th>Loc/Vis</th><th>vs rival</th><th>Prob.</th><th>Cuota justa</th>${showRes ? `<th>${ctx.isFinal ? "Real" : "En vivo"}</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${builderHTML(picked)}
    <p class="note">Las líneas son como en la casa: "Más de 9,5 PTS" = 10 o más. Si tu casa no tiene esa línea exacta, elige la más cercana <b>por debajo</b> (es más segura) o cárgala en 🎟 Mis apuestas para ver su probabilidad exacta.
    Prob. = 85% proyección (minutos esperados × producción por minuto) + 15% historial. En los parlays de un mismo partido se descuenta un 3% por pata porque se influyen entre sí.
    Cuota justa = 1 ÷ probabilidad: la casa normalmente paga algo menos; si paga <b>más</b>, la apuesta tiene valor.</p>
  </div>`;
}

/* ---------------- Parlays del día ---------------- */
export function dayParlaysHTML(ctx, model, followed) {
  const { items, injIdx } = ctx;
  if (ctx.loading) return `<div class="card"><h3>Parlays del día</h3><div class="muted">Cargando jugadores de ${items.length} partidos…</div></div>`;
  const perGame = items.map((it) => computeCandidates({ ...it, injIdx }));
  const pool = perGame.flatMap((pg) => pg.legs);
  pool.forEach((l) => (l.showOpp = true));
  const key = perGame.map((pg) => pg.key).join("#");
  if (dayCache.key !== key) dayCache = { key, parlays: generateParlays(pool, DAY_OPTS) };
  const parlays = dayCache.parlays;
  parlays.forEach((p) => parlaysById.set(parlayId(p), p));
  const finals = items.some((i) => i.isFinal || live.games.get(i.game.id)?.state === "in");

  const rows = perGame.map((pg, i) => {
    const g = items[i].game;
    const best = pg.legs.filter((l) => !l.out && !l.doubt && l.prob <= 0.92).slice(0, 2);
    return best.map((l, j) => `<tr class="${myLegs.has(l.id) ? "picked" : ""}">
      <td><input type="checkbox" data-pick="${esc(l.id)}" ${myLegs.has(l.id) ? "checked" : ""} aria-label="Agregar al parlay"></td>
      <td>${j === 0 ? `<button type="button" class="lnk" data-game="${g.id}">${g.away} @ ${g.home}</button>` : ""}</td>
      <td class="pl-cell"><button type="button" class="lnk" data-leg="${esc(l.id)}">${esc(shortName(l.player.name))}</button> <small>${l.team}</small></td>
      <td class="lg-line">${legLabel(l)}</td><td>${dec1(l.proj)}</td>
      <td>${frac(l.season)}</td><td>${frac(l.l10)}</td>
      <td class="prob">${pc(l.prob)}</td><td>${odds(l.prob)}</td>
      ${finals ? `<td>${resultTag(l)}</td>` : ""}</tr>`).join("");
  }).join("");
  const picked = [...myLegs].map((id) => known.get(id)).filter(Boolean);

  return `
  <div class="card parlays">
    <h3>${parlays.length} parlays del día <span class="h3-note">· ${esc(ctx.dayLabel)} · ${items.length} partidos · una pata por partido</span>
      <button type="button" class="lnk h3-act" data-custom-day>⚙ Personalizar</button></h3>
    ${parlays.length ? `<div class="pz-grid">${parlays.map((p, i) => parlayCard(p, i, "Día", model, followed)).join("")}</div>`
      : `<div class="muted">No hay combinaciones en ese rango de cuota en esta jornada.</div>`}
  </div>
  <div class="card">
    <h3>Mejores patas de cada partido</h3>
    <div class="tbl-wrap"><table class="props-tbl">
      <thead><tr><th></th><th>Partido</th><th>Jugador</th><th>Línea</th><th>Proy.</th><th>Temp</th><th>L10</th><th>Prob.</th><th>Cuota justa</th>${finals ? "<th>Real</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${builderHTML(picked)}
    <p class="note">Los parlays del día usan una pata por partido (se influyen menos entre sí). Toca un partido para ver sus 15 parlays, o un jugador para abrir su gráfico con esa línea.</p>
  </div>`;
}
let dayCache = { key: null, parlays: [] };

// todas las patas conocidas de un partido (para el generador personalizado)
export const candidatesFor = (ctx) => computeCandidates(ctx).legs;
