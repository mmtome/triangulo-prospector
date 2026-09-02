/**
 * Instagram — perfil público.
 *
 * O `fetch` direto não serve: o Instagram devolve a casca sem `og:description`
 * para quem não é navegador. Num Chrome de verdade o cabeçalho do perfil
 * renderiza antes do muro de login, e é dele que sai tudo o que interessa:
 * seguidores, seguindo, nº de posts, bio e — o campo decisivo — o link da bio.
 *
 * O link da bio é o que separa o lead quente do morno. Ele sai do DOM já
 * embrulhado no redirecionador (`l.instagram.com/?u=<destino>`), então é
 * preciso desembrulhar para saber se aponta para um site de verdade, para um
 * agregador (Linktree e parentes) ou só para o WhatsApp.
 *
 * O que NÃO dá para ler: a data do último post. A grade de posts fica atrás do
 * login. A frequência é estimada pelo volume de posts, e a UI deixa isso
 * explícito em vez de fingir que sabe.
 */

import { sleep } from "../cdp.mjs";

/** Domínios que são página de links, não site. É exatamente o "link na bio". */
const AGREGADORES = [
  "linktr.ee", "linktree.com", "beacons.ai", "bio.link", "linkme.bio",
  "campsite.bio", "solo.to", "lnk.bio", "many.link", "znap.link",
  "linkbio.co", "linklist.bio", "koji.to", "flowcode.com", "linkbio.com.br",
];

/** Construtores de site grátis: existe página, mas em domínio de terceiro. */
const CONSTRUTORES = [
  "canva.site", "wixsite.com", "webnode.page", "webnode.com.br",
  "milanote.com", "notion.site", "carrd.co", "sites.google.com",
  "blogspot.com", "wordpress.com", "weebly.com", "jimdosite.com",
  "negocio.site", "business.site", "godaddysites.com", "myportfolio.com",
];

const REDES = ["instagram.com", "facebook.com", "fb.me", "youtube.com", "tiktok.com", "linkedin.com"];
const ZAP = ["wa.me", "whatsapp.com", "api.whatsapp.com", "chat.whatsapp.com"];

/**
 * Encurtadores. Precisam de uma volta na rede para revelar o destino: metade
 * das bios de clínica usa um `bit.ly` que termina no WhatsApp, e classificar
 * pelo domínio do encurtador marcaria isso como "tem site".
 */
const ENCURTADORES = [
  "bit.ly", "tinyurl.com", "cutt.ly", "encurtador.com.br", "l.ead.me",
  "rebrand.ly", "shorturl.at", "t.co", "goo.gl", "abrir.link", "url.gratis",
  "linkr.bio", "pxl.to", "shre.ink", "encr.pw",
];

const ehDe = (host, lista) => lista.some((d) => host === d || host.endsWith("." + d));

/** Segue o encurtador e devolve a URL final. Devolve a original se falhar. */
export async function resolverEncurtador(url, { timeoutMs = 8000 } = {}) {
  if (!url) return url;
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
  if (!ehDe(host, ENCURTADORES)) return url;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36" },
    });
    return r.url || url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classifica um destino de link. É a peça que a pontuação consome.
 * `nenhum` (sem link) e `whatsapp` são os dois estados mais quentes.
 */
export function classificarLink(url) {
  if (!url) return { tipo: "nenhum", url: null, host: null };
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return { tipo: "invalido", url, host: null };
  }
  if (ehDe(host, ZAP)) return { tipo: "whatsapp", url, host };
  if (ehDe(host, AGREGADORES)) return { tipo: "agregador", url, host };
  if (ehDe(host, CONSTRUTORES)) return { tipo: "construtor", url, host };
  if (ehDe(host, REDES)) return { tipo: "rede", url, host };
  if (ehDe(host, ENCURTADORES)) return { tipo: "encurtador", url, host };
  return { tipo: "site", url, host };
}

/** Desembrulha `l.instagram.com/?u=<destino>&e=…`. */
function desembrulhar(href) {
  if (!href) return null;
  try {
    const u = new URL(href, "https://www.instagram.com");
    if (u.hostname.endsWith("l.instagram.com") || u.hostname.endsWith("l.facebook.com")) {
      const alvo = u.searchParams.get("u");
      return alvo ? decodeURIComponent(alvo) : null;
    }
    return u.href;
  } catch {
    return null;
  }
}

/**
 * "8.199" e "1,043" viram 8199 e 1043 · "213 mil" vira 213000 · "1,2 mi" vira
 * 1200000.
 *
 * A pegadinha: o `og:description` do Instagram usa **vírgula** como separador
 * de milhar mesmo em pt-BR ("1,043 seguidores"), enquanto o corpo da página usa
 * ponto ("1.042 seguidores"). Tratar a vírgula como decimal transformava 1.043
 * seguidores em 1 — foi o que apareceu no primeiro teste.
 *
 * A regra que desfaz a ambiguidade: separador decimal só existe quando há
 * sufixo de escala ("1,2 mi"). Sem sufixo, ponto e vírgula são milhar.
 */
