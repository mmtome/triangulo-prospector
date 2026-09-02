/**
 * Catálogo dos modelos de site disponíveis para clonar.
 *
 * Os modelos moram fora deste projeto, em `../modelos site/<nicho>/<modelo>/`,
 * porque são produto (cada um é um site de verdade, com repositório e deploy
 * próprios) e o Prospector é ferramenta. Copiá-los para cá criaria duas cópias
 * do mesmo site divergindo em silêncio.
 *
 * Um modelo só aparece na lista se tiver `dist/index.html` — ou seja, se
 * estiver buildado. Modelo sem build não tem o que servir, e mostrá-lo na tela
 * só renderia um botão que falha.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const PASTA_MODELOS = join(RAIZ, "..", "modelos site");

/** `Pet Shop · Modelo 1` a partir de `pet shop/modelo-1`. */
function rotular(nicho, pasta) {
  const bonito = (s) =>
    s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  return bonito(nicho) + " · " + bonito(pasta);
}

export function listarModelos() {
  if (!existsSync(PASTA_MODELOS)) return [];

  const modelos = [];

  for (const nicho of readdirSync(PASTA_MODELOS)) {
    const caminhoNicho = join(PASTA_MODELOS, nicho);
    if (!statSync(caminhoNicho).isDirectory()) continue;

    for (const pasta of readdirSync(caminhoNicho)) {
      const raiz = join(caminhoNicho, pasta);
      if (!statSync(raiz).isDirectory()) continue;

      const dist = join(raiz, "dist");
      if (!existsSync(join(dist, "index.html"))) continue;

      let descricao = null;
      try {
        const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
        descricao = pkg.description || null;
      } catch { /* modelo sem package.json ainda é modelo */ }

      modelos.push({
        id: nicho + "/" + pasta,
        nicho,
        pasta,
        rotulo: rotular(nicho, pasta),
        descricao,
        raiz,
        dist,
      });
    }
  }

  return modelos.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

export function acharModelo(id) {
  return listarModelos().find((m) => m.id === id) || null;
}

/**
 * Sugere o modelo pelo nicho da varredura. "pet shop" casa com a pasta
 * `pet shop/`. Sem casamento devolve o primeiro — a tela deixa trocar de
 * qualquer forma, e um padrão errado custa um clique, enquanto nenhum padrão
 * custa uma decisão a cada lead.
 */
export function sugerirModelo(termo) {
  const modelos = listarModelos();
  if (!modelos.length) return null;

  const t = String(termo || "").toLowerCase().trim();
  const doNicho = modelos.filter((m) => t && (t.includes(m.nicho.toLowerCase()) || m.nicho.toLowerCase().includes(t)));

  return (doNicho[0] || modelos[0]).id;
}
