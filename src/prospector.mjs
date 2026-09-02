/**
 * A varredura: junta as fontes num lead pontuado.
 *
 * Uma aba só, reaproveitada, e as etapas em série. Paralelizar aqui seria
 * tentador — e é o caminho mais curto para tomar bloqueio: o Maps e o Bing
 * toleram um navegador que se comporta como gente, não seis abas disparando ao
 * mesmo tempo. O gargalo real é a rede, não a CPU.
 *
 * `aoEvento` recebe cada passo para a UI acompanhar por SSE. Um erro em um lead
 * nunca derruba a varredura: ele vira `erro` naquele lead e a fila continua.
 */

import { abrirNavegador, novaAba, sleep } from "./cdp.mjs";
import { buscarNoMapa, detalharLugar } from "./sources/gmn.mjs";
import { lerPerfil, classificarLink, resolverEncurtador } from "./sources/instagram.mjs";
import { criarBuscador, lerRedesDoSite, semelhanca } from "./sources/busca.mjs";
import { auditarSite } from "./sources/site.mjs";
import { pontuar } from "./score.mjs";
import { descartePrecoce, descarteFinal, contarDescartes } from "./qualificacao.mjs";
import { jaVistos } from "./store.mjs";

/** Só dígitos com DDI — mesmo formato que o gestor guarda. */
function normalizarTelefone(v) {
  if (!v) return null;
  const d = String(v).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return "55" + d;
  if (d.length === 12 || d.length === 13) return d;
  return d;
}

/** Celular brasileiro: 11 dígitos com 9 depois do DDD. Só esses têm WhatsApp. */
function ehCelular(tel) {
  if (!tel) return false;
  const br = tel.startsWith("55") ? tel.slice(2) : tel;
  return br.length === 11 && br[2] === "9";
}

