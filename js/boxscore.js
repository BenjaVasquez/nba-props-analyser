// Box score (planilla por jugador) con pestañas: visita · local · estadísticas.
import { TEAMS, logoHTML } from "./teams.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const POS = { G: "B", F: "A", C: "P" }; // base · alero · pívot
const COLS = [["min", "MIN"], ["pts", "PTS"], ["fg", "TC"], ["tp", "3P"], ["ft", "TL"], ["reb", "REB"], ["ast", "AST"],
  ["stl", "STL"], ["blk", "BLK"], ["tov", "P"], ["pf", "FP"], ["pm", "+/-"]];
const TIPS = { min: "Minutos", pts: "Puntos", fg: "Tiros de campo (anotados-intentados)", tp: "Triples", ft: "Tiros libres", reb: "Rebotes",
  ast: "Asistencias", stl: "Robos", blk: "Tapones", tov: "Pérdidas", pf: "Faltas personales", pm: "Más/menos con él en cancha" };
const REASON = { "COACH'S DECISION": "decisión técnica", "DID NOT DRESS": "no vistió", INACTIVE: "inactivo", "NOT WITH TEAM": "no está con el equipo" };

const TEAM_ROWS = [
  ["fieldGoalsMade-fieldGoalsAttempted", "Tiros de campo"], ["fieldGoalPct", "% Tiros de campo", "%"],
  ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "Triples"], ["threePointFieldGoalPct", "% Triples", "%"],
  ["freeThrowsMade-freeThrowsAttempted", "Tiros libres"], ["freeThrowPct", "% Tiros libres", "%"],
  ["totalRebounds", "Rebotes"], ["offensiveRebounds", "Rebotes ofensivos"], ["defensiveRebounds", "Rebotes defensivos"],
  ["assists", "Asistencias"], ["steals", "Robos"], ["blocks", "Tapones"], ["totalTurnovers", "Pérdidas"],
  ["turnoverPoints", "Puntos tras pérdidas"], ["fastBreakPoints", "Puntos de contraataque"], ["pointsInPaint", "Puntos en la pintura"],
  ["fouls", "Faltas"], ["largestLead", "Ventaja máxima"], ["leadChanges", "Cambios de líder"], ["leadPercentage", "% del tiempo arriba", "%"],
];

function teamTable(t, highlight) {
  const played = t.players.filter((p) => !p.dnp);
  const dnp = t.players.filter((p) => p.dnp);
  // líderes del equipo en PTS, REB y AST
  const lead = {};
  for (const k of ["pts", "reb", "ast"]) lead[k] = Math.max(0, ...played.map((p) => +p.s[k] || 0));
  const row = (p) => `<tr class="${highlight.has(p.id) ? "hl" : ""}${p.ejected ? " ej" : ""}">
      <td class="bx-name" title="${esc(p.name)}"><span class="bx-num">${esc(p.num ?? "")}</span>${esc(p.name)}${p.starter && p.pos ? ` <small>· ${POS[p.pos[0]] || p.pos}</small>` : ""}${highlight.has(p.id) ? ` <span class="bx-star" title="Está en tus parlays">★</span>` : ""}</td>
      ${COLS.map(([k]) => {
        const v = p.s[k] ?? "";
        const top = lead[k] && +v === lead[k] ? " top" : "";
        const pm = k === "pm" ? (String(v).startsWith("+") ? " pos" : String(v).startsWith("-") ? " neg" : "") : "";
        return `<td class="c-${k}${top}${pm}">${esc(v)}</td>`;
      }).join("")}
    </tr>`;
  const starters = played.filter((p) => p.starter), bench = played.filter((p) => !p.starter);
  return `<div class="bx-wrap"><table class="bx">
    <thead><tr><th class="bx-name">Jugador</th>${COLS.map(([k, l]) => `<th class="c-${k}" title="${TIPS[k]}">${l}</th>`).join("")}</tr></thead>
    <tbody>${starters.map(row).join("")}
      ${bench.length ? `<tr class="bx-sep"><td colspan="${COLS.length + 1}">Banca</td></tr>${bench.map(row).join("")}` : ""}
      ${dnp.map((p) => `<tr class="bx-dnp"><td class="bx-name"><span class="bx-num">${esc(p.num ?? "")}</span>${esc(p.name)}</td>
        <td colspan="${COLS.length}">No jugó${p.reason ? ` · ${esc(REASON[p.reason] || p.reason.toLowerCase())}` : ""}</td></tr>`).join("")}
    </tbody>
    <tfoot><tr><td class="bx-name">Totales</td>${COLS.map(([k]) => `<td>${k === "min" || k === "pm" ? "" : esc(t.totals[k] ?? "")}</td>`).join("")}</tr></tfoot>
  </table></div>`;
}

