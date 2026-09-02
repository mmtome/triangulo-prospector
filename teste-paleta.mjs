/**
 * Testa a extração de paleta contra imagens locais.
 *
 * A quantização roda dentro do Chrome (é lá que existe canvas), então não dá
 * para testá-la com um `node -e`. E testar durante uma varredura custaria oito
 * minutos e um risco de bloqueio por rodada — inviável para ajustar um
 * algoritmo de cor.
 *
 * Uso:  node teste-paleta.mjs <imagem> [imagem…]
 * Ex.:  node teste-paleta.mjs "../modelos site/pet shop/modelo-1/public/logo-cabana.png"
 */

import { readFileSync, existsSync } from "node:fs";
import { extname, basename } from "node:path";
import { abrirNavegador, novaAba } from "./src/cdp.mjs";
import { paletaDaImagem, derivarPaleta } from "./src/identidade.mjs";

const TIPOS = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error("Uso: node teste-paleta.mjs <imagem> [imagem…]");
  process.exit(1);
}

/** Quadradinho de cor no terminal, via fundo ANSI de 24 bits. */
function amostra(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return "      ";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `\x1b[48;2;${r};${g};${b}m      \x1b[0m`;
}

const navegador = await abrirNavegador({ headless: true });
const aba = await novaAba(navegador.porta);

try {
  for (const arquivo of arquivos) {
    if (!existsSync(arquivo)) {
      console.log("não existe:", arquivo);
      continue;
    }

    const bytes = readFileSync(arquivo);
    const tipo = TIPOS[extname(arquivo).toLowerCase()] || "image/jpeg";
    const dataUrl = "data:" + tipo + ";base64," + bytes.toString("base64");

    const cores = await paletaDaImagem(aba, dataUrl);
    const paleta = derivarPaleta(cores);

    console.log("");
    console.log("── " + basename(arquivo) + " ─".repeat(20).slice(0, 40));

    if (!paleta) {
      console.log("  nenhuma cor de marca legível (logo sem croma, provavelmente)");
      continue;
    }

    console.log("  dominantes:", paleta.amostra.map((c) => amostra(c) + " " + c).join("  "));
    console.log("");
    for (const [nome, valor] of Object.entries(paleta)) {
      if (nome === "amostra" || !valor) continue;
      console.log("  " + amostra(valor) + "  --" + nome.padEnd(14) + valor);
    }
  }
} finally {
  await aba.fechar().catch(() => {});
  navegador.fechar();
}
