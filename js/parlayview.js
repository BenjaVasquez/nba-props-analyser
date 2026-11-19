// Tarjetas de parlays sugeridos + lista de mejores props con armador de parlay propio.
import { STATS } from "./propchart.js";
import { avatarHTML } from "./players.js";
import { buildLegs, suggestParlays, suggestDayParlays, combine } from "./parlay.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pc = (p) => `${Math.round(p * 100)}%`;
const odds = (p) => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");
const frac = ([h, n]) => `${h}/${n}`;
const dec1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
const shortName = (n) => { const w = (n || "").split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; };
export const legLabel = (l) => `${l.t}+ ${STATS[l.stat].short}`;

const cache = new Map(); // partido -> { key, legs, value, parlays }
const known = new Map();  // id de pata -> pata (para abrir el gráfico al tocarla)
export const myLegs = new Set();

export function computeParlays(ctx) {
  const { game, teams, injIdx, isFinal } = ctx;
  const key = `${teams[game.away]?.updated}|${teams[game.home]?.updated}|${injIdx?.count}|${isFinal}`;
  const hit = cache.get(game.id);
  if (hit?.key === key) return hit;
  const res = buildLegs({ teams, game, injIdx, cutoffDay: game.day, isFinal });
  const out = { key, ...res, parlays: suggestParlays(res) };
  for (const l of [...res.legs, ...res.value]) known.set(l.id, l);
  cache.set(game.id, out);
  return out;
}

function resultTag(l) {
  if (l.actual === undefined) return "";
  if (l.actual === null) return `<span class="rs void" title="No jugó">NJ</span>`;
  return l.actual >= l.t ? `<span class="rs win" title="Hizo ${l.actual}">✓ ${l.actual}</span>`
                         : `<span class="rs lose" title="Hizo ${l.actual}">✗ ${l.actual}</span>`;
}

function legRow(l) {
  return `<button type="button" class="leg" data-leg="${esc(l.id)}" title="Abrir el gráfico de ${esc(l.player.name)}">
    ${avatarHTML(l.player, 30)}
    <span class="lg-main"><span class="lg-name">${esc(shortName(l.player.name))} <small>${l.team}</small></span>
      <span class="lg-freq">${l.showOpp ? `${l.isHome ? "vs" : "@"} ${l.opp} · ` : ""}Proy. ${dec1(l.proj)} · Temp ${frac(l.season)} · L10 ${frac(l.l10)}</span></span>
    <span class="lg-line">${legLabel(l)}</span>
    <span class="lg-prob">${pc(l.prob)}</span>${resultTag(l)}
  </button>`;
}

const KIND_NOTE = {
  value: "Líneas en o sobre su promedio: menos probables, pero pagan bastante más.",
  day: "Una pata de cada partido distinto: se influyen menos entre sí.",
};
function parlayCard(p, model) {
  const m = model?.parlays?.find((x) => x.name === p.name);
  const res = p.result ? `<span class="pz-res ${p.result}">${{ win: "✓ Se cumplió", lose: "✗ Falló", void: "Nulo (alguien no jugó)" }[p.result]}</span>` : "";
  return `<div class="parlay pk-${p.kind || "game"} ${p.result || ""}">
    <div class="pz-head"><b>${esc(p.name)}</b><span class="pz-n">${p.legs.length} patas</span>${res}</div>
    ${KIND_NOTE[p.kind] ? `<div class="pz-note">${KIND_NOTE[p.kind]}</div>` : ""}
    <div class="pz-legs">${p.legs.map(legRow).join("")}</div>
    <div class="pz-foot">
      <div><span>Prob. estimada</span><b>${pc(p.prob)}</b></div>
      <div><span>Cuota justa</span><b>${odds(p.prob)}</b></div>
      <div><span>Acierto real del modelo</span><b>${m?.real != null ? `${String(m.real).replace(".", ",")}%` : "—"}</b>${m ? `<small>${m.win}/${m.win + m.lose} parlays</small>` : ""}</div>
    </div>
  </div>`;
}

