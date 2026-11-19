// Plantillas por equipo (columna central) y ficha del jugador (columna derecha).
import { TEAMS, logoHTML } from "./teams.js";

/* ---------------- formato ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dec = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d).replace(".", ","));
export const fmtHeight = (inch) => (inch ? `${dec(inch * 0.0254, 2)} m` : "—");
export const fmtWeight = (lb) => (lb ? `${Math.round(lb * 0.4536)} kg` : "—");
export const fmtSalary = (n) => (!n ? "—" : n >= 1e6 ? `$${dec(n / 1e6)} M` : `$${Math.round(n / 1e3)} K`);
export const fmtBorn = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtShortDate = (iso) => {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${+d} ${MESES[+m - 1]}`;
};

/* ---------------- fotos ---------------- */
const headshotUrl = (id, w) =>
  w ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=${w}&h=${Math.round(w * 0.727)}&scale=crop`
    : `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function avatarHTML(p, size = 40, big = false) {
  const color = TEAMS[p.team]?.color || "#334155";
  return `<span class="av" style="--tc:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px">
    <img src="${headshotUrl(p.id, big ? 0 : 140)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('fallback');this.remove()">
    <b>${esc(initials(p.name))}</b></span>`;
}

/* ---------------- lesiones ---------------- */
// injuries.json viene por nombre (como en la web anterior); armamos un índice por id también
export function indexInjuries(raw) {
  const byId = new Map(), byName = new Map();
  for (const [name, v] of Object.entries(raw || {})) {
    const rec = { name, ...v };
    byName.set(norm(name), rec);
    if (v.id) byId.set(String(v.id), rec);
  }
  return { byId, byName, count: byName.size };
}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
export const injuryFor = (p, idx) => (idx && (idx.byId.get(String(p.id)) || idx.byName.get(norm(p.name)))) || null;

const STATUS_ES = { out: "Fuera", "day-to-day": "Duda", questionable: "Duda", doubtful: "Dudoso", probable: "Probable", suspension: "Suspendido" };
export function injuryLabel(inj) {
  const st = STATUS_ES[(inj.type || "").toLowerCase()] || inj.type || (inj.status === "red" ? "Fuera" : "Duda");
  const ret = inj.return ? ` · ${fmtShortDate(inj.return)}` : "";
  return `${st}${ret}`;
}
export const groupOf = (inj) => (!inj ? "ok" : inj.status === "red" ? "out" : "doubt");

/* ---------------- columna central: plantillas ---------------- */
function playerRow(p, inj, selectedId) {
  const g = groupOf(inj);
  const avg = p.season_averages || {};
  const sub = [p.bio?.pos, p.num != null ? `#${p.num}` : null, `${avg.gp || 0} PJ`].filter(Boolean).join(" · ");
  const right = g === "ok"
    ? `<span class="pl-stat"><b>${avg.gp ? dec(avg.pts) : "—"}</b><small>PTS</small></span>`
    : `<span class="inj-tag ${inj.status}">${esc(injuryLabel(inj))}</span>`;
  const tip = inj ? ` title="${esc([inj.injury, inj.comment].filter(Boolean).join(" — "))}"` : "";
  return `<button type="button" class="pl ${g} ${p.id === selectedId ? "sel" : ""}" data-pid="${esc(p.id)}" data-team="${p.team}"${tip}>
    ${avatarHTML(p, 38)}
    <span class="pl-main"><span class="pl-name">${esc(p.name)}</span><span class="pl-sub">${esc(sub)}</span></span>
    ${right}</button>`;
}

