/**
 * Google Maps / Google Meu Negócio — a fonte primária.
 *
 * Duas etapas, porque as duas páginas do Maps carregam coisas diferentes:
 *
 *  1. `buscarNoMapa` varre o feed de resultados. O card já traz nome, nota,
 *     categoria, endereço, horário, telefone e — o que mais importa aqui — se
 *     existe o botão "Website". Card sem esse botão é negócio sem site
 *     declarado no GMN, que é o sinal de venda da agência.
 *
 *  2. `detalharLugar` abre a ficha para pegar o que o card não mostra: nº de
 *     avaliações, endereço completo com bairro e CEP, e a URL crua do site.
 *     Custa uma navegação por lead, então só roda na profundidade "completa".
 *
 * O feed é virtualizado: só existe no DOM o que já foi rolado. Por isso o laço
 * de rolagem — sem ele o retorno para em 10 resultados, não importa a cidade.
 */

import { sleep } from "../cdp.mjs";

const MAPS = "https://www.google.com/maps/search/";

/** "3,9" vira 3.9 e "1.234" vira 1234 — o Maps em pt-BR usa vírgula decimal. */
function numeroBR(txt) {
  if (!txt) return null;
  const limpo = String(txt).replace(/[^\d.,]/g, "");
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca no mapa e devolve os cards do feed.
 *
 * `aoAndar` recebe o progresso para a UI mostrar a rolagem acontecendo — sem
 * isso a tela fica parada meio minuto e parece travada.
 */
export async function buscarNoMapa(aba, { termo, cidade, uf, alvo = 30, aoAndar = () => {} }) {
  const consulta = [termo, "em", cidade, uf].filter(Boolean).join(" ");
  const url = MAPS + encodeURIComponent(consulta) + "?hl=pt-BR&gl=BR";

  const carregou = await aba.irPara(url, {
    espera: 3000,
    ate: () => !!document.querySelector('div[role="feed"] a[href*="/maps/place/"]'),
    limite: 25000,
  });
  if (!carregou) {
    return { consulta, lugares: [], erro: "O Maps não devolveu resultados para essa busca." };
  }

  await sleep(1200);

  // Rola até chegar no alvo ou até o feed parar de crescer. Duas paradas
  // seguidas sem crescer significam fim de lista — o Maps corta perto de 120.
  let anterior = 0;
  let parado = 0;
  for (let volta = 0; volta < 25; volta++) {
    const total = await aba.avaliar(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return 0;
      feed.scrollTop = feed.scrollHeight;
      return feed.querySelectorAll('a[href*="/maps/place/"]').length;
    });
    aoAndar({ encontrados: total, alvo });
    if (total >= alvo) break;
    if (total <= anterior) {
      if (++parado >= 2) break;
    } else {
      parado = 0;
    }
    anterior = total;
    await sleep(1800);
  }

  const lugares = await aba.avaliar(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];

    return [...feed.children]
      .filter((c) => c.querySelector('a[href*="/maps/place/"]'))
      .map((el) => {
        const a = el.querySelector('a[href*="/maps/place/"]');
        const href = a.href;

        // O href carrega o place_id (depois de "19s") e as coordenadas
        // (depois de "3d" e "4d"), separados por "!" no formato interno do Maps.
        const placeId = (href.match(/!19s([\w-]+)/) || [])[1] || null;
        const lat = Number((href.match(/!3d(-?[\d.]+)/) || [])[1]) || null;
        const lng = Number((href.match(/!4d(-?[\d.]+)/) || [])[1]) || null;

        const notaEl = el.querySelector('span[role="img"][aria-label*="estrela"]');
        const nota = (notaEl?.getAttribute("aria-label") || "").replace(/\s*estrelas?/i, "").trim() || null;

        // O botão de site é o único link externo do card; "Rotas" aponta para
        // /maps/dir, então basta descartar o que é do próprio Google.
        const site = [...el.querySelectorAll("a[href]")]
          .map((x) => x.href)
          .find((u) => !/google\.[a-z.]+\/(maps|url)/.test(u)) || null;

        const linhas = el.innerText.split("\n").map((s) => s.trim()).filter(Boolean);

        // "Clínica odontológica · · Av. João Naves, 707" — a categoria é o
        // primeiro pedaço da linha que carrega o separador de metadados.
        const linhaMeta = linhas.find((l) => l.includes("·")) || "";
        const partes = linhaMeta.split("·").map((s) => s.trim()).filter(Boolean);

        const tel = (el.innerText.match(/\(\d{2}\)\s*\d{4,5}-?\d{4}/) || [])[0] || null;
        const linhaHora = linhas.find((l) => /Aberto|Fechado|24 horas|Abre |Fecha /i.test(l)) || null;

        return {
          nome: a.getAttribute("aria-label") || linhas[0] || null,
          placeId,
          mapsUrl: placeId
            ? "https://www.google.com/maps/place/?q=place_id:" + placeId
            : href,
          lat,
          lng,
          notaTxt: nota,
          categoria: partes[0] || null,
          endereco: partes.length > 1 ? partes[partes.length - 1] : null,
          telefone: tel,
          horarioTxt: linhaHora,
          site,
        };
      })
      .filter((p) => p.nome);
  });

  // O feed repete o mesmo lugar quando a rolagem recarrega uma faixa.
  const vistos = new Set();
  const unicos = [];
  for (const l of lugares) {
    const chave = l.placeId || l.nome + "|" + l.endereco;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push({ ...l, nota: numeroBR(l.notaTxt) });
  }

  return { consulta, lugares: unicos.slice(0, alvo) };
}