export async function prospectar(opcoes, aoEvento = () => {}) {
  const {
    termo,
    cidade,
    uf = "",
    quantidade = 20,
    profundidade = "completa",
    corteSemelhanca = 0.5,
  } = opcoes;

  const inicio = Date.now();
  const completa = profundidade === "completa";

  /* "quantidade" é o alvo de leads ENTREGUES, não de negócios avaliados.
     Cerca de metade da fila cai no descarte — "já tem site" é o maior corte —
     então avaliar exatamente 20 devolvia 10, e o campo prometia uma coisa e
     entregava outra. Agora o laço continua puxando do mapa até juntar o alvo.

     O teto existe porque a promessa não pode ser infinita: num nicho saturado
     de sites não há 20 leads para achar, e sem limite a varredura desceria o
     mapa inteiro tomando bloqueio. 3x é o que a taxa observada de descarte
     (~50%) justifica, com folga para um nicho pior que a média. */
  const alvoLeads = quantidade;
  const tetoAvaliados = Math.min(120, quantidade * 3);

  // Carregado ANTES da varredura, para o histórico não conter esta execução.
  // Prospectar "clínica odontológica" e depois "dentista" na mesma cidade traz
  // muita gente repetida, e mandar de novo ao gestor só engorda a anotação.
  const historico = jaVistos();

  aoEvento({ tipo: "status", texto: "Abrindo o navegador…" });
  const navegador = await abrirNavegador({ headless: opcoes.mostrarNavegador !== true });
  const aba = await novaAba(navegador.porta);

  // Um buscador por varredura: ele acumula o pool de perfis e conta os
  // desafios do Bing para saber quando parar de insistir.
  // O termo e a cidade entram aqui porque as palavras deles não identificam
  // negócio nenhum nesta varredura — ver genericasDaBusca em sources/busca.mjs.
  const buscador = criarBuscador(aba, { corte: corteSemelhanca, termo, cidade });

  // Contagem de muros de login do Instagram. Vive fora do laço porque o limite
  // é do IP, não do perfil: uma vez atingido, todo lead seguinte cai igual.
  const estadoInstagram = { bloqueios: 0, lidos: 0 };

  const leads = [];
  const descartados = [];
  let avaliados = 0;

  try {
    aoEvento({ tipo: "status", texto: "Buscando " + termo + " em " + cidade + " no Google Maps…" });

    const { lugares, erro, consulta } = await buscarNoMapa(aba, {
      termo,
      cidade,
      uf,
      alvo: tetoAvaliados,
      aoAndar: ({ encontrados, alvo }) =>
        aoEvento({ tipo: "status", texto: "Rolando o mapa — " + encontrados + " de " + alvo + " encontrados…" }),
    });

    if (erro) throw new Error(erro);

    aoEvento({
      tipo: "encontrados",
      total: lugares.length,
      consulta,
      alvoLeads,
      teto: tetoAvaliados,
    });

    // Uma consulta coletiva antes da fila. Colhe dezenas de perfis locais de
    // uma vez, e cada lead que casa com o pool deixa de gastar uma consulta —
    // que é o recurso escasso aqui, porque o Bing desafia quem insiste.
    if (completa) {
      aoEvento({ tipo: "status", texto: "Levantando os perfis de Instagram do nicho na cidade…" });
      const n = await buscador.montarPool(termo, [cidade, uf].filter(Boolean).join(" "));
      aoEvento({ tipo: "status", texto: n + " perfis no pool inicial." });
    }

    for (let i = 0; i < lugares.length; i++) {
      const lugar = lugares[i];
      aoEvento({ tipo: "lead-inicio", indice: i, total: lugares.length, nome: lugar.nome });

      const lead = await montarLead(aba, lugar, { cidade, uf, completa, buscador, estadoInstagram, aoEvento });

      const anterior = historico.get(lead.gmn?.placeId) || historico.get(lead.telefone);
      lead.jaVisto = anterior ? anterior.execucao : null;

      // Descarte precoce: já saiu da montagem sem Instagram e sem busca, para
      // não gastar o orçamento de consultas com quem não é lead de site.
      if (lead.descarte) {
        descartados.push(lead);
        aoEvento({ tipo: "lead-descartado", indice: i, total: lugares.length, lead });
      } else {
        leads.push(lead);
        aoEvento({ tipo: "lead-pronto", indice: i, total: lugares.length, lead });
      }

      avaliados = i + 1;

      /* Alvo atingido? Quem decide é o descarte final, e ele depende de saber
         se o Bing caiu e se o Instagram limitou o IP — informação que só existe
         agora, com o laço andado. Por isso a conta é refeita a cada lead, e sem
         marcar nada: um lead que passaria agora pode ser descartado no fim se a
         coleta piorar daqui para frente. */
      if (leads.length >= alvoLeads) {
        const ctx = {
          buscaDesligada: buscador.estado.desligado,
          instagramBloqueado: estadoInstagram.bloqueios > 0 && estadoInstagram.lidos === 0,
        };
        if (leads.filter((l) => !descarteFinal(l, ctx)).length >= alvoLeads) {
          aoEvento({ tipo: "status", texto: "Alvo de " + alvoLeads + " leads atingido." });
          break;
        }
      }

      // Um respiro entre leads. O Maps e o Bing aceitam um humano navegando;
      // uma rajada sem pausa é o que dispara a verificação.
      if (i < lugares.length - 1) await sleep(completa ? 900 : 300);
    }
  } finally {
    await aba.fechar().catch(() => {});
    navegador.fechar();
  }

  /* Segunda passada de qualificação — só agora se sabe se o Bing caiu e se o
     Instagram limitou o IP. Julgar "sem presença digital" dentro do laço seria
     julgar sem essa informação, e numa varredura bloqueada isso apagaria
     justamente os leads mais quentes. Com a coleta comprometida, nenhum lead é
     descartado por falta de sinal. */
  const instagramBloqueadoGeral = estadoInstagram.bloqueios > 0 && estadoInstagram.lidos === 0;
  const contexto = {
    buscaDesligada: buscador.estado.desligado,
    instagramBloqueado: instagramBloqueadoGeral,
  };

  const aptos = [];
  for (const l of leads) {
    const d = descarteFinal(l, contexto);
    if (d) {
      l.descarte = d;
      descartados.push(l);
    } else {
      aptos.push(l);
    }
  }

  aptos.sort((a, b) => b.score.total - a.score.total);

  const porTemperatura = aptos.reduce((acc, l) => {
    acc[l.score.temperatura] = (acc[l.score.temperatura] || 0) + 1;
    return acc;
  }, {});

  return {
    parametros: { termo, cidade, uf, quantidade, profundidade },
    executadoEm: new Date().toISOString(),
    duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
    total: aptos.length,
    /* A tela precisa dos três números para explicar um resultado curto: pedi
       20, avaliei 47, entreguei 14 — e o teto de 60 não foi atingido, logo o
       mapa acabou. Sem isso "14 de 20" parece defeito. */
    pedidos: alvoLeads,
    tetoAvaliados,
    porTemperatura,
    /* Descartados não entram na lista, mas entram na contagem. Uma varredura
       que devolve 3 de 40 pode ser um nicho saturado de sites ou uma coleta
       quebrada — sem o motivo do descarte na tela, as duas parecem iguais. */
    descartados: descartados.map((l) => ({
      nome: l.nome,
      cidade: l.cidade,
      categoria: l.categoria ?? null,
      site: l.site?.url ?? null,
      mapsUrl: l.gmn?.url ?? null,
      descarte: l.descarte,
    })),
    porDescarte: contarDescartes(descartados),
    avaliados: Math.max(avaliados, aptos.length + descartados.length),
    // Saúde da busca. Vai para a tela porque "11 leads sem Instagram" significa
    // coisas opostas conforme o Bing tenha respondido ou bloqueado, e o usuário
    // precisa saber em qual dos dois mundos está antes de confiar nas notas.
    busca: {
      consultas: buscador.estado.consultas,
      pool: buscador.estado.pool.length,
      bloqueado: buscador.estado.desligado,
      semInstagram: aptos.filter((l) => !l.instagram?.existe).length,
      instagramLidos: estadoInstagram.lidos,
      instagramBloqueado: estadoInstagram.bloqueios > 0 && estadoInstagram.lidos === 0,
      instagramBloqueios: estadoInstagram.bloqueios,
    },
    leads: aptos,
  };
}

