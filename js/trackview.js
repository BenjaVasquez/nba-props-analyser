// Vista "📈 Registro": rendimiento REAL de los picks guardados antes de cada partido.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (iso) => { const [, m, d] = iso.split("-"); return `${+d} ${MESES[+m - 1]}`; };
const num = (v) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);
const tone = (real, est) => (real == null || est == null ? "" : real >= est ? "good" : real >= est - 8 ? "mid" : "bad");
const ICON = { win: "✓", lose: "✗", void: "–" };

export function trackingHTML(t) {
  const head = `<div class="day-hero"><div class="big">📈 Registro de picks</div>
    <div class="sub">La prueba real del modelo: los parlays se guardan <b>antes</b> de cada partido (con los lesionados de ese momento) y se marcan cuando termina.</div></div>`;
  const hasData = t && (t.parlays?.length || t.days?.length);
  if (!hasData) {
    return `${head}<div class="card"><h3>Aún sin resultados</h3>
      <p class="muted">El registro empezó ${t?.since ? `el ${fecha(t.since)}` : "hoy"}. El robot guarda los picks de cada jornada antes de los partidos
      y los primeros resultados aparecen la mañana siguiente (actualización de las 06:20).</p></div>`;
  }
  const order = ["Partido · 2 patas", "Partido · 3 patas", "Partido · 4 patas", "Día · 2 patas", "Día · 3 patas",
    "Doble seguro", "Triple", "Cuádruple", "Ambos equipos", "Valor", "Día 2 patas", "Día 3 patas", "Día 4 patas"];
  const parlays = [...t.parlays].sort((a, b) => (order.indexOf(a.name) + 99) % 99 - (order.indexOf(b.name) + 99) % 99);
  const rows = parlays.map((p) => {
    const dec = p.win + p.lose;
    return `<tr><td class="tl">${p.name}</td><td>${dec}</td><td class="w">${p.win}</td><td class="l">${p.lose}</td><td>${p.void}</td>
      <td class="big-n ${tone(p.real, p.est)}">${num(p.real)}</td><td>${num(p.est)}</td></tr>`;
  }).join("");
  const legs = (t.legs || []).map((b) => `<div class="split ${tone(b.real, b.est)}"><span>Prob. ${b.range}</span>
      <b>${num(b.real)}</b><small>${b.n} patas · est. ${num(b.est)}</small></div>`).join("");
  const days = (t.days || []).slice(0, 14).map((d) => {
    const w = d.parlays.filter((p) => p.result === "win").length, l = d.parlays.filter((p) => p.result === "lose").length;
    const chips = d.parlays.map((p) => `<span class="tk ${p.result}" title="${p.matchup} · ${p.name} · prob ${Math.round(p.prob * 100)}%">${ICON[p.result]} ${p.matchup === "Día" ? "🎯 " : ""}${p.name.replace("Día ", "")}${p.matchup !== "Día" ? ` <small>${p.matchup}</small>` : ""}</span>`).join("");
    return `<div class="tk-day"><div class="tk-h"><b>${fecha(d.day)}</b><span>${w} ganados · ${l} perdidos</span></div><div class="tk-list">${chips}</div></div>`;
  }).join("");

  return `${head}
    <div class="card"><h3>Parlays · desde ${fecha(t.since)}</h3>
      <div class="tbl-wrap"><table class="props-tbl track-tbl">
        <thead><tr><th>Tipo</th><th>Jugados</th><th>Ganados</th><th>Perdidos</th><th>Nulos</th><th>Acierto real</th><th>Prob. estimada</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="note">Verde: acierta igual o más de lo que estimaba el modelo · Amarillo: hasta 8 puntos menos · Rojo: más de 8 puntos menos.
      Nulos = algún jugador no jugó (en la casa normalmente esa pata se anula). Con pocas semanas de datos los porcentajes todavía se mueven mucho.</p></div>
    ${legs ? `<div class="card"><h3>Patas individuales</h3><div class="splits">${legs}</div></div>` : ""}
    <div class="card"><h3>Últimos días</h3>${days || `<div class="muted">Sin días cerrados todavía.</div>`}</div>`;
}
