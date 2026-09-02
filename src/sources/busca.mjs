/**
 * Descoberta do @ do Instagram quando o GMN não entrega.
 *
 * A ordem importa e é do mais confiável para o mais chutado:
 *
 *  1. O próprio campo "site" do GMN, quando o dono cadastrou o Instagram ali.
 *     Zero ambiguidade — foi o dono que apontou.
 *  2. O site do negócio: o link do Instagram no cabeçalho ou rodapé.
 *  3. Busca na web. É palpite, e por isso passa por um filtro de semelhança
 *     antes de virar lead: buscar por nome de clínica traz o Instagram do
 *     shopping vizinho com a mesma facilidade que o da clínica.
 *
 * Por que Bing: o Google devolve captcha para navegador automatizado já na
 * primeira consulta; o DuckDuckGo bloqueia na segunda; Ecosia e Mojeek
 * respondem 403. O Bing é o único que sustenta uma varredura — e mesmo ele
 * desafia quem insiste, o que é o assunto de `criarBuscador`.
 *
 * O snippet do Bing costuma trazer a própria og:description do Instagram, com
 * seguidores e posts — quando vem, o perfil já entra pontuado sem precisar
 * abrir o Instagram.
 */

import { sleep } from "../cdp.mjs";

const IGNORAR = new Set([
  "p", "reel", "reels", "explore", "accounts", "about", "legal", "developer",
  "directory", "stories", "tv", "help", "privacy", "terms", "web",
]);

/**
 * Palavras que não identificam ninguém: estão no nome de metade das clínicas
 * da cidade. `clinic` está aqui por um falso positivo real — "Be Clinic
 * Odontologia" casou 100% com `@_rclinic`, porque depois da limpeza sobrava só
 * "clinic", que casa com qualquer coisa.
 */
const GENERICAS =
  /\b(clinica|clinic|consultorio|odontologia|odontologica|odontologico|odonto|dental|dentista|dentistas|medica|medico|saude|estetica|centro|instituto|dr|dra|doutor|doutora|espaco|de|da|do|e|em|the|ltda|me|eireli)\b/g;