export function parlaysHTML(ctx, model) {
  const { game, teams } = ctx;
  if (game.away === "TBD" || game.home === "TBD") return "";
  const loading = [game.away, game.home].some((t) => !teams[t]);
  if (loading) return `<div class="card"><h3>Parlays sugeridos</h3><div class="muted">Cargando jugadores…</div></div>`;
  const { legs, parlays } = computeParlays(ctx);
  if (!legs.length) return `<div class="card"><h3>Parlays sugeridos</h3><div class="muted">Aún no hay suficientes partidos jugados para sugerir.</div></div>`;

  // lista: hasta 2 props por jugador, las más probables
  const per = new Map(), list = [];
  for (const l of legs) { const c = per.get(l.player.id) || 0; if (c < 2) { per.set(l.player.id, c + 1); list.push(l); } }
  const top = list.slice(0, 16);
  for (const id of [...myLegs]) if (!legs.some((l) => l.id === id)) myLegs.delete(id);

  const rows = top.map((l) => `<tr class="${l.doubt ? "doubt" : ""}${myLegs.has(l.id) ? " picked" : ""}">
      <td><input type="checkbox" data-pick="${esc(l.id)}" ${myLegs.has(l.id) ? "checked" : ""} aria-label="Agregar al parlay"></td>
      <td class="pl-cell"><button type="button" class="lnk" data-leg="${esc(l.id)}">${esc(shortName(l.player.name))}</button> <small>${l.team}</small>
        ${l.doubt ? `<span class="inj-tag yellow">Duda</span>` : ""}</td>
      <td class="lg-line">${legLabel(l)}</td>
      <td>${frac(l.season)}</td><td>${frac(l.l10)}</td><td>${frac(l.l5)}</td>
      <td>${frac(l.venue)}</td><td>${l.vsOpp ? frac(l.vsOpp) : "—"}</td>
      <td class="prob">${pc(l.prob)}</td><td>${odds(l.prob)}</td>
      ${ctx.isFinal ? `<td>${resultTag(l)}</td>` : ""}
    </tr>`).join("");

  const venueHdr = "Loc/Vis";
  const picked = legs.filter((l) => myLegs.has(l.id));
  const mine = combine(picked);

  const modelLegs = model?.legs?.filter((x) => x.n) || [];
  const modelTxt = modelLegs.length
    ? `En ${model.games} partidos ya jugados (desde ${model.from.slice(8)}/${model.from.slice(5, 7)}), las patas que el modelo daba en ` +
      modelLegs.map((x) => `${x.range} se cumplieron ${String(x.real).replace(".", ",")}%`).join(", ") + "."
    : "";

  return `
  <div class="card parlays">
    <h3>Parlays sugeridos ${ctx.isFinal ? `<span class="h3-note">· con datos previos al partido</span>` : ""}</h3>
    ${parlays.length ? `<div class="pz-grid">${parlays.map((p) => parlayCard(p, model)).join("")}</div>`
      : `<div class="muted">No hay suficientes patas con probabilidad alta en este partido.</div>`}
  </div>
  <div class="card">
    <h3>Mejores props del partido</h3>
    <div class="tbl-wrap"><table class="props-tbl">
      <thead><tr><th></th><th>Jugador</th><th>Prop</th><th>Temp</th><th>L10</th><th>L5</th><th>${venueHdr}</th><th>vs rival</th><th>Prob.</th><th>Cuota justa</th>${ctx.isFinal ? "<th>Real</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="builder ${picked.length ? "" : "empty"}">
      ${picked.length
        ? `<span><b>Tu parlay:</b> ${picked.map((l) => `${esc(shortName(l.player.name))} ${legLabel(l)}`).join(" + ")}</span>
           <span class="bd-n">Prob. <b>${pc(mine.prob)}</b> · Cuota justa <b>${odds(mine.prob)}</b>${mine.result ? ` · ${{ win: "✓ Se cumplió", lose: "✗ Falló", void: "Nulo" }[mine.result]}` : ""}</span>
           <button type="button" class="lnk" data-clear>Limpiar</button>`
        : `Marca props de la tabla para armar tu propio parlay.`}
    </div>
    <p class="note">"20+ PTS" = 20 o más (en la casa, Over 19.5). Proy. = minutos esperados × su producción por minuto. Prob. estimada = 85% proyección + 15% historial (temporada, L10, L5, local/visita), validada con partidos ya jugados. Cuota justa = 1 ÷ probabilidad: apuesta solo si la casa paga <b>más</b> que eso. Las patas de un mismo partido se influyen entre sí, por eso el parlay real acierta algo menos que la multiplicación. ${modelTxt}</p>
  </div>`;
}