/** Um lugar do Maps vira um lead completo e pontuado. */
async function montarLead(aba, lugar, { cidade, uf, completa, buscador, estadoInstagram, aoEvento }) {
  const erros = [];

  // 1. Ficha do GMN.
  let gmn = { ...lugar };
  if (completa) {
    try {
      const d = await detalharLugar(aba, lugar);
      if (d) gmn = { ...gmn, ...d, nome: d.nome || lugar.nome };
    } catch (e) {
      erros.push("Ficha do GMN: " + e.message);
    }
  }

  // 2. O campo "site" do GMN às vezes já é o Instagram ou o WhatsApp — nesses
  //    casos o negócio não tem site, e o @ chega sem custo de busca.
  const classeGmn = classificarLink(gmn.site);
  let handle = null;
  let origemHandle = null;

  if (classeGmn.tipo === "rede" && /instagram\.com/.test(gmn.site || "")) {
    handle = (gmn.site.match(/instagram\.com\/([A-Za-z0-9._]{2,40})/) || [])[1] || null;
    if (handle) origemHandle = "campo de site do GMN";
  }

  // 3. Auditoria do site.
  let site = { nivel: "inexistente", url: null, motivo: "Nenhum site no GMN." };
  if (gmn.site) {
    try {
      site = await auditarSite(gmn.site);
    } catch (e) {
      erros.push("Auditoria do site: " + e.message);
      site = { nivel: "quebrado", url: gmn.site, motivo: "Não foi possível checar o site." };
    }
  }

  // 3b. Corte antes do caro.
  //
  // Se o negócio já tem site funcionando (ou está fechado), ele não é lead de
  // site — e descobrir isso aqui, e não no fim, é o que economiza a consulta ao
  // Bing e a leitura do Instagram. Numa lista de dentistas onde metade já tem
  // site, isso corta a varredura quase pela metade e devolve orçamento de
  // consultas para os leads que interessam.
  const corte = descartePrecoce({ fechado: gmn.permanentementeFechado, site });
  if (corte) {
    aoEvento({ tipo: "status", texto: gmn.nome + " — " + corte.texto + " Fora da lista." });
    return {
      nome: gmn.nome,
      categoria: gmn.categoria ?? null,
      cidade: cidade + (uf ? " - " + uf : ""),
      endereco: gmn.enderecoCompleto || gmn.endereco || null,
      telefone: normalizarTelefone(gmn.telefone),
      site,
      gmn: {
        placeId: gmn.placeId,
        url: gmn.mapsUrl,
        nota: gmn.nota ?? null,
        avaliacoes: gmn.avaliacoes ?? null,
        siteDeclarado: gmn.site || null,
        fechado: gmn.permanentementeFechado || false,
      },
      // Sem score de propósito: temperatura é para comparar candidatos, e este
      // não é candidato. Uma nota aqui só convidaria a reconsiderar o corte.
      score: null,
      instagram: null,
      erros,
      descarte: corte,
    };
  }

  // 4. O site é a fonte mais confiável do @ depois do próprio GMN — desde que
  //    o @ seja do negócio. Site feito por agência costuma trazer o Instagram
  //    da agência no rodapé, e sem esta checagem o lead sai com o perfil dela.
  let doSite = null;
  if (completa && !handle && (site.nivel === "ok" || site.nivel === "fraco" || site.nivel === "construtor")) {
    try {
      doSite = await lerRedesDoSite(aba, site.url);
      if (doSite?.instagram) {
        const parecido = semelhanca(gmn.nome, doSite.instagram);
        if (parecido >= 0.34) {
          handle = doSite.instagram;
          origemHandle = "link no próprio site";
        } else {
          erros.push("O site cita @" + doSite.instagram + ", mas não bate com o nome do negócio — ignorado.");
        }
      }
    } catch (e) {
      erros.push("Leitura do site: " + e.message);
    }
  }

  // 5. Último recurso: buscar. É palpite, e passa pelo filtro de semelhança.
  let buscaBloqueada = false;
  if (completa && !handle) {
    try {
      aoEvento({ tipo: "status", texto: "Procurando o @ de " + gmn.nome + "…" });
      const achado = await buscador.descobrir({
        nome: gmn.nome,
        cidade: [cidade, uf].filter(Boolean).join(" "),
      });
      if (achado?.bloqueado) {
        buscaBloqueada = true;
        erros.push("O Bing pediu verificação — o @ deste lead ficou sem descobrir.");
      } else if (achado?.handle) {
        handle = achado.handle;
        origemHandle = achado.origem + " (semelhança " + Math.round(achado.score * 100) + "%)";
      }
    } catch (e) {
      erros.push("Busca do @: " + e.message);
    }
  }

  // 6. Perfil do Instagram.
  let instagram = null;
  if (completa && handle) {
    try {
      aoEvento({ tipo: "status", texto: "Lendo o Instagram @" + handle + "…" });
      instagram = await lerPerfil(aba, handle);
      if (instagram) instagram.origem = origemHandle;

      // O muro de login vale para a varredura inteira, não só para este lead:
      // uma vez que o Instagram limita o IP, todo perfil seguinte cai igual.
      if (instagram?.bloqueado) {
        estadoInstagram.bloqueios++;
        erros.push(instagram.motivo);
      } else if (instagram?.existe) {
        estadoInstagram.lidos++;
      }
    } catch (e) {
      erros.push("Perfil do Instagram: " + e.message);
    }
  }

  // 7. Encurtador na bio esconde o destino. Metade das clínicas usa um bit.ly
  //    que termina no WhatsApp — sem resolver, isso passaria por "tem site".
  if (instagram?.link && (instagram.link.tipo === "encurtador" || instagram.link.tipo === "site")) {
    try {
      const final = await resolverEncurtador(instagram.link.url);
      if (final && final !== instagram.link.url) {
        instagram.link = { ...classificarLink(final), encurtadoDe: instagram.link.url };
      } else if (instagram.link.tipo === "encurtador") {
        // Não resolveu: melhor tratar como link solto do que fingir que é site.
        instagram.link = { ...instagram.link, tipo: "agregador" };
      }
    } catch { /* mantém a classificação original */ }
  }

  // 8. O link da bio pode ser o site que o GMN não declarou. Quando for, a
  //    auditoria precisa rodar em cima dele, senão o lead sai quente por engano.
  if (instagram?.link?.tipo === "site" && site.nivel === "inexistente") {
    try {
      site = await auditarSite(instagram.link.url);
      site.origem = "link da bio do Instagram";
    } catch { /* mantém inexistente */ }
  }

  // 9. Contato. A bio costuma ter o celular que o GMN não tem.
  const telGmn = normalizarTelefone(gmn.telefone);
  const telBio = normalizarTelefone(instagram?.telefoneBio);
  const telZap = instagram?.link?.tipo === "whatsapp"
    ? normalizarTelefone((instagram.link.url.match(/(\d{10,15})/) || [])[1])
    : null;

  const telefone = telZap || (ehCelular(telBio) ? telBio : null) || telGmn || telBio || null;
  const email = instagram?.emailBio || doSite?.email || null;

  const lead = {
    nome: gmn.nome,
    categoria: gmn.categoria,
    cidade: cidade + (uf ? " - " + uf : ""),
    endereco: gmn.enderecoCompleto || gmn.endereco || null,
    telefone,
    temWhatsapp: ehCelular(telefone) || !!telZap,
    email,
    gmn: {
      placeId: gmn.placeId,
      url: gmn.mapsUrl,
      nota: gmn.nota ?? null,
      avaliacoes: gmn.avaliacoes ?? null,
      telefone: telGmn,
      endereco: gmn.enderecoCompleto || gmn.endereco || null,
      temHorario: gmn.temHorario ?? (gmn.horarioTxt ? true : null),
      fotos: gmn.fotos ?? null,
      siteDeclarado: gmn.site || null,
      fechado: gmn.permanentementeFechado || false,
    },
    instagram,
    site,
    erros,
    buscaBloqueada,
  };

  lead.score = pontuar(lead);
  return lead;
}
