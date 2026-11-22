// Motor v3 de props y parlays.
//
// - Probabilidad para CUALQUIER línea de la casa: "Más de 24.5" / "Menos de 24.5"
//   (mismo modelo v2: 85% proyección normal por minutos × producción por minuto,
//    15% historial suavizado).
// - Patas sugeridas con líneas .5 como las de las casas (no "10+").
// - Generador de muchos parlays dentro de un rango de cuota, con diversidad
//   (no repetir siempre a los mismos jugadores).
import { STATS } from "./propchart.js";
import { injuryFor } from "./players.js";

// Rango de líneas .5 por prop: [mín, máx]
export const GRID = {
  pts: [3.5, 45.5], reb: [1.5, 19.5], ast: [0.5, 14.5], tpm: [0.5, 7.5],
  pra: [8.5, 64.5], pts_reb: [6.5, 54.5], pts_ast: [6.5, 54.5], reb_ast: [2.5, 24.5],
  stl: [0.5, 4.5], blk: [0.5, 4.5],
};
export const SUGGEST_STATS = ["pts", "reb", "ast", "tpm", "pra", "pts_reb", "pts_ast", "reb_ast"];

const MIN_GP = 5, MIN_MIN = 18;
const W_EMP = 0.15, MIN_W = [0.3, 0.3, 0.4], SD_FLOOR = 1.4;

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const smooth = (h, n) => (h + 1) / (n + 2);
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/* ---------------- modelo por jugador ---------------- */
// Contexto del jugador para un partido (o null si no tiene muestra suficiente)
export function playerContext(p, { cutoffDay, isHome, opp, minMin = MIN_MIN }) {
  const all = (p.games || []).filter((g) => g.min > 0 && g.date < cutoffDay); // recientes primero
  if (all.length < MIN_GP) return null;
  const mins = all.map((g) => g.min);
  const l5min = avg(mins.slice(0, 5));
  if (l5min < minMin) return null;
  return {
    player: p, all, isHome, opp,
    expMin: MIN_W[0] * l5min + MIN_W[1] * avg(mins.slice(0, 10)) + MIN_W[2] * avg(mins),
    totMin: mins.reduce((a, b) => a + b, 0),
    venue: all.filter((g) => g.home === isHome),
    vsOpp: all.filter((g) => g.opponent === opp),
    cache: {},
  };
}