function statsTable(away, home) {
  const val = (t, k, suf) => { const v = t.stats[k]; return v == null || v === "" ? "—" : `${v}${suf || ""}`; };
  const num = (v) => parseFloat(String(v).split("-")[0]);
  const rows = TEAM_ROWS.filter(([k]) => away.stats[k] != null || home.stats[k] != null).map(([k, label, suf]) => {
    const a = val(away, k, suf), h = val(home, k, suf);
    const lowerBetter = ["totalTurnovers", "fouls"].includes(k);
    const na = num(away.stats[k]), nh = num(home.stats[k]);
    const best = Number.isFinite(na) && Number.isFinite(nh) && na !== nh ? ((na > nh) !== lowerBetter ? "a" : "h") : "";
    return `<tr><td class="${best === "a" ? "better" : ""}">${a}</td><td>${label}</td><td class="${best === "h" ? "better" : ""}">${h}</td></tr>`;
  }).join("");
  return `<table class="cmp bx-cmp"><thead><tr><th>${logoHTML(away.abbr, 20)} ${away.abbr}</th><th></th><th>${home.abbr} ${logoHTML(home.abbr, 20)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * full: box score de live.loadBox · game: partido del calendario
 * opts: { tab: "away" | "home" | "stats", highlight: Set(id de jugador), loading, error }
 */
export function boxScoreHTML(full, game, { tab = "away", highlight = new Set(), loading = false, error = false, title = true } = {}) {
  const head = title ? `<h3>Box score ${full?.detail ? `<span class="h3-note">· ${esc(full.detail)}</span>` : ""}</h3>` : "";
  if (!full) {
    return `<div class="card bxcard">${head}<div class="muted">${error ? "No se pudo cargar el box score. Se reintenta solo." : loading ? "Cargando box score…" : "El box score aparece cuando empieza el partido."}</div></div>`;
  }
  const away = full.teams.find((t) => t.abbr === game.away) || full.teams[0];
  const home = full.teams.find((t) => t.abbr === game.home) || full.teams[1];
  if (!away || !home) return `<div class="card bxcard">${head}<div class="muted">Box score no disponible todavía.</div></div>`;
  const tabs = [["away", TEAMS[away.abbr]?.short || away.abbr], ["home", TEAMS[home.abbr]?.short || home.abbr], ["stats", "Estadísticas"]];
  const body = tab === "stats" ? statsTable(away, home) : teamTable(tab === "home" ? home : away, highlight);
  return `<div class="card bxcard">${head}
    <div class="bx-tabs">${tabs.map(([k, l]) => `<button type="button" data-boxtab="${k}" class="${tab === k ? "on" : ""}">${k !== "stats" ? logoHTML(k === "home" ? home.abbr : away.abbr, 18) : ""}${esc(l)}</button>`).join("")}</div>
    ${body}
    <p class="note">TC = tiros de campo · 3P = triples · TL = tiros libres · P = pérdidas · FP = faltas personales · A/B/P = alero/base/pívot (titulares) · ★ = jugador en tus parlays.</p>
  </div>`;
}