function contagem(txt) {
  if (!txt) return null;
  const m = String(txt).trim().match(/^([\d.,]+)\s*(mil|mi|k|m)?/i);
  if (!m) return null;

  const escala = (m[2] || "").toLowerCase();
  const cru = m[1];

  let n;
  if (escala) {
    n = Number(cru.replace(/\./g, "").replace(",", "."));
  } else {
    n = Number(cru.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(n)) return null;

  if (escala === "mil" || escala === "k") n *= 1000;
  if (escala === "mi" || escala === "m") n *= 1_000_000;
  return Math.round(n);
}

/**
 * Lê um perfil público. Devolve `{ existe: false }` quando o @ não existe —
 * caso comum, porque o handle às vezes vem de um palpite da busca.
 */
export async function lerPerfil(aba, handle) {
  if (!handle) return null;
  const arroba = String(handle).replace(/^@/, "").trim().toLowerCase();
  if (!arroba) return null;

  const ok = await aba.irPara("https://www.instagram.com/" + encodeURIComponent(arroba) + "/", {
    espera: 3000,
    ate: () => !!document.querySelector('meta[property="og:description"]') ||
                /não disponível|isn't available|Página não encontrada/i.test(document.body.innerText) ||
                location.pathname.startsWith("/accounts/login"),
    limite: 18000,
  });

  /**
   * O muro de login é o limite de taxa, não perfil inexistente.
   *
   * Quando o Instagram decide que já foi visita demais deste IP, ele redireciona
   * **todo** perfil para `/accounts/login/?next=…&is_from_rle` — "rle" de *rate
   * limit exceeded*. Existente ou não, a resposta é a mesma.
   *
   * Confundir os dois é o pior erro possível aqui: a varredura inteira sairia
   * com "sem Instagram" em todo mundo, o eixo de esforço zeraria e todos os
   * leads virariam gelados. Uma cidade cheia de clínicas ativas seria entregue
   * como um deserto digital.
   */
  const bloqueado = await aba.avaliar(() => location.pathname.startsWith("/accounts/login"));
  if (bloqueado) {
    return {
      handle: arroba,
      existe: false,
      bloqueado: true,
      motivo: "O Instagram exigiu login (limite de acessos deste IP) — não dá para saber se o perfil existe.",
    };
  }

  if (!ok) return { handle: arroba, existe: false, motivo: "O perfil não carregou a tempo." };

  await sleep(1200);

  const bruto = await aba.avaliar(() => {
    const meta = (n) => document.querySelector('meta[property="' + n + '"]')?.content || null;
    const texto = document.body.innerText;

    if (/não disponível|isn't available|Página não encontrada|Sorry, this page/i.test(texto.slice(0, 400))) {
      return { sumiu: true };
    }

    // O link da bio é sempre embrulhado pelo redirecionador da Meta
    // (`l.instagram.com/?u=…`) — é ele que conta, e só ele. Aceitar qualquer
    // <a> externo da página traz o rodapé institucional junto: num teste, o
    // "link da bio" de uma clínica saiu como developers.facebook.com/docs.
    const envelopados = [...document.querySelectorAll('a[href*="l.instagram.com"], a[href*="l.facebook.com"]')]
      .map((a) => a.getAttribute("href"))
      .filter(Boolean);

    // Perfis raros mostram o link sem embrulho. Aí vale o <a> absoluto que não
    // seja de nenhum domínio da Meta.
    const META = /(^|\.)(instagram\.com|facebook\.com|fb\.com|meta\.com|meta\.ai|threads\.(com|net))$/i;
    const soltos = envelopados.length ? [] : [...document.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => {
        if (!h || !/^https?:\/\//.test(h)) return false;
        try { return !META.test(new URL(h).hostname.replace(/^www\./, "")); }
        catch { return false; }
      });

    const externos = [...envelopados, ...soltos];

    return {
      sumiu: false,
      titulo: document.title,
      ogDesc: meta("og:description"),
      ogTitle: meta("og:title"),
      ogImage: meta("og:image"),

      /* A grade de posts. Só existe para sessão logada — anônimo recebe o muro
         de login no lugar dela, e a lista sai vazia. É a melhor fonte de foto
         que a proposta pode ter: são as imagens que o próprio dono escolheu
         publicar, muito acima da fachada fotografada por um cliente no Google.

         O filtro por 150px descarta avatar de comentário e ícone de interface,
         que aparecem no mesmo <img> e entrariam como se fossem post. */
      posts: [
        ...new Set(
          [...document.querySelectorAll("main img, article img")]
            .filter((i) => (i.naturalWidth || i.width || 0) >= 150)
            .map((i) => i.src)
            .filter((s) => s && /cdninstagram|fbcdn/.test(s)),
        ),
      ].slice(0, 12),

      corpo: texto.slice(0, 1400),
      externos: externos.slice(0, 5),
      verificado: /Verificado\b/.test(texto.slice(0, 600)),
      profissional: /Enviar e-mail|Ligar|Como chegar|Reservar/.test(texto.slice(0, 800)),
    };
  });

  if (!bruto || bruto.sumiu) {
    return { handle: arroba, existe: false, motivo: "Perfil inexistente ou removido." };
  }

  // og:description vem em pt-BR como:
  //   "8.199 seguidores, seguindo 5.123, 373 posts — Veja as fotos …"
  // e em inglês como:
  //   "8,199 Followers, 5,123 Following, 373 Posts - …"
  const d = bruto.ogDesc || "";
  const c = bruto.corpo || "";

  // O corpo é a segunda fonte: o cabeçalho renderizado mostra "8.199
  // seguidores" mesmo quando a og:description vem incompleta — o que acontece
  // em parte dos perfis, e deixava o lead sem a métrica que mais pontua.
  const seguidores =
    contagem((d.match(/([\d.,]+\s*(?:mil|mi)?)\s*(?:seguidores|followers)/i) || [])[1]) ??
    contagem((c.match(/([\d.,]+\s*(?:mil|mi)?)\s*(?:seguidores|followers)/i) || [])[1]);

  const seguindo =
    contagem((d.match(/seguindo\s*([\d.,]+\s*(?:mil|mi)?)/i) || [])[1]) ??
    contagem((d.match(/([\d.,]+\s*(?:mil|mi)?)\s*following/i) || [])[1]) ??
    contagem((c.match(/([\d.,]+\s*(?:mil|mi)?)\s*seguindo/i) || [])[1]);

  const posts =
    contagem((d.match(/([\d.,]+\s*(?:mil|mi)?)\s*(?:posts|publicações)/i) || [])[1]) ??
    contagem((c.match(/([\d.,]+\s*(?:mil|mi)?)\s*(?:posts|publicações)/i) || [])[1]);

  // A bio fica no corpo, entre a linha de "seguindo" e o rodapé. Cortar por
  // marcadores conhecidos é mais estável do que depender de classe do Instagram.
  const linhas = bruto.corpo.split("\n").map((s) => s.trim()).filter(Boolean);
  const iSeguindo = linhas.findIndex((l) => /seguindo|following/i.test(l));
  const iFim = linhas.findIndex((l) => /^(Mostrar mais posts|Meta|Destaques|Publicações)/i.test(l));
  const bio = linhas
    .slice(iSeguindo >= 0 ? iSeguindo + 1 : 0, iFim > 0 ? iFim : undefined)
    .filter((l) => !/^(Entrar|Cadastre-se|mais)$/i.test(l))
    .join(" · ")
    .slice(0, 600);

  const destino = bruto.externos.map(desembrulhar).find(Boolean) || null;
  const link = classificarLink(destino);

  // A bio de clínica quase sempre traz telefone e e-mail — é contato de graça.
  // O corte da bio ("…mais") cola reticências no fim do e-mail, e `[\w.]+`
  // engolia os pontos: saía "clinica@gmail.com...". O TLD é fechado em letras
  // e o que sobrar de pontuação é aparado.
  const telBio = (bio.match(/\(?\d{2}\)?\s*9?\s*\d{4}[-\s]?\d{4}/) || [])[0] || null;
  const emailBio = ((bio.match(/[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+/i) || [])[0] || "")
    .replace(/[.\-_]+$/, "") || null;

  return {
    handle: arroba,
    existe: true,
    url: "https://www.instagram.com/" + arroba,
    nomeExibido: (bruto.ogTitle || "").split("(")[0].trim() || null,
    seguidores,
    seguindo,
    posts,
    bio,
    telefoneBio: telBio,
    emailBio,
    link,
    verificado: !!bruto.verificado,
    contaProfissional: !!bruto.profissional,
    /* A foto do perfil. Já era lida e descartada — e é a única imagem da marca
       que o Instagram entrega sem login: em pet shop, clínica e salão ela é o
       logo em nove de cada dez perfis. Dela saem o logo da proposta e a paleta.
       A URL do CDN da Meta expira em horas, então quem usar precisa baixar o
       arquivo na hora da clonagem, nunca guardar o link e voltar depois. */
    avatar: bruto.ogImage || null,

    /* Fotos dos posts. Lista vazia é o normal sem sessão logada — a grade fica
       atrás do muro. Quando vem preenchida, é a melhor imagem disponível do
       negócio, e a clonagem prefere estas às do Google. */
    posts: bruto.posts || [],
  };
}
