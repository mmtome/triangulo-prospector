/**
 * Temperatura do lead.
 *
 * O briefing define o lead mais quente assim: alguém que *visivelmente investe
 * tempo em rede social* — posta, grava vídeo, mantém o perfil vivo — e mesmo
 * assim **não tem site**, nem GMN bem feito, nem link na bio que leve a um
 * site. Só WhatsApp.
 *
 * São duas coisas diferentes, e por isso a pontuação tem dois eixos em vez de
 * um número só:
 *
 *   ESFORÇO   — quanto o negócio já investe em presença digital.
 *   CARÊNCIA  — o quanto falta de site/GMN para esse esforço virar cliente.
 *
 * Um número único misturaria "clínica morta sem site" (carência alta, esforço
 * zero — não compra) com "clínica que posta todo dia sem site" (as duas altas —
 * compra). Elas pontuariam igual, e são leads opostos.
 *
 * A regra que amarra os eixos: **temperatura é limitada pelo menor dos dois**.
 * Sem esforço não há quem valorize o site; sem carência não há o que vender.
 * Por isso `QUENTE` exige os dois altos, e não a soma alta.
 *
 * Todo ponto atribuído vira uma linha em `sinais`, porque na hora da abordagem
 * o vendedor precisa saber *por que* o lead está quente, não só que está.
 */

export const FAIXAS = [
  { chave: "quente", rotulo: "Quente", emoji: "🔥", min: 70 },
  { chave: "morno", rotulo: "Morno", emoji: "🟠", min: 50 },
  { chave: "frio", rotulo: "Frio", emoji: "🔵", min: 30 },
  { chave: "gelado", rotulo: "Gelado", emoji: "⚪", min: 0 },
];

const limitar = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * ESFORÇO — o negócio se mexe?
 *
 * Volume de posts pesa mais que seguidores: seguidor se compra, post é hora
 * gasta. É a leitura mais próxima de "investe tempo" que dá para fazer sem a
 * data do último post, que fica atrás do login do Instagram.
 */
function medirEsforco({ instagram, gmn }) {
  let pts = 0;
  const sinais = [];

  const posts = instagram?.posts ?? null;
  const seguidores = instagram?.seguidores ?? null;

  if (instagram?.existe) {
    pts += 10;
    sinais.push({ eixo: "esforco", peso: 10, texto: "Tem perfil no Instagram." });

    if (posts != null) {
      if (posts >= 300) { pts += 30; sinais.push({ eixo: "esforco", peso: 30, texto: posts + " posts — perfil muito ativo." }); }
      else if (posts >= 120) { pts += 24; sinais.push({ eixo: "esforco", peso: 24, texto: posts + " posts — posta com constância." }); }
      else if (posts >= 40) { pts += 16; sinais.push({ eixo: "esforco", peso: 16, texto: posts + " posts — presença regular." }); }
      else if (posts >= 10) { pts += 8; sinais.push({ eixo: "esforco", peso: 8, texto: posts + " posts — presença tímida." }); }
      else { sinais.push({ eixo: "esforco", peso: 0, texto: posts + " posts — perfil praticamente parado." }); }
    }

    if (seguidores != null) {
      if (seguidores >= 5000) { pts += 18; sinais.push({ eixo: "esforco", peso: 18, texto: seguidores.toLocaleString("pt-BR") + " seguidores — audiência construída." }); }
      else if (seguidores >= 1500) { pts += 13; sinais.push({ eixo: "esforco", peso: 13, texto: seguidores.toLocaleString("pt-BR") + " seguidores." }); }
      else if (seguidores >= 400) { pts += 8; sinais.push({ eixo: "esforco", peso: 8, texto: seguidores.toLocaleString("pt-BR") + " seguidores." }); }
      else { pts += 3; sinais.push({ eixo: "esforco", peso: 3, texto: (seguidores?.toLocaleString("pt-BR") ?? "Poucos") + " seguidores — audiência pequena." }); }
    }

    if (instagram.contaProfissional) {
      pts += 6;
      sinais.push({ eixo: "esforco", peso: 6, texto: "Conta comercial configurada (botões de contato)." });
    }
    if (instagram.bio && instagram.bio.length > 60) {
      pts += 4;
      sinais.push({ eixo: "esforco", peso: 4, texto: "Bio preenchida com cuidado." });
    }
  } else {
    sinais.push({ eixo: "esforco", peso: 0, texto: "Nenhum Instagram encontrado." });
  }

  // O GMN também é esforço: quem responde e coleta avaliação está cuidando da
  // presença. Vale menos que o Instagram porque avaliação chega sozinha.
  const av = gmn?.avaliacoes ?? null;
  if (av != null) {
    if (av >= 200) { pts += 14; sinais.push({ eixo: "esforco", peso: 14, texto: av + " avaliações no Google — muito movimento." }); }
    else if (av >= 50) { pts += 10; sinais.push({ eixo: "esforco", peso: 10, texto: av + " avaliações no Google." }); }
    else if (av >= 10) { pts += 5; sinais.push({ eixo: "esforco", peso: 5, texto: av + " avaliações no Google." }); }
  }
  if (gmn?.nota != null && gmn.nota >= 4.5 && (av ?? 0) >= 10) {
    pts += 5;
    sinais.push({ eixo: "esforco", peso: 5, texto: "Nota " + String(gmn.nota).replace(".", ",") + " — reputação boa para sustentar um site." });
  }

  return { pontos: limitar(pts), sinais };
}

