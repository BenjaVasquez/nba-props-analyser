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

## Parlays sugeridos (al tocar un partido)

- `js/parlay.js` busca, para cada jugador disponible del partido, la línea "X+" más alta
  (10+, 15+, 20+ pts; 4+, 6+ reb; etc.) que se cumple con alta frecuencia. La probabilidad
  mezcla temporada (40%), últimos 10 (30%), últimos 5 (15%) y local/visita (15%), suavizada
  y calibrada con los resultados reales.
- Arma parlays de 2, 3 y 4 patas (una por jugador) y uno mezclando ambos equipos.
- `scripts/backtest.mjs` prueba el modelo con los partidos ya jugados (usando solo la info
  previa a cada partido) y escribe `data/model.json`. Lo corre solo `update_data.py`.
- En partidos ya jugados la web muestra si cada pata/parlay se cumplió.