/**
 * Abre a ficha do lugar. Devolve `null` quando a página não carrega — o lead
 * continua válido com o que veio do card, só perde os campos extras.
 */
export async function detalharLugar(aba, lugar) {
  if (!lugar.mapsUrl) return null;

  const ok = await aba.irPara(lugar.mapsUrl + "&hl=pt-BR", {
    espera: 2500,
    ate: () => !!document.querySelector("h1"),
    limite: 18000,
  });
  if (!ok) return null;

  await sleep(1400);

  const d = await aba.avaliar(() => {
    const porItem = (id) => {
      const el = document.querySelector('[data-item-id="' + id + '"], [data-item-id^="' + id + '"]');
      return el ? (el.getAttribute("aria-label") || el.innerText || "").trim() : null;
    };
    const semRotulo = (v) => (v ? v.replace(/^[^:]+:\s*/, "").trim() : null);

    const texto = document.body.innerText;

    // O contador de avaliações aparece ora como "(139)" ao lado da nota, ora
    // como "139 avaliações" no botão de resenhas. Tentamos as duas formas.
    const avaliacoes =
      (texto.match(/([\d.]+)\s*(?:avaliaç\w+|coment[áa]rios?)/i) || [])[1] ||
      (texto.match(/\n\(([\d.]+)\)\n/) || [])[1] ||
      null;

    const notaEl = document.querySelector('[role="img"][aria-label*="estrela"]');
    const fotos = document.querySelectorAll(
      'button img[src*="googleusercontent"], img[src*="streetviewpixels"]',
    ).length;
    const horarios = document.querySelectorAll('[aria-label*="Copiar horário"]').length;
    const authority = document.querySelector('[data-item-id="authority"]');

    return {
      nome: document.querySelector("h1")?.innerText?.trim() || null,
      notaTxt: (notaEl?.getAttribute("aria-label") || "").replace(/\s*estrelas?/i, "").trim() || null,
      avaliacoesTxt: avaliacoes,
      enderecoCompleto: semRotulo(porItem("address")),
      telefone: semRotulo(porItem("phone")),
      site: authority ? authority.href : null,
      siteRotulo: semRotulo(porItem("authority")),
      fotos,
      temHorario: horarios > 0,
      permanentementeFechado: /Permanentemente fechado|Fechado definitivamente/i.test(texto),
    };
  });

  return {
    ...d,
    nota: numeroBR(d.notaTxt),
    avaliacoes: d.avaliacoesTxt ? Number(String(d.avaliacoesTxt).replace(/\./g, "")) : null,
  };
}