/**
 * CARÊNCIA — o que falta para a agência vender.
 *
 * O peso máximo está em não ter site nenhum, seguido do link da bio que morre
 * no WhatsApp. É literalmente o produto da Triângulo.
 */
function medirCarencia({ site, instagram, gmn }) {
  let pts = 0;
  const sinais = [];

  const nivel = site?.nivel ?? "inexistente";

  switch (nivel) {
    case "inexistente":
      pts += 45;
      sinais.push({ eixo: "carencia", peso: 45, texto: "Não tem site nenhum." });
      break;
    case "rede":
    case "agregador":
      pts += 38;
      sinais.push({ eixo: "carencia", peso: 38, texto: site.motivo });
      break;
    case "quebrado":
      pts += 40;
      sinais.push({ eixo: "carencia", peso: 40, texto: site.motivo + " Pior que não ter: o cliente clica e não acha ninguém." });
      break;
    case "construtor":
      pts += 30;
      sinais.push({ eixo: "carencia", peso: 30, texto: site.motivo });
      break;
    case "fraco":
      pts += 18;
      sinais.push({ eixo: "carencia", peso: 18, texto: site.motivo });
      break;
    case "ok":
      sinais.push({ eixo: "carencia", peso: 0, texto: "Já tem site próprio funcionando — a venda aqui é outra." });
      break;
  }

  // Link da bio. Só conta quando existe Instagram, senão viraria ponto de graça
  // para quem nem perfil tem.
  if (instagram?.existe) {
    const tipo = instagram.link?.tipo ?? "nenhum";
    if (tipo === "nenhum") {
      pts += 20;
      sinais.push({ eixo: "carencia", peso: 20, texto: "Sem link na bio — a audiência não tem para onde ir." });
    } else if (tipo === "whatsapp") {
      pts += 18;
      sinais.push({ eixo: "carencia", peso: 18, texto: "Link da bio vai direto para o WhatsApp, sem site no meio." });
    } else if (tipo === "agregador") {
      pts += 12;
      sinais.push({ eixo: "carencia", peso: 12, texto: "Link da bio é " + instagram.link.host + " — página de links, não site." });
    } else if (tipo === "rede") {
      pts += 8;
      sinais.push({ eixo: "carencia", peso: 8, texto: "Link da bio aponta para outra rede social." });
    } else if (tipo === "site") {
      sinais.push({ eixo: "carencia", peso: 0, texto: "Link da bio leva a um site (" + instagram.link.host + ")." });
    }
  }

  // GMN incompleto: cada campo vazio é uma objeção a menos na conversa.
  const faltas = [];
  if (!gmn?.telefone) faltas.push("telefone");
  if (!gmn?.enderecoCompleto && !gmn?.endereco) faltas.push("endereço");
  if (gmn?.temHorario === false) faltas.push("horário");
  if ((gmn?.fotos ?? 0) <= 2) faltas.push("fotos");
  if ((gmn?.avaliacoes ?? 0) < 10) faltas.push("avaliações");

  if (faltas.length >= 3) {
    pts += 15;
    sinais.push({ eixo: "carencia", peso: 15, texto: "GMN mal cuidado — falta " + faltas.join(", ") + "." });
  } else if (faltas.length >= 1) {
    pts += 7;
    sinais.push({ eixo: "carencia", peso: 7, texto: "GMN incompleto — falta " + faltas.join(", ") + "." });
  } else {
    sinais.push({ eixo: "carencia", peso: 0, texto: "GMN bem preenchido." });
  }

  return { pontos: limitar(pts), sinais };
}