export function rosterSectionHTML(abbr, teamData, injIdx, { query = "", selectedId = null, side = "" } = {}) {
  const t = TEAMS[abbr] || TEAMS.TBD;
  const head = (counts) => `<div class="team-sec-head">${logoHTML(abbr, 26)}<span class="ts-name">${t.short}</span>
      <span class="ts-side">${side}</span>${counts}</div>`;
  if (abbr === "TBD") return `<section class="team-sec">${head("")}<div class="pl-empty">Equipo por definir.</div></section>`;
  if (!teamData) return `<section class="team-sec" data-team="${abbr}">${head("")}<div class="pl-empty">Cargando plantilla…</div></section>`;
  if (teamData.error) return `<section class="team-sec" data-team="${abbr}">${head("")}<div class="pl-empty">Aún no hay datos de jugadores.<br><small>Se generan con la primera actualización automática.</small></div></section>`;

  const q = norm(query);
  const groups = { ok: [], doubt: [], out: [] };
  for (const p of teamData.players) {
    if (q && !norm(p.name).includes(q)) continue;
    const inj = injuryFor(p, injIdx);
    groups[groupOf(inj)].push(playerRow(p, inj, selectedId));
  }
  const counts = `<span class="ts-cnt"><b>${groups.ok.length}</b> disp.${groups.doubt.length ? ` · <i class="y">${groups.doubt.length}</i>` : ""}${groups.out.length ? ` · <i class="r">${groups.out.length}</i>` : ""}</span>`;
  const block = (key, title) => groups[key].length
    ? `<div class="grp-head ${key}">${title} <span>${groups[key].length}</span></div>${groups[key].join("")}` : "";
  const body = groups.ok.join("") + block("doubt", "En duda") + block("out", "Fuera / lesionados");
  return `<section class="team-sec" data-team="${abbr}">${head(counts)}${body || `<div class="pl-empty">Sin coincidencias.</div>`}</section>`;
}

/* ---------------- columna derecha: ficha del jugador ---------------- */
export function playerPanelHTML(p, inj, game) {
  const t = TEAMS[p.team] || TEAMS.TBD;
  const avg = p.season_averages || {};
  const bio = p.bio || {};
  const games = p.games || [];
  const tiles = [["PTS", avg.pts], ["REB", avg.reb], ["AST", avg.ast], ["3PM", avg.tpm], ["MIN", avg.min], ["PJ", avg.gp, 0]]
    .map(([k, v, d]) => `<div class="tile"><span>${k}</span><b>${dec(v, d ?? 1)}</b></div>`).join("");
  const injBox = inj
    ? `<div class="inj-box ${inj.status}"><b>● ${esc(injuryLabel(inj))}</b>${inj.injury ? ` — ${esc(inj.injury)}` : ""}${inj.comment ? `<p>${esc(inj.comment)}</p>` : ""}</div>` : "";
  const rows = games.slice(0, 10).map((g) => `<tr>
      <td>${fmtShortDate(g.date)}</td><td>${g.home ? "vs" : "@"} ${g.opponent}</td>
      <td class="${g.result === "W" ? "w" : "l"}">${g.result === "W" ? "G" : "P"} ${g.margin > 0 ? "+" : ""}${g.margin}</td>
      <td>${g.min}</td><td class="hl">${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.tpm}</td><td>${g.stl}</td><td>${g.blk}</td></tr>`).join("");
  const backLabel = game ? `${game.away} @ ${game.home}` : "partido";

  return `<div class="pv">
    <button type="button" class="back" data-action="back">‹ Volver a ${esc(backLabel)}</button>
    <div class="pv-head" style="--tc:${t.color}">
      <div class="pv-photo">${avatarHTML(p, 128, true)}</div>
      <div class="pv-info">
        <div class="pv-team">${logoHTML(p.team, 20)} ${esc(t.name)}</div>
        <h1 class="pv-name">${esc(p.name)} ${p.num != null ? `<span>#${esc(p.num)}</span>` : ""}</h1>
        <div class="pv-bio">
          <span>Pos <b>${esc(bio.pos || "—")}</b></span><span>Alt <b>${fmtHeight(bio.height_in)}</b></span>
          <span>Peso <b>${fmtWeight(bio.weight_lb)}</b></span><span>Edad <b>${bio.age ?? "—"}</b></span>
          <span>Nacido <b>${fmtBorn(bio.born)}</b></span><span>Salario <b class="money">${fmtSalary(bio.salary)}</b></span>
        </div>
        ${injBox}
      </div>
    </div>
    <div class="tiles">${tiles}</div>
    <div class="card"><h3>Últimos partidos</h3>${games.length
      ? `<div class="tbl-wrap"><table class="log"><thead><tr><th>Fecha</th><th>Rival</th><th>Res</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th><th>ROB</th><th>TAP</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="muted">Todavía no juega esta temporada.</div>`}</div>
    <p class="note">Siguiente paso: línea de la prop, % de acierto (últimos 5/10/20 y temporada) y gráfico por partido.</p>
  </div>`;
}
