/**
 * Persistência das varreduras.
 *
 * Um JSON por execução em `data/`, mais um índice enxuto para a lista da tela.
 * Sem banco de propósito: cada execução é um documento fechado que se lê
 * inteiro ou não se lê, ninguém consulta por campo, e o volume é de dezenas de
 * arquivos por mês. Um Postgres aqui seria infraestrutura para nada.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PASTA_DADOS = join(RAIZ, "data");
const INDICE = join(PASTA_DADOS, "indice.json");

mkdirSync(PASTA_DADOS, { recursive: true });

/** `2026-08-30-1423-clinica-odontologica-uberlandia` — legível na pasta. */
export function novoId(params) {
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const fatia = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 28);
  return [carimbo, fatia(params.termo), fatia(params.cidade)].filter(Boolean).join("-");
}

export function salvar(id, resultado) {
  writeFileSync(join(PASTA_DADOS, id + ".json"), JSON.stringify(resultado, null, 2), "utf8");

  const indice = lerIndice().filter((e) => e.id !== id);
  indice.unshift({
    id,
    executadoEm: resultado.executadoEm,
    termo: resultado.parametros.termo,
    cidade: resultado.parametros.cidade,
    uf: resultado.parametros.uf,
    total: resultado.total,
    avaliados: resultado.avaliados ?? resultado.total,
    porTemperatura: resultado.porTemperatura,
    porDescarte: resultado.porDescarte ?? {},
    enviadosAoGestor: resultado.enviadosAoGestor ?? 0,
  });
  writeFileSync(INDICE, JSON.stringify(indice.slice(0, 200), null, 2), "utf8");
  return id;
}

export function lerIndice() {
  if (!existsSync(INDICE)) return [];
  try {
    return JSON.parse(readFileSync(INDICE, "utf8"));
  } catch {
    return [];
  }
}

export function carregar(id) {
  const arq = join(PASTA_DADOS, id + ".json");
  if (!existsSync(arq)) return null;
  try {
    return JSON.parse(readFileSync(arq, "utf8"));
  } catch {
    return null;
  }
}

export function apagar(id) {
  const arq = join(PASTA_DADOS, id + ".json");
  if (existsSync(arq)) unlinkSync(arq);
  writeFileSync(INDICE, JSON.stringify(lerIndice().filter((e) => e.id !== id), null, 2), "utf8");
}

/**
 * Deduplicação entre execuções.
 *
 * Prospectar "clínica odontológica" e depois "dentista" na mesma cidade traz
 * muita gente repetida. A chave é o place_id do Google quando existe — é o
 * identificador estável do negócio; nome e telefone mudam, ele não.
 */
export function jaVistos() {
  const vistos = new Map();
  for (const arq of readdirSync(PASTA_DADOS)) {
    if (!arq.endsWith(".json") || arq === "indice.json") continue;
    try {
      const r = JSON.parse(readFileSync(join(PASTA_DADOS, arq), "utf8"));
      // Descartado também conta como visto: ele já foi avaliado e cortado, e
      // reaparecer numa varredura vizinha só gastaria tempo de novo.
      for (const l of [...(r.leads || []), ...(r.descartados || [])]) {
        const chave = l.gmn?.placeId || l.telefone || l.nome;
        if (chave && !vistos.has(chave)) {
          vistos.set(chave, { execucao: arq.replace(/\.json$/, ""), nome: l.nome });
        }
      }
    } catch { /* arquivo corrompido não derruba a lista */ }
  }
  return vistos;
}

/** CSV para quem quiser abrir no Excel em vez de mandar ao gestor. */
export function paraCSV(resultado) {
  const cabecalho = [
    "temperatura", "pontos", "esforco", "carencia", "nome", "categoria", "cidade",
    "telefone", "whatsapp", "email", "instagram", "seguidores", "posts",
    "link_da_bio", "tipo_do_link", "situacao_do_site", "site", "nota_google",
    "avaliacoes", "endereco", "maps", "resumo",
  ];

  const escapar = (v) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? '"' + s + '"' : s;
  };

  const linhas = resultado.leads.map((l) =>
    [
      l.score.rotulo, l.score.total, l.score.esforco, l.score.carencia,
      l.nome, l.categoria, l.cidade,
      l.telefone ? "+" + l.telefone : "",
      l.temWhatsapp ? "sim" : "não",
      l.email,
      l.instagram?.handle ? "@" + l.instagram.handle : "",
      l.instagram?.seguidores, l.instagram?.posts,
      l.instagram?.link?.url, l.instagram?.link?.tipo,
      l.site?.nivel, l.site?.url,
      l.gmn?.nota, l.gmn?.avaliacoes, l.endereco, l.gmn?.url,
      l.score.resumo,
    ].map(escapar).join(";"),
  );

  // Ponto e vírgula e BOM: é o que o Excel em pt-BR abre sem pedir importação.
  return "﻿" + cabecalho.join(";") + "\n" + linhas.join("\n");
}
