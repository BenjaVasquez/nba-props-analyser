// ====================================================================
//  CONFIGURACIÓN
// ====================================================================
// Repositorio público de GitHub donde el robot diario guarda los datos.
// Formato "usuario/repositorio", por ejemplo "benja/nba-props-analyser".
// Mientras esté vacío, la web lee la carpeta data/ que viene con la página.
export const GITHUB_REPO = "BenjaVasquez/nba-props-analyser";
export const GITHUB_BRANCH = "main";

// Los datos se leen directo desde GitHub (raw) para que las actualizaciones
// de cada día NO necesiten volver a publicar en Netlify (cada publicación
// gasta créditos del plan gratis). En tu computador (localhost) se usa data/ local.
const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
export const DATA_BASE = GITHUB_REPO && !isLocal
  ? `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/data/`
  : "data/";

export const dataUrl = (file) => DATA_BASE + file;