/**
 * Junta os eixos pela **média geométrica**.
 *
 * É a forma matemática exata da regra do briefing: `√(esforço × carência)` só
 * fica alta quando as duas ficam, e vai a zero se qualquer uma zerar. A média
 * aritmética não serve — daria 50 para quem tem esforço 100 e carência 0, ou
 * seja, colocaria a clínica com site impecável no mesmo patamar do lead ideal.
 *
 * A primeira versão usava `min` com um empurrão da média, e punia demais o meio
 * da tabela: uma clínica com 314 posts e site de Canva (esforço 72, carência
 * 38) saía como "frio", quando ela é exatamente o lead que se quer abordar na
 * segunda leva. Pela geométrica dá 52 — morno, que é o lugar certo dela.
 */
export function pontuar(lead) {
  const esforco = medirEsforco(lead);
  const carencia = medirCarencia(lead);

  const total = limitar(Math.sqrt(esforco.pontos * carencia.pontos));

  const faixa = FAIXAS.find((f) => total >= f.min) || FAIXAS[FAIXAS.length - 1];

  const sinais = [...esforco.sinais, ...carencia.sinais].sort((a, b) => b.peso - a.peso);

  return {
    esforco: esforco.pontos,
    carencia: carencia.pontos,
    total,
    temperatura: faixa.chave,
    rotulo: faixa.rotulo,
    emoji: faixa.emoji,
    sinais,
    confianca: medirConfianca(lead),
    resumo: resumir(lead, faixa.chave, esforco.pontos, carencia.pontos),
  };
}

/**
 * O quanto dá para confiar nesta nota.
 *
 * Existe uma ambiguidade que a pontuação sozinha esconde: um lead sem
 * Instagram encontrado pontua igual a um lead que comprovadamente não tem
 * Instagram — e são coisas opostas. O primeiro pode ser o lead mais quente da
 * lista com o @ que a busca não achou; o segundo é um negócio offline.
 *
 * Em vez de chutar, a nota sai marcada como parcial e o card avisa. Quem
 * prospecta decide se vale procurar o @ na mão.
 */
function medirConfianca(lead) {
  const faltas = [];

  if (lead.instagram?.bloqueado) {
    faltas.push("o Instagram exigiu login e o perfil não pôde ser lido");
  } else if (lead.buscaBloqueada) {
    faltas.push("o buscador pediu verificação e o @ não pôde ser procurado");
  } else if (!lead.instagram) {
    faltas.push("nenhum Instagram encontrado — pode existir com um @ que a busca não achou");
  } else if (lead.instagram.existe && lead.instagram.posts == null) {
    faltas.push("o perfil carregou sem o número de posts");
  }

  if (lead.site?.nivel === "quebrado" && /não respondeu/.test(lead.site.motivo || "")) {
    faltas.push("o site não respondeu a tempo — pode estar no ar e lento");
  }

  return { nivel: faltas.length ? "parcial" : "alta", faltas };
}

/** Uma frase de abordagem — é o que vai no card e na anotação do gestor. */
function resumir(lead, temperatura, esforco, carencia) {
  const ig = lead.instagram;
  const nivel = lead.site?.nivel ?? "inexistente";

  if (temperatura === "quente") {
    const quanto = ig?.posts ? ig.posts + " posts" : "perfil ativo";
    const semSite =
      nivel === "inexistente" ? "não tem site" :
      nivel === "quebrado" ? "tem site fora do ar" :
      nivel === "agregador" ? "só tem link na bio" :
      nivel === "rede" ? "só tem rede social" : "tem só uma página de construtor";
    return "Investe em conteúdo (" + quanto + ") e " + semSite + ". É a conversa mais fácil da lista.";
  }
  if (temperatura === "morno") {
    if (carencia >= 60 && esforco < 50) return "Falta site, mas o perfil é fraco — vai precisar vender o conteúdo junto.";
    return "Tem presença e alguma lacuna. Vale abordar depois dos quentes.";
  }
  if (temperatura === "frio") {
    if (nivel === "ok") return "Já tem site próprio. Só entra numa oferta de reforma ou de tráfego.";
    return "Pouco sinal de investimento digital. Prospecção longa.";
  }
  return nivel === "ok"
    ? "Estrutura digital resolvida — não é lead de site."
    : "Sem presença digital detectável. Provavelmente não compra site agora.";
}
