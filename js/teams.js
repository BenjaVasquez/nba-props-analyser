// Equipos NBA: abreviatura -> id oficial (para logos del CDN de la NBA), nombre y color.
export const TEAMS = {
  ATL: { id: 1610612737, name: "Atlanta Hawks", short: "Hawks", color: "#E03A3E" },
  BOS: { id: 1610612738, name: "Boston Celtics", short: "Celtics", color: "#007A33" },
  BKN: { id: 1610612751, name: "Brooklyn Nets", short: "Nets", color: "#3a3a3a" },
  CHA: { id: 1610612766, name: "Charlotte Hornets", short: "Hornets", color: "#1D1160" },
  CHI: { id: 1610612741, name: "Chicago Bulls", short: "Bulls", color: "#CE1141" },
  CLE: { id: 1610612739, name: "Cleveland Cavaliers", short: "Cavaliers", color: "#860038" },
  DAL: { id: 1610612742, name: "Dallas Mavericks", short: "Mavericks", color: "#00538C" },
  DEN: { id: 1610612743, name: "Denver Nuggets", short: "Nuggets", color: "#0E2240" },
  DET: { id: 1610612765, name: "Detroit Pistons", short: "Pistons", color: "#C8102E" },
  GSW: { id: 1610612744, name: "Golden State Warriors", short: "Warriors", color: "#1D428A" },
  HOU: { id: 1610612745, name: "Houston Rockets", short: "Rockets", color: "#CE1141" },
  IND: { id: 1610612754, name: "Indiana Pacers", short: "Pacers", color: "#002D62" },
  LAC: { id: 1610612746, name: "LA Clippers", short: "Clippers", color: "#C8102E" },
  LAL: { id: 1610612747, name: "Los Angeles Lakers", short: "Lakers", color: "#552583" },
  MEM: { id: 1610612763, name: "Memphis Grizzlies", short: "Grizzlies", color: "#5D76A9" },
  MIA: { id: 1610612748, name: "Miami Heat", short: "Heat", color: "#98002E" },
  MIL: { id: 1610612749, name: "Milwaukee Bucks", short: "Bucks", color: "#00471B" },
  MIN: { id: 1610612750, name: "Minnesota Timberwolves", short: "Timberwolves", color: "#0C2340" },
  NOP: { id: 1610612740, name: "New Orleans Pelicans", short: "Pelicans", color: "#0C2340" },
  NYK: { id: 1610612752, name: "New York Knicks", short: "Knicks", color: "#006BB6" },
  OKC: { id: 1610612760, name: "Oklahoma City Thunder", short: "Thunder", color: "#007AC1" },
  ORL: { id: 1610612753, name: "Orlando Magic", short: "Magic", color: "#0077C0" },
  PHI: { id: 1610612755, name: "Philadelphia 76ers", short: "76ers", color: "#006BB6" },
  PHX: { id: 1610612756, name: "Phoenix Suns", short: "Suns", color: "#1D1160" },
  POR: { id: 1610612757, name: "Portland Trail Blazers", short: "Trail Blazers", color: "#E03A3E" },
  SAC: { id: 1610612758, name: "Sacramento Kings", short: "Kings", color: "#5A2D81" },
  SAS: { id: 1610612759, name: "San Antonio Spurs", short: "Spurs", color: "#6b7177" },
  TOR: { id: 1610612761, name: "Toronto Raptors", short: "Raptors", color: "#CE1141" },
  UTA: { id: 1610612762, name: "Utah Jazz", short: "Jazz", color: "#002B5C" },
  WAS: { id: 1610612764, name: "Washington Wizards", short: "Wizards", color: "#002B5C" },
  TBD: { id: null, name: "Por definir", short: "Por definir", color: "#334155" },
};

export const logoUrl = (abbr) => {
  const t = TEAMS[abbr];
  return t && t.id ? `https://cdn.nba.com/logos/nba/${t.id}/global/L/logo.svg` : null;
};

// Logo con respaldo: si la imagen no carga (sin internet, CDN caído), muestra un
// escudo con la abreviatura y el color del equipo.
export function logoHTML(abbr, size = 36) {
  const t = TEAMS[abbr] || TEAMS.TBD;
  const badge = `<span class="logo-badge" style="--tc:${t.color};width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.3))}px">${abbr === "TBD" ? "?" : abbr}</span>`;
  const url = logoUrl(abbr);
  if (!url) return `<span class="logo fallback" style="width:${size}px;height:${size}px">${badge}</span>`;
  return `<span class="logo" style="width:${size}px;height:${size}px"><img src="${url}" alt="${t.name}" width="${size}" height="${size}" loading="lazy" onerror="this.parentNode.classList.add('fallback');this.remove()">${badge}</span>`;
}
