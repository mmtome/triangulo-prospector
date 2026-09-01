/**
 * Auditoria do site do lead.
 *
 * "Tem site" é resposta pobre para uma agência. O que decide a abordagem é
 * *que tipo* de site: um domínio próprio bem feito tira o lead da fila; uma
 * página de Canva, um perfil de Facebook ou um domínio que nem responde mais
 * são, na prática, ausência de site — e às vezes uma dor maior, porque o dono
 * acha que resolveu.
 *
 * Por isso a classificação sai em `nivel`:
 *   inexistente · agregador · construtor · rede · quebrado · fraco · ok
 *
 * A checagem roda no `fetch` do Node, não no Chrome: é uma ordem de grandeza
 * mais rápida e o que se quer aqui é o HTML cru. Só cai para o navegador
 * quando a resposta vem vazia por bloqueio de bot.
 */

import { classificarLink } from "./instagram.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Falta de viewport é o atalho mais confiável para "não é responsivo". */
const RE_VIEWPORT = /<meta[^>]+name=["']viewport["']/i;
const RE_TITULO = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i;
const RE_DESC = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i;

function comEsquema(url) {
  if (!url) return null;
  const v = String(url).trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : "https://" + v;
}

/**
 * Visita o site e devolve o diagnóstico. Nunca lança: um site fora do ar é um
 * dado sobre o lead, não um erro da varredura.
 */
export async function auditarSite(url, { timeoutMs = 12000 } = {}) {
  const alvo = comEsquema(url);
  if (!alvo) return { nivel: "inexistente", url: null, motivo: "Nenhum site informado." };

  const classe = classificarLink(alvo);

  // Agregador, rede social e construtor grátis já se resolvem pelo domínio —
  // não vale gastar uma requisição para confirmar o que a URL diz.
  if (classe.tipo === "agregador") {
    return { nivel: "agregador", url: alvo, host: classe.host, motivo: "É página de links (" + classe.host + "), não site." };
  }
  if (classe.tipo === "rede") {
    return { nivel: "rede", url: alvo, host: classe.host, motivo: "O 'site' do GMN aponta para rede social (" + classe.host + ")." };
  }
  if (classe.tipo === "whatsapp") {
    return { nivel: "inexistente", url: alvo, host: classe.host, motivo: "O 'site' do GMN é um link de WhatsApp." };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp, html = "";
  try {
    resp = await fetch(alvo, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    html = await resp.text();
  } catch (e) {
    clearTimeout(timer);
    return {
      nivel: "quebrado",
      url: alvo,
      host: classe.host,
      motivo: e.name === "AbortError" ? "O site não respondeu em 12s." : "O site não abriu (" + e.message + ").",
    };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    return {
      nivel: "quebrado",
      url: alvo,
      host: classe.host,
      status: resp.status,
      motivo: "O servidor respondeu " + resp.status + ".",
    };
  }

  const finalUrl = resp.url || alvo;
  const classeFinal = classificarLink(finalUrl);

  // Redirecionamento é comum: domínio antigo que hoje joga no Instagram.
  if (classeFinal.tipo === "rede" || classeFinal.tipo === "agregador") {
    return {
      nivel: classeFinal.tipo,
      url: finalUrl,
      host: classeFinal.host,
      motivo: "O domínio redireciona para " + classeFinal.host + ".",
    };
  }

  const titulo = (html.match(RE_TITULO) || [])[1]?.replace(/\s+/g, " ").trim() || null;
  const descricao = (html.match(RE_DESC) || [])[1]?.trim() || null;
  const responsivo = RE_VIEWPORT.test(html);
  const https = finalUrl.startsWith("https://");
  const temIG = /instagram\.com\/[A-Za-z0-9._]{3,}/.test(html);
  const temZap = /wa\.me\/|api\.whatsapp\.com/.test(html);

  // "Em construção" e domínio estacionado passam no status 200 e enganam a
  // checagem ingênua. O texto é o que denuncia.
  const emConstrucao =
    /em constru[çc][ãa]o|coming soon|under construction|site em breve|dom[íi]nio (?:est[áa] )?(?:registrado|estacionado)|parked domain|buy this domain/i
      .test(html.slice(0, 60000));

  if (emConstrucao) {
    return { nivel: "quebrado", url: finalUrl, host: classeFinal.host, titulo, motivo: "Página em construção ou domínio estacionado." };
  }

  if (classeFinal.tipo === "construtor") {
    return {
      nivel: "construtor",
      url: finalUrl,
      host: classeFinal.host,
      titulo,
      responsivo,
      https,
      motivo: "Página em construtor grátis (" + classeFinal.host + "), sem domínio próprio.",
    };
  }

  // Peso do HTML como proxy grosseiro de "tem conteúdo": abaixo de ~8 KB
  // costuma ser one-page de template ou landing solta.
  const peso = html.length;
  const fraquezas = [];
  if (!responsivo) fraquezas.push("sem viewport (não é responsivo)");
  if (!https) fraquezas.push("sem HTTPS");
  if (!titulo) fraquezas.push("sem <title>");
  if (!descricao) fraquezas.push("sem meta description");
  if (peso < 8000) fraquezas.push("página muito magra (" + Math.round(peso / 1024) + " KB)");

  const nivel = fraquezas.length >= 2 ? "fraco" : "ok";

  return {
    nivel,
    url: finalUrl,
    host: classeFinal.host,
    titulo,
    descricao,
    responsivo,
    https,
    peso,
    temIG,
    temZap,
    fraquezas,
    motivo: fraquezas.length ? "Site próprio, mas com falhas: " + fraquezas.join(", ") + "." : "Site próprio, sem falhas óbvias.",
  };
}

/** Rótulo curto para a UI e para a anotação enviada ao gestor. */
export const ROTULO_SITE = {
  inexistente: "Sem site",
  agregador: "Só link na bio",
  rede: "Só rede social",
  construtor: "Site de construtor grátis",
  quebrado: "Site fora do ar",
  fraco: "Site fraco",
  ok: "Site próprio ok",
};
