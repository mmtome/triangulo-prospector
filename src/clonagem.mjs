/**
 * Clonagem: um lead vira uma proposta com a marca dele.
 *
 * O que sai daqui é uma pasta em `clones/<slug>/`:
 *
 *   marca.json    identidade e dados do negócio (ver src/identidade.mjs)
 *   logo.png      foto de perfil do Instagram
 *   foto-1.jpg…   fotos do Google Meu Negócio
 *
 * O site NÃO é copiado para dentro dela. O modelo é servido do `dist/` dele
 * mesmo e busca o `marca.json` em tempo de execução — então a pasta do clone
 * pesa uns poucos KB, e corrigir o modelo conserta todas as propostas de uma
 * vez em vez de exigir regerar cada uma.
 *
 * Nada aqui pode derrubar a clonagem: logo que não baixou, paleta que não saiu,
 * foto fora do ar — cada um vira um campo nulo e uma ressalva na tela. Uma
 * proposta com a paleta padrão do modelo ainda é uma proposta; um erro 500 no
 * meio da prospecção não é nada.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { baixarComoDataUrl, paletaDaImagem, derivarPaleta, montarMarca } from "./identidade.mjs";
import { acharModelo } from "./modelos.mjs";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const PASTA_CLONES = join(RAIZ, "clones");

/** Quantas fotos do GMN entram. O modelo-1 usa 8; acima disso vira peso morto. */
const MAX_FOTOS = 8;

const EXTENSAO = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** `Porteira Pet Shop` → `porteira-pet-shop`. É o endereço da proposta. */
export function slugificar(nome) {
  return String(nome || "proposta")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "proposta";
}

/** Separa `data:image/png;base64,…` em bytes e extensão. */
function decodificar(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  return { bytes: Buffer.from(m[2], "base64"), extensao: EXTENSAO[m[1]] || ".jpg" };
}

/**
 * Clona um lead. `aba` é a aba do Chrome já aberta — a paleta precisa de canvas.
 */
export async function clonar(lead, { modelo, aba, varredura = null }) {
  const alvo = acharModelo(modelo);
  if (!alvo) throw new Error("Modelo desconhecido: " + modelo);

  const slug = slugificar(lead.nome);
  const pasta = join(PASTA_CLONES, slug);

  // Reclonar substitui: o lead pode ter sido recoletado com dados melhores, e
  // acumular versões numeradas encheria o disco de proposta que ninguém abriu.
  if (existsSync(pasta)) rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });

  const ressalvas = [];

  /* ── logo e paleta ─────────────────────────────────────────────────────── */

  let logo = null;
  let paleta = null;

  const urlAvatar = lead.instagram?.avatar || null;
  if (!urlAvatar) {
    ressalvas.push(
      lead.instagram?.existe
        ? "O perfil não expôs foto de perfil — logo e paleta ficaram com o padrão do modelo."
        : "Sem Instagram encontrado: sem logo e sem paleta da marca.",
    );
  } else {
    const dataUrl = await baixarComoDataUrl(urlAvatar);
    if (!dataUrl) {
      ressalvas.push("A foto de perfil não baixou (o link do CDN da Meta expira em horas).");
    } else {
      const bin = decodificar(dataUrl);
      writeFileSync(join(pasta, "logo" + bin.extensao), bin.bytes);
      logo = { extensao: bin.extensao };

      const cores = await paletaDaImagem(aba, dataUrl);
      paleta = derivarPaleta(cores);
      if (!paleta) {
        ressalvas.push(
          "A foto de perfil não tem cor de marca legível (logo preto e branco, provavelmente) — paleta do modelo mantida.",
        );
      }
    }
  }

  /* ── fotos do GMN ──────────────────────────────────────────────────────── */

  const fotos = [];
  const urls = (lead.gmn?.fotosUrls || []).slice(0, MAX_FOTOS);

  for (const url of urls) {
    const dataUrl = await baixarComoDataUrl(url);
    if (!dataUrl) continue;
    const bin = decodificar(dataUrl);
    if (!bin) continue;
    writeFileSync(join(pasta, "foto-" + (fotos.length + 1) + bin.extensao), bin.bytes);
    fotos.push({ extensao: bin.extensao });
  }

  if (!fotos.length) {
    ressalvas.push(
      urls.length
        ? "As fotos do Google não baixaram — a galeria ficou com as do modelo."
        : "O Google Meu Negócio deste lead não tem foto pública — a galeria ficou com as do modelo.",
    );
  }

  /* ── marca.json ────────────────────────────────────────────────────────── */

  const marca = montarMarca({ ...lead, _varredura: varredura }, { modelo, paleta, logo, fotos });
  writeFileSync(join(pasta, "marca.json"), JSON.stringify(marca, null, 2), "utf8");

  return {
    slug,
    modelo,
    rotuloModelo: alvo.rotulo,
    url: "/proposta/" + slug + "/",
    fotos: fotos.length,
    temLogo: !!logo,
    paleta,
    ressalvas,
  };
}

/** As propostas já geradas, mais recentes primeiro. */
export function listarClones() {
  if (!existsSync(PASTA_CLONES)) return [];

  return readdirSync(PASTA_CLONES)
    .map((slug) => {
      try {
        const marca = JSON.parse(readFileSync(join(PASTA_CLONES, slug, "marca.json"), "utf8"));
        return {
          slug,
          nome: marca.negocio?.nome || slug,
          modelo: marca.modelo,
          geradoEm: marca.geradoEm,
          url: "/proposta/" + slug + "/",
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.geradoEm).localeCompare(String(a.geradoEm)));
}
