# NBA Props Analyser

Web estática (HTML + CSS + JS, sin paso de build) publicada en Netlify.
Los datos viven en `data/` dentro del repositorio de GitHub y un robot (GitHub Actions)
los actualiza varias veces al día desde ESPN. La web los lee directo desde GitHub,
así que **las actualizaciones de datos no gastan publicaciones de Netlify**.

## Estructura

```
index.html                 3 columnas: Calendario | Plantillas | Análisis
css/styles.css             Estilos
js/config.js               ← aquí va tu "usuario/repositorio" de GitHub
js/app.js                  Calendario, resumen del partido, navegación
js/players.js              Plantillas con lesionados separados y ficha del jugador
js/teams.js                Equipos (abreviatura, id NBA para logos, color)
data/fixture.json          Calendario 2026-27 + resultados
data/injuries.json         Lesionados (mismo formato que la web anterior)
data/players/XXX.json      Un archivo por equipo: bio, promedios y partidos de la temporada
scripts/build_fixture.py   Excel del calendario -> data/fixture.json
scripts/update_data.py     Descarga resultados, box scores, plantillas y lesionados
robot-github/update-data.yml   Robot (va en .github/workflows/): corre update_data.py 5 veces al día
netlify.toml               Netlify no republica cuando solo cambian datos
```

## Puesta en marcha (una sola vez)

1. **Crear el repositorio** en https://github.com/new → nombre `nba-props-analyser`,
   visibilidad **Public** (la web lee los datos públicamente desde GitHub). Crear.
2. En el repositorio vacío: *uploading an existing file* → arrastra **todo el contenido**
   de la carpeta `NBA STATS` → *Commit changes*.
3. **Activar el robot**: en GitHub, *Add file → Create new file*, escribe como nombre
   `.github/workflows/update-data.yml`, pega el contenido de `robot-github/update-data.yml`
   y *Commit*. (GitHub solo reconoce el robot en esa carpeta.)
4. Pestaña **Actions** → *Actualizar datos NBA* → **Run workflow**. Tarda unos minutos
   la primera vez (descarga toda la temporada). Al terminar aparece `data/players/`.
5. Edita `js/config.js` en GitHub (ícono del lápiz) y pon tu repositorio:
   `export const GITHUB_REPO = "TU_USUARIO/nba-props-analyser";` → *Commit*.
6. **Netlify**: *Add new project → Import an existing project → GitHub* → elige el repo.
   Build command: vacío. Publish directory: `.` → *Deploy*.
   En *Project configuration* puedes cambiar el nombre (ej. `benjanba-props.netlify.app`).

Desde ahí: el robot actualiza los datos solo y la web los muestra (GitHub los sirve con
unos 5 minutos de caché). Netlify solo vuelve a publicar cuando cambia el código.

## Probar en tu computador

```
python scripts/update_data.py      # opcional: genera los datos localmente
python -m http.server 8000         # y abre http://localhost:8000
```

## Calendario desde el Excel

```
pip install openpyxl
python scripts/build_fixture.py "nba-2026-UTC.xlsx" data/fixture.json
```

## Parlays sugeridos (modelo v2)

- `js/parlay.js`: para cada jugador disponible y cada prop calcula la probabilidad de cada
  línea alternativa "X+" (10+, 15+, 20+ pts; 4+, 6+ reb; etc.).
  Prob = 85% proyección (minutos esperados 0,3·L5 + 0,3·L10 + 0,4·temporada × producción por
  minuto, con distribución normal según la variabilidad del jugador) + 15% historial
  (temporada, L10, L5, local/visita). Elegido probando contra partidos ya jugados:
  defensa del rival, back-to-back y diferencia de nivel no mejoraron y se dejaron fuera.
- Por partido: Doble, Triple, Cuádruple, Ambos equipos y "Valor" (líneas en o sobre el
  promedio del jugador, 62–76%).
- Botón "🎯 Parlays del día": una pata de cada partido distinto de la jornada (2, 3 y 4 patas).
- `scripts/backtest.mjs` prueba todo con los partidos ya jugados (solo con info previa a cada
  partido) y escribe `data/model.json`; la web muestra ese "acierto real". Lo corre
  `update_data.py` en cada actualización.

## App en el celular (PWA)

`manifest.webmanifest`, `sw.js` e `icons/` hacen que la web se pueda instalar:
en Android abre la web en Chrome → menú ⋮ → **Instalar app** (o "Agregar a pantalla principal").
Sin conexión muestra la última copia descargada. Si cambias `sw.js`, sube `VERSION`.

## Marcador en vivo

`js/live.js` consulta el marcador de ESPN directo desde el navegador cada 30 s solo
mientras hay partidos en juego (90 s si están por empezar, 5 min si no hay nada cerca)
y se detiene con la app en segundo plano. Muestra score, cuarto y reloj en el calendario,
el score por cuartos en el partido, y cuánto lleva cada jugador en las patas de los parlays.

## Mantenimiento automático

- El robot corre 8 veces al día (ver `.github/workflows/update-data.yml`).
- Si una actualización falla, abre un aviso ("issue") en GitHub, que te llega por correo,
  y lo cierra solo cuando vuelve a funcionar. La web marca ⚠ si los datos tienen más de 14 h.