export function statModel(ctx, stat) {
  if (ctx.cache[stat]) return ctx.cache[stat];
  const get = STATS[stat].get;
  const vals = ctx.all.map(get);
  const mean = avg(vals);
  const sd0 = Math.sqrt(vals.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  const proj = (vals.reduce((a, b) => a + b, 0) / ctx.totMin) * ctx.expMin;
  const sd = Math.max(sd0 * (proj / Math.max(0.5, mean)), Math.sqrt(Math.max(proj, 0.3)) * SD_FLOOR);
  return (ctx.cache[stat] = {
    stat, vals, v10: vals.slice(0, 10), v5: vals.slice(0, 5),
    vv: ctx.venue.map(get), vo: ctx.vsOpp.map(get), mean, proj, sd,
  });
}

const atLeastCount = (vals, t) => vals.reduce((a, v) => a + (v >= t ? 1 : 0), 0);

// P(valor ≥ t) con t entero
function probAtLeast(m, t) {
  const emp = 0.40 * smooth(atLeastCount(m.vals, t), m.vals.length) + 0.30 * smooth(atLeastCount(m.v10, t), m.v10.length)
            + 0.15 * smooth(atLeastCount(m.v5, t), m.v5.length) + 0.15 * smooth(atLeastCount(m.vv, t), m.vv.length);
  return W_EMP * emp + (1 - W_EMP) * Phi((m.proj - (t - 0.5)) / m.sd);
}

// Probabilidad de que una pata se cumpla. side: "over" (Más de) | "under" (Menos de)
export function legProb(m, line, side = "over") {
  if (side === "under") return 1 - probAtLeast(m, Math.ceil(line));   // 24.5 → ≤24 ; 24 → ≤23
  return probAtLeast(m, needFor(line));                               // 24.5 → ≥25 ; 1 → ≥1 ("1+")
}

// Línea entera = "X o más" (como "1+ triples" en las casas); línea ,5 = "Más de X,5".
export const needFor = (line) => (Number.isInteger(line) ? line : Math.floor(line) + 1);
export const hits = (v, line, side) => (side === "under" ? v < line : v >= needFor(line));
const countHits = (vals, line, side) => vals.reduce((a, v) => a + (hits(v, line, side) ? 1 : 0), 0);

// Arma el objeto "pata" (lo usan sugerencias, apuestas propias y el registro)
export function makeLeg(ctx, m, { game, team, line, side = "over", prob, inj, isFinal, cutoffDay }) {
  const p = ctx.player;
  const actualGame = isFinal ? (p.games || []).find((g) => g.date === cutoffDay) : null;
  return {
    id: `${p.id}:${m.stat}:${side}:${line}`, gameId: game.id, player: p, team, opp: ctx.opp,
    stat: m.stat, line, side, prob: prob ?? legProb(m, line, side), proj: m.proj, avg: m.mean,
    season: [countHits(m.vals, line, side), m.vals.length], l10: [countHits(m.v10, line, side), m.v10.length],
    l5: [countHits(m.v5, line, side), m.v5.length], venue: [countHits(m.vv, line, side), m.vv.length],
    vsOpp: m.vo.length ? [countHits(m.vo, line, side), m.vo.length] : null,
    isHome: ctx.isHome, doubt: inj?.status === "yellow" ? inj : null, out: inj?.status === "red" ? inj : null,
    actual: isFinal ? (actualGame && actualGame.min > 0 ? STATS[m.stat].get(actualGame) : null) : undefined,
  };
}

export const legWon = (l, v = l.actual) => (v == null ? null : hits(v, l.line, l.side));
export { corrFactor };
export const legText = (l) => (l.kind === "ml"
  ? `Gana ${l.team} (${l.isHome ? "local" : "visita"})`
  : l.side !== "under" && Number.isInteger(l.line) ? `${l.line}+ ${STATS[l.stat].short}`
  : `${l.side === "under" ? "Menos de" : "Más de"} ${String(l.line).replace(".", ",")} ${STATS[l.stat].short}`);

/* ---------------- ganador del partido ---------------- */
// Probabilidad de ganar a partir del diferencial de puntos por partido de la temporada
// (70% temporada + 30% últimos 10, encogido hacia 0 con pocos partidos), +1,5 pts de
// localía y desviación de 14 pts. Probado con 134 partidos (1–18 nov): acierta el
// ganador el 67% y queda calibrado (dice 65% → ganó 64%; dice 75% → ganó 78%).
const WIN = { k: 5, hca: 1.5, sd: 14, wr: 0.3 };
export function winProbability(games, game) {
  const net = (team) => {
    const m = games.filter((g) => g.hs != null && g.day < game.day && (g.home === team || g.away === team))
      .map((g) => (g.home === team ? g.hs - g.as : g.as - g.hs));
    if (!m.length) return 0;
    const avgOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return ((1 - WIN.wr) * avgOf(m) + WIN.wr * avgOf(m.slice(-10))) * (m.length / (m.length + WIN.k));
  };
  const nh = net(game.home), na = net(game.away);
  const home = Phi((nh - na + WIN.hca) / WIN.sd);
  return { home, away: 1 - home, netHome: nh, netAway: na };
}

// Patas "Gana X" para el generador (ambos lados; el filtro de probabilidad elige)
export function winLegs(games, game) {
  const wp = winProbability(games, game);
  return [["home", game.home, game.away, wp.home], ["away", game.away, game.home, wp.away]].map(([side, team, opp, prob]) => ({
    id: `ml-${team}:ml:${side}:null`, kind: "ml", gameId: game.id, team, opp, isHome: side === "home", side, stat: "ml", line: null,
    prob, player: { id: `ml-${game.id}`, name: `Gana ${team}`, team }, season: [0, 0], l10: [0, 0], proj: 0,
  }));
}

/* ---------------- patas sugeridas ---------------- */
// Para cada jugador y prop: la línea .5 más alta que alcanza cada nivel de probabilidad.
const TIERS = [0.93, 0.88, 0.83, 0.78, 0.72, 0.65, 0.58]; // los 3 últimos solo para cuotas altas (personalizado)

export function buildCandidates({ teams, game, injIdx, cutoffDay, isFinal, stats = SUGGEST_STATS, minProb = 0.78 }) {
  const out = [];
  for (const abbr of [game.away, game.home]) {
    const data = teams[abbr];
    if (!data?.players) continue;
    const isHome = abbr === game.home;
    const opp = isHome ? game.away : game.home;
    for (const p of data.players) {
      const inj = injuryFor(p, injIdx);
      if (!isFinal && inj?.status === "red") continue;
      const ctx = playerContext(p, { cutoffDay, isHome, opp });
      if (!ctx) continue;
      for (const stat of stats) {
        const m = statModel(ctx, stat);
        const [lo, hi] = GRID[stat];
        const seen = new Set();
        for (const tier of TIERS.filter((x) => x >= minProb)) {
          let best = null;
          for (let line = lo; line <= hi; line += 1) {
            const pr = legProb(m, line, "over");
            if (pr < tier) break;
            best = { line, pr };
          }
          if (best && !seen.has(best.line)) {
            seen.add(best.line);
            out.push(makeLeg(ctx, m, { game, team: abbr, line: best.line, prob: best.pr, inj, isFinal, cutoffDay }));
          }
        }
      }
    }
  }
  out.sort((a, b) => b.prob - a.prob);
  return out;
}

/* ---------------- combinar ---------------- */
// Patas del mismo partido se influyen entre sí: en la prueba con partidos jugados la
// multiplicación sobreestimaba ~4 puntos. Se descuenta un 3% por cada pata extra que
// comparte partido con otra.
export const SAME_GAME = 0.97;
const corrFactor = (legs) => SAME_GAME ** (legs.length - new Set(legs.map((l) => l.gameId)).size);

export function combine(legs) {
  const prob = legs.reduce((a, l) => a * l.prob, 1) * corrFactor(legs);
  let result;
  if (legs.length && legs.every((l) => l.actual !== undefined)) {
    const r = legs.map((l) => legWon(l));
    if (r.some((x) => x === false)) result = "lose";
    else if (r.every((x) => x === true)) result = "win";
    else result = "void"; // alguno no jugó
  }
  return { legs, prob, fair: prob > 0 ? 1 / prob : null, result };
}

/**
 * Genera hasta `count` parlays con cuota justa entre oddsMin y oddsMax.
 * pool: patas candidatas · opts: { count, minLegs, maxLegs, oddsMin, oddsMax,
 *   maxPerPlayer (apariciones de un jugador en la lista), perGameMax (patas por partido),
 *   allowDoubt }
 */
export function generateParlays(pool, opts = {}) {
  const {
    count = 15, minLegs = 2, maxLegs = 4, oddsMin = 1.3, oddsMax = 1.8,
    maxPerPlayer = 4, perGameMax = 99, allowDoubt = false, poolSize = 36,
    maxLegProb = 0.96, // fuera las patas "regaladas" (Más de 0,5…) que casi no suman cuota
    require = null,    // función: cada parlay debe tener al menos una pata que la cumpla
  } = opts;
  const pMin = 1 / oddsMax, pMax = 1 / oddsMin;
  // probabilidad "ideal" por pata para llegar a la cuota pedida con la cantidad de patas pedida
  const kMid = (minLegs + maxLegs) / 2;
  const target = Math.sqrt(pMin * pMax) ** (1 / kMid);
  const lo = Math.max(0.5, target - 0.13), hi = Math.min(maxLegProb, target + 0.12);
  // pool: sin lesionados/dudas, máx. 2 líneas por jugador, repartido en toda la ventana útil
  // de probabilidad (si no, con muchos partidos quedan solo patas de ~92% y todo sale cuota 1,30)
  const eligible = [...pool].sort((a, b) => b.prob - a.prob)
    .filter((l) => !l.out && (allowDoubt || !l.doubt) && l.prob <= hi && l.prob >= lo);
  const BINS = 5, per = Math.ceil(poolSize / BINS), w = (hi - lo) / BINS;
  const perPlayer = new Map(), taken = new Set();
  const legs = [];
  const take = (l) => {
    const c = perPlayer.get(l.player.id) || 0;
    if (c >= 2 || taken.has(l.id)) return false;
    perPlayer.set(l.player.id, c + 1); taken.add(l.id); legs.push(l);
    return true;
  };
  for (let b = 0; b < BINS; b++) {
    const top = hi - b * w, bot = top - w;
    let n = 0;
    for (const l of eligible) if (l.prob <= top && l.prob > bot - 1e-9 && n < per && take(l)) n++;
  }
  for (const l of eligible) { if (legs.length >= poolSize) break; take(l); } // completar
  // patas obligatorias (ej. ganador del partido): entran siempre que tengan prob. razonable
  if (require) for (const l of pool) if (require(l) && !l.out && l.prob >= 0.5 && l.prob <= Math.max(hi, 0.9)) take(l);
  legs.sort((a, b) => b.prob - a.prob);
  // búsqueda en profundidad con poda (la probabilidad solo baja al sumar patas)
  const found = [];
  const pick = [];
  const usedPlayers = new Set(), perGame = new Map();
  const perGameDistinct = () => [...perGame.values()].filter((v) => v > 0).length;
  (function dfs(start, raw) {
    const prob = raw * SAME_GAME ** (pick.length - perGameDistinct());
    if (pick.length >= minLegs && prob >= pMin && prob <= pMax && (!require || pick.some(require))) found.push({ legs: [...pick], prob });
    if (pick.length >= maxLegs) return;
    for (let i = start; i < legs.length; i++) {
      const l = legs[i];
      const np = raw * l.prob;
      if (np * SAME_GAME ** pick.length < pMin) continue;
      if (usedPlayers.has(l.player.id)) continue;
      const g = perGame.get(l.gameId) || 0;
      if (g >= perGameMax) continue;
      pick.push(l); usedPlayers.add(l.player.id); perGame.set(l.gameId, g + 1);
      dfs(i + 1, np);
      pick.pop(); usedPlayers.delete(l.player.id); perGame.set(l.gameId, g);
      if (found.length > 150000) return;
    }
  })(0, 1);

  // orden: más probables primero; a igual prob., menos patas
  found.sort((a, b) => b.prob - a.prob || a.legs.length - b.legs.length);
  // diversidad: tramos de cuota en ronda + límite de apariciones por jugador
  const bands = [[oddsMin, oddsMin + (oddsMax - oddsMin) / 3], [oddsMin + (oddsMax - oddsMin) / 3, oddsMin + (2 * (oddsMax - oddsMin)) / 3], [oddsMin + (2 * (oddsMax - oddsMin)) / 3, oddsMax + 1e-9]];
  const byBand = bands.map(([a, b]) => found.filter((f) => 1 / f.prob >= a && 1 / f.prob < b));
  const chosen = [], appear = new Map(), keys = new Set();
  const ok = (f) => {
    const key = f.legs.map((l) => l.id).sort().join("|");
    if (keys.has(key)) return false;
    const free = (l) => require && require(l); // las patas obligatorias pueden repetirse
    if (f.legs.some((l) => !free(l) && (appear.get(l.player.id) || 0) >= maxPerPlayer)) return false;
    // que no comparta todas menos una pata con otro ya elegido
    for (const c of chosen) {
      const shared = f.legs.filter((l) => !free(l) && c.legs.some((x) => x.player.id === l.player.id)).length;
      if (shared >= Math.max(2, Math.min(f.legs.length, c.legs.length))) return false;
    }
    keys.add(key);
    return true;
  };
  const idx = [0, 0, 0];
  let progress = true;
  while (chosen.length < count && progress) {
    progress = false;
    for (let b = 0; b < 3 && chosen.length < count; b++) {
      while (idx[b] < byBand[b].length) {
        const f = byBand[b][idx[b]++];
        if (ok(f)) {
          chosen.push(f);
          f.legs.forEach((l) => appear.set(l.player.id, (appear.get(l.player.id) || 0) + 1));
          progress = true;
          break;
        }
      }
    }
  }
  return chosen
    .map((f) => ({ ...combine(f.legs) }))
    .sort((a, b) => b.prob - a.prob);
}
