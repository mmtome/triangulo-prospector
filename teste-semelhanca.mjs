/**
 * Roda a regra de semelhança contra varreduras salvas em `data/`.
 *
 * Existe por causa de um bug real: na varredura de pet shop em Uberaba, onze
 * negócios diferentes receberam o mesmo `@rwpetshop` — "pet" e "shop" casavam
 * 50% com ele, que era exatamente o corte. Cada um herdou os seguidores, os
 * posts e a nota de outro.
 *
 * Testar contra o JSON salvo é o que torna a correção verificável sem gastar
 * uma varredura de oito minutos e sem arriscar bloqueio. E ele importa
 * `genericasDaBusca` do módulo em vez de reimplementar a regra: uma cópia da
 * regra no teste foi o que escondeu o bug na primeira tentativa de conserto.
 *
 * Uso:  node teste-semelhanca.mjs [arquivo.json]
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { semelhanca, genericasDaBusca } from "./src/sources/busca.mjs";

const CORTE = 0.5;

const alvo =
  process.argv[2] ||
  readdirSync("data")
    .filter((f) => f.endsWith(".json") && f !== "indice.json")
    .sort()
    .pop();

if (!alvo) {
  console.error("Nenhuma varredura em data/. Rode uma antes.");
  process.exit(1);
}

const caminho = alvo.includes("/") || alvo.includes("\\") ? alvo : join("data", alvo);
const r = JSON.parse(readFileSync(caminho, "utf8"));
const { termo, cidade } = r.parametros;
const genericas = genericasDaBusca(termo, cidade);

console.log("varredura:", caminho);
console.log("termo:", termo, "· cidade:", cidade);
console.log("regex do nicho:", genericas);
console.log();

const comHandle = r.leads.filter((l) => l.instagram?.handle);
const antes = [];
const depois = [];

for (const l of comHandle) {
  const nomePerfil = l.instagram.nomePerfil || "";
  const a = semelhanca(l.nome, l.instagram.handle, nomePerfil, null);
  const d = semelhanca(l.nome, l.instagram.handle, nomePerfil, genericas);
  if (a >= CORTE) antes.push({ l, s: a });
  if (d >= CORTE) depois.push({ l, s: d });
}

/** Quantos negócios distintos ficaram com o mesmo @ — o defeito em si. */
function colisoes(lista) {
  const por = {};
  for (const { l } of lista) {
    const h = l.instagram.handle;
    (por[h] ||= []).push(l.nome);
  }
  return Object.entries(por).filter(([, nomes]) => nomes.length > 1);
}

console.log("aceitos ANTES: ", antes.length, "· colisões:", colisoes(antes).length);
for (const [h, nomes] of colisoes(antes)) {
  console.log("   @" + h + " → " + nomes.length + " negócios: " + nomes.slice(0, 3).join(", ") + "…");
}

console.log("aceitos DEPOIS:", depois.length, "· colisões:", colisoes(depois).length);
for (const [h, nomes] of colisoes(depois)) {
  console.log("   @" + h + " → " + nomes.length + " negócios: " + nomes.join(", "));
}

console.log();
console.log("--- continuam casando ---");
for (const { l, s } of depois) {
  console.log("  " + Math.round(s * 100) + "%\t" + l.nome + "  →  @" + l.instagram.handle);
}

console.log();
console.log("--- deixaram de casar (viram lead sem @, com nota parcial) ---");
const passouDepois = new Set(depois.map(({ l }) => l.nome));
for (const { l, s } of antes) {
  if (!passouDepois.has(l.nome)) {
    console.log("  " + Math.round(s * 100) + "%\t" + l.nome + "  ✗  @" + l.instagram.handle);
  }
}

const falhou = colisoes(depois).length > 0;
console.log();
console.log(falhou ? "FALHOU: ainda há @ repetido." : "OK: nenhum @ em dois negócios.");
process.exit(falhou ? 1 : 0);