export const findLeg = (id) => known.get(id) || null;

/* ---------------- Parlays del día (todos los partidos) ---------------- */
// ctx: { dayLabel, items: [{ game, teams, isFinal }], injIdx, loading }
export function dayParlaysHTML(ctx, model) {
  const { items, injIdx } = ctx;
  if (ctx.loading) return `<div class="card"><h3>Parlays del día</h3><div class="muted">Cargando jugadores de ${items.length} partidos…</div></div>`;
  const perGame = items.map((it) => computeParlays({ ...it, injIdx }));
  const { tops, parlays } = suggestDayParlays(perGame);
  tops.forEach((l) => (l.showOpp = true));
  parlays.forEach((p) => p.legs.forEach((l) => (l.showOpp = true)));
  const finals = items.filter((i) => i.isFinal).length;

  // mejor pata de cada partido + segunda opción
  const rows = perGame.map((pg, i) => {
    const g = items[i].game;
    const best = pg.legs.filter((l) => !l.out && !l.doubt).slice(0, 2);
    return best.map((l, j) => `<tr class="${myLegs.has(l.id) ? "picked" : ""}">
      <td><input type="checkbox" data-pick="${esc(l.id)}" ${myLegs.has(l.id) ? "checked" : ""} aria-label="Agregar al parlay"></td>
      <td>${j === 0 ? `<button type="button" class="lnk" data-game="${g.id}">${g.away} @ ${g.home}</button>` : ""}</td>
      <td class="pl-cell"><button type="button" class="lnk" data-leg="${esc(l.id)}">${esc(shortName(l.player.name))}</button> <small>${l.team}</small></td>
      <td class="lg-line">${legLabel(l)}</td><td>${dec1(l.proj)}</td>
      <td>${frac(l.season)}</td><td>${frac(l.l10)}</td>
      <td class="prob">${pc(l.prob)}</td><td>${odds(l.prob)}</td>
      ${finals ? `<td>${resultTag(l)}</td>` : ""}</tr>`).join("");
  }).join("");

  const all = new Map(perGame.flatMap((pg) => pg.legs.map((l) => [l.id, l])));
  const picked = [...myLegs].map((id) => all.get(id)).filter(Boolean);
  const mine = combine(picked);

  return `
  <div class="card parlays">
    <h3>Parlays del día <span class="h3-note">· ${esc(ctx.dayLabel)} · ${items.length} partidos</span></h3>
    ${parlays.length ? `<div class="pz-grid">${parlays.map((p) => parlayCard(p, model)).join("")}</div>`
      : `<div class="muted">No hay suficientes patas con probabilidad alta en esta jornada.</div>`}
  </div>
  <div class="card">
    <h3>Mejores patas de cada partido</h3>
    <div class="tbl-wrap"><table class="props-tbl">
      <thead><tr><th></th><th>Partido</th><th>Jugador</th><th>Prop</th><th>Proy.</th><th>Temp</th><th>L10</th><th>Prob.</th><th>Cuota justa</th>${finals ? "<th>Real</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="builder ${picked.length ? "" : "empty"}">
      ${picked.length
        ? `<span><b>Tu parlay:</b> ${picked.map((l) => `${esc(shortName(l.player.name))} ${legLabel(l)}`).join(" + ")}</span>
           <span class="bd-n">Prob. <b>${pc(mine.prob)}</b> · Cuota justa <b>${odds(mine.prob)}</b>${mine.result ? ` · ${{ win: "✓ Se cumplió", lose: "✗ Falló", void: "Nulo" }[mine.result]}` : ""}</span>
           <button type="button" class="lnk" data-clear>Limpiar</button>`
        : `Marca patas de distintos partidos para armar tu propio parlay.`}
    </div>
    <p class="note">Toca un partido para ver su análisis, o un jugador para abrir su gráfico con esa línea. Los jugadores marcados "Fuera" se descartan y los "En duda" no entran a los parlays automáticos.</p>
  </div>`;
}