/** Só normaliza: caixa baixa, sem acento e sem pontuação. */
function normalizar(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * As palavras genéricas DESTA varredura: as do termo buscado e as da cidade.
 *
 * A lista fixa acima nasceu no nicho de odontologia e não tem como cobrir os
 * outros. Rodando "pet shop" em Uberaba ela deixava "pet" e "shop" passarem
 * como prova de identidade, e "Pet Shop Casa do Bicho" casou 50% com
 * `@rwpetshop` só por elas — junto com mais dez negócios diferentes. Onze leads
 * com o mesmo perfil, os mesmos seguidores e a mesma nota.
 *
 * A regra que sai daí é geral: a palavra que está no termo buscado identifica o
 * NICHO, nunca o negócio. O mesmo vale para a cidade — "Uberaba" está no nome
 * de metade deles. Quem identifica é o que sobra depois de tirar as duas.
 */
export function genericasDaBusca(termo, cidade) {
  const doTermo = normalizar(termo).split(" ").filter(Boolean);
  const daCidade = normalizar(cidade).split(" ").filter(Boolean);

  /* A forma grudada entra junto porque metade dos donos escreve "petshop" numa
     palavra só. Sem ela, `\bpet\b` não recorta nada dentro de "petshop" e
     "Lá lunna petshop" continuava casando com `@rwpetshop` pelo pedaço genérico
     — o mesmo bug, escrito sem espaço. */
  const grudado = doTermo.length > 1 ? [doTermo.join("")] : [];

  const palavras = [...new Set([...doTermo, ...grudado, ...daCidade])];
  if (!palavras.length) return null;

  // Mais longas primeiro: "petshop" precisa ser consumido antes de "pet".
  palavras.sort((a, b) => b.length - a.length);
  return new RegExp("\\b(" + palavras.join("|") + ")\\b", "g");
}

/** Tira acento, pontuação e as palavras que não identificam ninguém. */
function chave(txt, genericasDoNicho = null) {
  let s = normalizar(txt).replace(GENERICAS, " ");
  if (genericasDoNicho) s = s.replace(genericasDoNicho, " ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Quanto do nome do negócio aparece no @ ou no nome de exibição do perfil.
 * Devolve 0..1. O corte de aceite fica em `criarBuscador`.
 *
 * Além da proporção de palavras, exige **massa de evidência**: os pedaços que
 * casaram precisam somar pelo menos 4 caracteres, para um resto de duas ou três
 * letras não casar com meio Instagram. O piso é 4 e não 5 porque nomes legítimos
 * se reduzem a uma palavra curta — "Clínica Dentista do Povo" vira "povo", e com
 * piso 5 ele perdia o `@dentistadopovo_`, que é o perfil certo.
 *
 * Nome sem nada distintivo devolve 0, e 0 aqui significa "não sei" — que é a
 * resposta certa, não uma falha.
 */
export function semelhanca(nomeNegocio, handle, nomePerfil = "", genericasDoNicho = null) {
  /* O lado do perfil nunca perde as palavras do nicho: o handle vem
     concatenado ("petshopfabricio"), sem fronteira de palavra por onde
     recortar, e é nele que o pedaço distintivo do nome precisa ser achado. */
  const compacto = (chave(handle) + " " + chave(nomePerfil)).replace(/\s/g, "");

  /* Nome inteiro dentro do @ é prova quase certa, e vem antes de qualquer
     limpeza: "Meu Pet Shop" é genérico de ponta a ponta, mas "meupetshop"
     dentro de `@meupetshop.ura` não é coincidência. Sem esta regra a limpeza do
     nicho reduzia o nome a "meu" e perdia o perfil certo — errar para o lado de
     descartar um casamento bom também é errar.

     O piso de 6 caracteres é o que impede o inverso: "meu" ou "casa" soltos
     casariam com meio Instagram. E o nome completo é sempre mais longo que o
     pedaço genérico, então nenhum dos falsos positivos de "pet shop" volta —
     "porteirapetshop" não cabe em "rwpetshop". */
  const nomeInteiro = normalizar(nomeNegocio).replace(/\s/g, "");
  if (nomeInteiro.length >= 6 && compacto.includes(nomeInteiro)) return 1;

  // Daqui para baixo, só o que distingue ESTE negócio conta.
  const alvo = chave(nomeNegocio, genericasDoNicho);
  if (!alvo) return 0;

  const palavras = alvo.split(" ").filter((p) => p.length >= 3);
  if (!palavras.length) return 0;

  const casadas = palavras.filter((p) => compacto.includes(p));
  const massa = casadas.reduce((n, p) => n + p.length, 0);
  if (massa < 4) return 0;

  return casadas.length / palavras.length;
}

/** Extrai `{handle, seguidores, posts, nome}` dos snippets da página de busca. */
function lerSnippets(texto) {
  const achados = [];

  // "8,199 Followers, 5,123 Following, 373 Posts - FG Espaço (@fg…) on Instagram"
  const comNumeros =
    /([\d.,]+\s*(?:mil|mi|K|M)?)\s*(?:Followers|seguidores)[,\s]+([\d.,]+\s*(?:mil|mi|K|M)?)\s*(?:Following|seguindo)[,\s]+([\d.,]+\s*(?:mil|mi|K|M)?)\s*(?:Posts|publicações)([\s\S]{0,160}?)\(@([A-Za-z0-9._]+)\)/gi;
  for (const m of texto.matchAll(comNumeros)) {
    achados.push({
      handle: m[5].toLowerCase(),
      seguidoresTxt: m[1].trim(),
      postsTxt: m[3].trim(),
      nome: m[4].replace(/[-–—\s]+$/, "").trim(),
    });
  }

  // Fallback: só o "(@handle)" solto, sem números.
  if (!achados.length) {
    for (const m of texto.matchAll(/\(@([A-Za-z0-9._]{3,40})\)/g)) {
      achados.push({ handle: m[1].toLowerCase(), seguidoresTxt: null, postsTxt: null, nome: "" });
    }
  }

  return achados.filter((a) => !IGNORAR.has(a.handle));
}

/**
 * Buscador com estado, criado uma vez por varredura.
 *
 * O estado existe por um motivo medido: o Bing **lança um desafio no meio de
 * uma varredura longa** — a página volta com 122 caracteres dizendo "Resolva o
 * desafio abaixo para continuar". Sem reconhecer isso, cada lead seguinte
 * gastava dois timeouts e saía "sem @" como se o negócio não tivesse
 * Instagram. Na varredura de 25 leads, 11 caíram assim — e eram justamente os
 * de maior carência, ou seja, os candidatos a lead quente.
 *
 * Três defesas, nesta ordem:
 *
 *  1. **Pool coletivo.** Três consultas por varredura (não por lead) colhem
 *     dezenas de perfis locais de uma vez. Quem casa com o pool não gasta
 *     consulta nenhuma, e todo perfil visto em qualquer consulta entra nele.
 *  2. **Reconhecer o desafio** pelo texto e pelo tamanho da página, e recuar
 *     de verdade — 45 s na primeira vez, 90 s na segunda. O bloqueio é
 *     temporário: no teste, o mesmo Bing que desafiou voltou minutos depois e
 *     achou o perfil que a varredura anterior tinha dado como inexistente.
 *  3. **Desligar o buscador** só depois do terceiro desafio seguido, e zerar a
 *     contagem a cada consulta bem-sucedida — o que importa é desistir quando
 *     o bloqueio persiste, não somar tropeços isolados. Desligado, os leads
 *     restantes saem com nota parcial e o card diz o porquê.
 */
export function criarBuscador(aba, { corte = 0.5, termo = "", cidade = "" } = {}) {
  const estado = {
    pool: [],
    desafios: 0,
    desligado: false,
    consultas: 0,
    /* Um perfil do Instagram pertence a um negócio só. Se o mesmo @ ganha em
       dois leads, um dos dois está errado por definição — e o custo do erro é
       alto: o perfil traz seguidores, posts e bio, então o lead errado herda a
       nota inteira de outro. A trava é rede de segurança independente do ajuste
       da semelhança, que já falhou uma vez com "pet shop". */
    usados: new Map(),
  };

  const genericas = genericasDaBusca(termo, cidade);

  return {
    estado,

    /**
     * Monta o pool. Roda uma vez, antes da fila de leads.
     *
     * Sem o operador `site:`: ele é sinal de robô e foi com ele que o Bing
     * desafiou logo na primeira consulta do teste. Três frases naturais rendem
     * mais perfis e passam despercebidas.
     */
    async montarPool(termo, cidade) {
      const consultas = [
        "instagram " + termo + " " + cidade,
        termo + " " + cidade + " instagram perfil",
        termo + " " + cidade + " redes sociais",
      ];

      for (const q of consultas) {
        if (estado.desligado) break;
        const r = await consultar(aba, estado, q);
        if (r?.candidatos?.length) {
          for (const c of r.candidatos) {
            if (!estado.pool.some((p) => p.handle === c.handle)) estado.pool.push(c);
          }
        }
        await sleep(2500);
      }

      return estado.pool.length;
    },

    /**
     * Acha o @ de um negócio. `{ handle: null }` é resposta legítima — melhor
     * lead sem @ do que lead com o @ do vizinho.
     */
    async descobrir({ nome, cidade }) {
      // 1. O pool primeiro: é de graça.
      const doPool = escolher(estado.pool, nome, corte, estado, genericas);
      if (doPool) return marcar(estado, doPool, "pool da busca");

      if (estado.desligado) return { bloqueado: true };

      // 2. Consulta dedicada. O GMN costuma cadastrar o nome já com a praça
      //    dentro ("Pró-Sorriso Clínica Odontológica em Uberlândia") e a frase
      //    exata não existe em lugar nenhum — daí a segunda variante enxuta.
      const enxuto = String(nome)
        .replace(/\s+(em|de|no|na)\s+[^,]+$/i, "")
        .replace(/\s*[-–|]\s*.*$/, "")
        .trim();

      const tentativas = ['"' + nome + '" ' + (cidade || "") + " instagram"];
      if (enxuto && enxuto.toLowerCase() !== nome.toLowerCase()) {
        tentativas.push('"' + enxuto + '" ' + (cidade || "") + " instagram");
      } else {
        tentativas.push(enxuto + " " + (cidade || "") + " instagram");
      }

      let melhor = null;
      let descartados = [];

      for (const q of tentativas) {
        const r = await consultar(aba, estado, q);
        if (r?.bloqueado) return { bloqueado: true };
        if (!r) continue;

        // Todo candidato visto entra no pool: o perfil que apareceu buscando a
        // clínica A pode ser o da clínica B, dez leads adiante.
        for (const c of r.candidatos) {
          if (!estado.pool.some((p) => p.handle === c.handle)) estado.pool.push(c);
        }

        const pontuados = pontuarCandidatos(r.candidatos, nome, genericas);
        if (pontuados.length) descartados = pontuados.slice(0, 3);

        const livres = pontuados.filter((c) => !estado.usados.has(c.handle));
        if (livres[0] && (!melhor || livres[0].score > melhor.score)) melhor = livres[0];

        if (melhor && melhor.score >= corte) break;
        await sleep(2500);
      }

      if (!melhor || melhor.score < corte) return { handle: null, descartados };
      return marcar(estado, melhor, "busca na web");
    },
  };
}

/**
 * Registra o dono do @ e devolve o achado. Sai por aqui todo handle aceito,
 * para a trava valer nos dois caminhos — pool e consulta dedicada.
 */
function marcar(estado, achado, origem) {
  estado.usados.set(achado.handle, true);
  return { ...achado, origem };
}

/** Pontua e ordena candidatos contra o nome do negócio. */
function pontuarCandidatos(candidatos, nome, genericas = null) {
  return candidatos
    .map((c) => ({ ...c, score: semelhanca(nome, c.handle, c.nome, genericas) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Melhor candidato ainda **livre**, se passar do corte. Um @ já entregue a
 * outro negócio sai da disputa em vez de derrubar o lead: o segundo colocado
 * pode ser o perfil certo, e devolver null aqui perderia o lead por causa do
 * vizinho.
 */
function escolher(candidatos, nome, corte, estado, genericas = null) {
  const melhor = pontuarCandidatos(candidatos, nome, genericas).find(
    (c) => !estado.usados.has(c.handle),
  );
  return melhor && melhor.score >= corte ? melhor : null;
}

/**
 * Uma consulta ao Bing, com detecção de desafio e recuo.
 *
 * O desafio se anuncia de duas formas, e as duas contam: pelo texto ("Resolva
 * o desafio", "Uma última etapa") e pelo tamanho — uma página de resultados do
 * Bing nunca tem menos de mil caracteres, então uma resposta curta é bloqueio
 * disfarçado, não busca sem resultado.
 */
async function consultar(aba, estado, consulta, tentativa = 1) {
  if (estado.desligado) return { bloqueado: true };

  estado.consultas++;
  const url = "https://www.bing.com/search?setlang=pt-BR&cc=BR&q=" + encodeURIComponent(consulta);

  await aba.irPara(url, {
    espera: 2200,
    ate: () => document.body.innerText.length > 1200,
    limite: 6000,
  });

  const pagina = await aba.avaliar(() => {
    // O Bing embrulha todo resultado em /ck/a?…&u=a1<base64url>. Sem desfazer
    // isso perde-se metade dos perfis: eles aparecem como link do resultado,
    // não no texto do snippet.
    const decodificar = (href) => {
      const m = href.match(/[?&]u=a1([A-Za-z0-9_\-]+)/);
      if (!m) return href;
      try {
        const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
        return atob(b64 + "===".slice(0, (4 - (b64.length % 4)) % 4));
      } catch {
        return null;
      }
    };

    const alvos = [...document.querySelectorAll("#b_results a[href]")]
      .map((a) => (a.href.includes("/ck/a") ? decodificar(a.href) : a.href))
      .filter(Boolean);

    return {
      texto: document.body.innerText,
      perfis: [...new Set(alvos.filter((u) => u.includes("instagram.com")))].slice(0, 30),
    };
  });

  const texto = pagina.texto || "";
  const desafiado =
    texto.length < 900 ||
    /Resolva o desafio|Uma última etapa|verificar se você|Verifique se você|captcha|unusual traffic|are you a human/i.test(texto.slice(0, 400));

  if (desafiado) {
    estado.desafios++;

    // O bloqueio é temporário, não definitivo: no teste, o mesmo Bing que
    // desafiou voltou a responder alguns minutos depois — e achou o perfil que
    // a varredura anterior tinha dado como inexistente. Então vale esperar
    // antes de desistir, e a pausa cresce a cada desafio.
    if (estado.desafios >= 3) {
      estado.desligado = true;
      return { bloqueado: true };
    }

    if (tentativa >= 2) return { bloqueado: true };

    await sleep(estado.desafios === 1 ? 45000 : 90000);
    return consultar(aba, estado, consulta, tentativa + 1);
  }

  // Consulta bem-sucedida limpa o histórico de desafios: o que interessa é
  // desligar quando o bloqueio persiste, não somar tropeços isolados de uma
  // varredura longa.
  estado.desafios = 0;

  // Duas origens de candidato: o texto do snippet (traz seguidores e posts de
  // brinde) e a URL do resultado (aparece mesmo quando o snippet não cita @).
  const porSnippet = lerSnippets(texto);
  const porLink = pagina.perfis
    .map((u) => (decodeURIComponent(u).match(/instagram\.com\/([A-Za-z0-9._]{2,40})/) || [])[1])
    .filter((h) => h && !IGNORAR.has(h.toLowerCase()))
    .map((h) => ({ handle: h.toLowerCase(), seguidoresTxt: null, postsTxt: null, nome: "" }));

  const porHandle = new Map();
  for (const c of [...porSnippet, ...porLink]) {
    const anterior = porHandle.get(c.handle);
    // O do snippet ganha, porque vem com os números.
    if (!anterior || (!anterior.seguidoresTxt && c.seguidoresTxt)) porHandle.set(c.handle, c);
  }

  return { candidatos: [...porHandle.values()] };
}

/**
 * Lê o site do negócio atrás do @ e do WhatsApp. Roda dentro da própria página,
 * então não gasta consulta de buscador e não erra de negócio.
 */
export async function lerRedesDoSite(aba, site) {
  if (!site) return null;

  const ok = await aba.irPara(site, {
    espera: 2500,
    ate: () => document.readyState !== "loading",
    limite: 15000,
  });
  if (!ok) return null;

  return aba.avaliar(() => {
    const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.href);
    const pegar = (re) => hrefs.map((h) => (h.match(re) || [])[1]).find(Boolean) || null;

    return {
      instagram: pegar(/instagram\.com\/([A-Za-z0-9._]{3,40})/),
      whatsapp: pegar(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d{10,15})/),
      email: (document.body.innerText.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/) || [])[0] || null,
    };
  });
}
