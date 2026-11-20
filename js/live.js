// Marcador en vivo: consulta ESPN directo desde el navegador (sin servidor) solo
// mientras hay partidos por empezar o en juego, y se detiene con la app en segundo plano.
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ABBR = { NY: "NYK", GS: "GSW", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const abbr = (t) => ABBR[(t?.abbreviation || "").toUpperCase()] || (t?.abbreviation || "").toUpperCase();

const FAST = 30 * 1000;        // con partidos en juego
const MEDIUM = 90 * 1000;      // partidos por empezar (próximos 30 min)
const SLOW = 5 * 60 * 1000;    // nada cerca: solo revisa si algo cambió
const WINDOW_BEFORE = 30 * 60 * 1000, WINDOW_AFTER = 4 * 60 * 60 * 1000;

export const live = {
  games: new Map(), // id del calendario -> { state, detail, period, clock, hs, as, espnId, lines }
  box: new Map(),   // espnId -> Map(id de jugador -> estadísticas actuales)
  full: new Map(),  // espnId -> box score completo (planilla por jugador + stats de equipo)
};

// Planilla completa: jugadores (titulares, suplentes, no jugaron), totales y stats de equipo
const COLS = {
  minutes: "min", points: "pts", "fieldGoalsMade-fieldGoalsAttempted": "fg", "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "tp",
  "freeThrowsMade-freeThrowsAttempted": "ft", rebounds: "reb", assists: "ast", turnovers: "tov", steals: "stl", blocks: "blk",
  offensiveRebounds: "oreb", defensiveRebounds: "dreb", fouls: "pf", plusMinus: "pm",
};
function parseFull(summary) {
  const stats = new Map();
  for (const t of summary?.boxscore?.teams || []) {
    stats.set(abbr(t.team), Object.fromEntries((t.statistics || []).map((x) => [x.name, x.displayValue])));
  }
  const teams = (summary?.boxscore?.players || []).map((block) => {
    const st = block.statistics?.[0] || {};
    const keys = st.keys || [];
    const row = (vals) => Object.fromEntries((vals || []).map((v, i) => [COLS[keys[i]] || keys[i], v]));
    const ab = abbr(block.team);
    return {
      abbr: ab,
      players: (st.athletes || []).map((a) => ({
        id: String(a.athlete?.id), name: a.athlete?.displayName, short: a.athlete?.shortName,
        num: a.athlete?.jersey, pos: a.athlete?.position?.abbreviation, starter: !!a.starter,
        dnp: !!a.didNotPlay || !(a.stats || []).length, reason: a.reason, ejected: !!a.ejected, s: row(a.stats),
      })),
      totals: row(st.totals), stats: stats.get(ab) || {},
    };
  });
  const comp = summary?.header?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  return { teams, homeAbbr: home ? abbr(home.team) : null, detail: comp?.status?.type?.shortDetail || "", at: Date.now() };
}

// Trae (o reutiliza) el box score de un partido. Los finales se guardan para toda la sesión.
const pending = new Map();
export async function loadBox(espnId, { force = false } = {}) {
  if (!espnId) return null;
  const have = live.full.get(espnId);
  if (have && !force && (have.final || Date.now() - have.at < 25000)) return have;
  if (pending.has(espnId)) return pending.get(espnId);
  const pr = getJSON(`${ESPN}/summary?event=${espnId}`).then((sum) => {
    const full = parseFull(sum);
    full.final = /final/i.test(full.detail);
    live.full.set(espnId, full);
    live.box.set(espnId, parseBox(sum));
    return full;
  }).finally(() => pending.delete(espnId));
  pending.set(espnId, pr);
  return pr;
}

const STAT_MAP = { minutes: "min", points: "pts", rebounds: "reb", assists: "ast", steals: "stl", blocks: "blk", turnovers: "tov" };

function parseBox(summary) {
  const out = new Map();
  for (const block of summary?.boxscore?.players || []) {
    for (const st of block.statistics || []) {
      const keys = st.keys || [];
      for (const a of st.athletes || []) {
        const s = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, tpm: 0, min: 0 };
        (a.stats || []).forEach((v, i) => {
          const k = keys[i];
          if (STAT_MAP[k]) s[STAT_MAP[k]] = parseInt(v, 10) || 0;
          else if (k === "threePointFieldGoalsMade-threePointFieldGoalsAttempted") s.tpm = parseInt(String(v).split("-")[0], 10) || 0;
        });
        out.set(String(a.athlete?.id), s);
      }
    }
  }
  return out;
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * opts: getGames() -> partidos del calendario (con start, day, home, away, id)
 *       getWatched() -> id del calendario del partido abierto (para su box score)
 *       onUpdate(ids) -> se llama cuando cambia algo
 */
export function startLive({ getGames, getWatched, onUpdate }) {
  let timer = null, busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    let next = SLOW;
    try {
      const now = Date.now();
      const near = getGames().filter((g) => g.home !== "TBD" && g.away !== "TBD" &&
        now > g.start - WINDOW_BEFORE && now < +g.start + WINDOW_AFTER &&
        live.games.get(g.id)?.state !== "post");
      if (near.length) {
        const days = [...new Set(near.map((g) => g.day.replaceAll("-", "")))];
        const changed = [];
        for (const d of days) {
          const sb = await getJSON(`${ESPN}/scoreboard?dates=${d}`);
          for (const ev of sb.events || []) {
            const comp = ev.competitions?.[0];
            const home = comp?.competitors?.find((c) => c.homeAway === "home");
            const away = comp?.competitors?.find((c) => c.homeAway === "away");
            if (!home || !away) continue;
            const t = new Date(ev.date);
            const g = getGames().find((x) => x.home === abbr(home.team) && x.away === abbr(away.team) && Math.abs(x.start - t) < 20 * 3600e3);
            if (!g) continue;
            const s = ev.status || {};
            const info = {
              state: s.type?.state || "pre",                 // pre | in | post
              detail: s.type?.shortDetail || "",              // "Q3 5:42", "Halftime", "Final"
              period: s.period || 0, clock: s.displayClock || "",
              hs: parseInt(home.score, 10), as: parseInt(away.score, 10), espnId: ev.id,
              lines: { home: (home.linescores || []).map((l) => l.value), away: (away.linescores || []).map((l) => l.value) },
            };
            const prev = live.games.get(g.id);
            if (!prev || prev.detail !== info.detail || prev.hs !== info.hs || prev.as !== info.as) {
              if (prev?.boxFinal && info.state === "post") info.boxFinal = true;
              live.games.set(g.id, info);
              changed.push(g.id);
            }
          }
        }
        // box score de los partidos abiertos o con patas seguidas (en juego o recién terminados)
        const watched = [].concat(getWatched() ?? []);
        for (const wid of [...new Set(watched)]) {
          const w = live.games.get(wid);
          if (!w || w.state === "pre") continue;
          if (w.state === "post" && w.boxFinal) continue; // ya tenemos el final
          try {
            await loadBox(w.espnId, { force: true });
            if (w.state === "post") w.boxFinal = true;
            if (!changed.includes(wid)) changed.push(wid);
          } catch (err) { console.warn("Box score en vivo:", err.message); }
        }
        if (changed.length) onUpdate(changed);
        const anyIn = [...live.games.values()].some((x) => x.state === "in");
        next = anyIn ? FAST : MEDIUM;
      }
    } catch (err) {
      console.warn("Marcador en vivo:", err.message);
      next = MEDIUM;
    } finally {
      busy = false;
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(tick, next);
    }
  }

  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) tick();
  });
  tick();
  return { now: tick };
}

// Valor en vivo de una prop para un jugador (o null si no hay datos)
export function liveStat(gameId, playerId, get) {
  const g = live.games.get(gameId);
  const s = g && live.box.get(g.espnId)?.get(String(playerId));
  return s ? get(s) : null;
}
