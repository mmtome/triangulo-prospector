/**
 * Quem entra na lista.
 *
 * O Prospector procura **lead de site**. Um negócio que já tem site pronto, ou
 * que não investe nada em digital, não é lead de site — e não deve nem receber
 * temperatura: nota é para comparar candidatos entre si, e ele não é candidato.
 * Classificar tudo e deixar o usuário filtrar transforma uma lista de 40 numa
 * lista de 9 boas escondidas entre 31 que nunca deveriam ter aparecido.
 *
 * ── A regra que sustenta tudo: INCERTEZA NUNCA DESCARTA ────────────────────
 *
 * Descartar por dado ausente é como este app se destrói sozinho. O README já
 * documenta o caso: numa varredura de 25, o Bing começou a desafiar no meio e
 * 11 leads saíram "sem Instagram" — e eram justamente os de maior carência,
 * ou seja, os candidatos a lead quente. Se "sem Instagram" virasse descarte,
 * esses 11 sumiriam da tela sem deixar rastro, e a varredura pareceria uma
 * cidade sem oportunidade.
 *
 * Por isso todo descarte aqui exige **prova positiva**:
 *   - "tem site" só descarta com o site auditado e respondendo;
 *   - "sem presença digital" só descarta com o perfil lido, ou com a busca
 *     comprovadamente saudável tendo procurado e não achado.
 *
 * Quando a coleta falha, o lead FICA — com nota parcial, como já era.
 *
 * ── Por que dois momentos ──────────────────────────────────────────────────
 *
 * `descartePrecoce` roda logo depois da auditoria do site, antes de gastar
 * consulta no Bing e leitura no Instagram. Quem já tem site sai da fila sem
 * consumir o recurso escasso da varredura — economiza ~12 a 25 s por lead e,
 * mais importante, poupa consultas do orçamento que o Bing racionaliza.
 *
 * `descarteFinal` roda no fim da varredura, quando já se sabe se o Bing caiu e
 * se o Instagram limitou o IP. Julgar "sem presença digital" no meio do laço
 * seria julgar com informação que ainda não existe.
 */

export const MOTIVOS = {
  fechado: "Permanentemente fechado",
  temSite: "Já tem site",
  semPresenca: "Sem presença digital",
};

/**
 * Piso do eixo de esforço.
 *
 * Calibrado nos pesos de `score.mjs`: um perfil que existe (10) com 10–39
 * posts (8) e menos de 400 seguidores (3) soma 21 e cai fora. O mesmo perfil
 * com 40 posts (16) e 400+ seguidores (8) soma 34 e fica. A fronteira é
 * "posta de vez em quando para pouca gente" contra "mantém o perfil vivo".
 */
const PISO_ESFORCO = 25;

/**
 * Descarte decidível sem Instagram e sem busca.
 *
 * Recebe os campos crus porque roda no meio da montagem do lead, antes de o
 * objeto final existir.
 */
export function descartePrecoce({ fechado, site }) {
  if (fechado) {
    return { motivo: "fechado", texto: "Marcado como permanentemente fechado no Google." };
  }

  // Só o nível `ok` desqualifica. `fraco`, `construtor`, `agregador`, `rede` e
  // `quebrado` continuam sendo lead — em vários casos são lead melhor que
  // "sem site", porque o dono já provou que se importa e ainda assim está mal
  // servido. Quem tem site de verdade funcionando é que não compra site.
  if (site?.nivel === "ok") {
    return {
      motivo: "temSite",
      texto: "Já tem site próprio funcionando" + (site.url ? " (" + site.url + ")" : "") + ".",
    };
  }

  return null;
}

/**
 * Descarte que exige o lead montado e a saúde da coleta.
 *
 * `contexto.buscaDesligada` e `contexto.instagramBloqueado` são o veto: se
 * qualquer um dos dois for verdadeiro, esta função não descarta ninguém por
 * falta de presença, porque a ausência de sinal deixou de ser informação.
 */
export function descarteFinal(lead, contexto = {}) {
  const precoce = descartePrecoce({ fechado: lead.gmn?.fechado, site: lead.site });
  if (precoce) return precoce;

  const { buscaDesligada = false, instagramBloqueado = false } = contexto;

  // Coleta comprometida: ninguém sai por falta de sinal.
  if (buscaDesligada || instagramBloqueado || lead.buscaBloqueada) return null;
  if (lead.instagram?.bloqueado) return null;

  /* A nota já carrega o próprio veto. `confianca.parcial` é exatamente
     "faltou dado para avaliar este lead", e descartar em cima disso é o bug
     que este módulo existe para não cometer.

     Isto não é teoria: rodando as regras sobre a varredura de 25 salva em
     data/, a versão sem esta linha cortava 9 clínicas — todas sem @ localizado
     e todas com 74 a 678 avaliações no Google. Entre elas o Primer
     Odontocenter, que o README cita como o caso em que a busca falhou e o
     negócio tem dois perfis. Eram os leads mais quentes da lista. */
  if (lead.score?.confianca?.nivel === "parcial") return null;

  const esforco = lead.score?.esforco ?? 0;
  if (esforco >= PISO_ESFORCO) return null;

  // Prova direta e única: o perfil foi lido e está parado.
  if (lead.instagram?.existe === true) {
    return {
      motivo: "semPresenca",
      texto:
        "Perfil lido e praticamente parado (" +
        [
          lead.instagram.posts != null ? lead.instagram.posts + " posts" : null,
          lead.instagram.seguidores != null
            ? lead.instagram.seguidores.toLocaleString("pt-BR") + " seguidores"
            : null,
        ].filter(Boolean).join(", ") +
        ") — quem não investe em rede social também não investe em site.",
    };
  }

  /* Não existe "caso 2".
     A tentação é descartar quem ficou sem @ com a busca aparentemente saudável.
     Mas "não achei o perfil" nunca é prova de que o perfil não existe — e o
     custo dos dois erros é assimétrico: manter um lead frio custa uma linha na
     tela, descartar um lead quente custa o cliente. Quem não teve o perfil lido
     fica na lista com nota parcial, como sempre foi, e o card avisa. */
  return null;
}

/** Contagem por motivo, para a tela dizer o que sumiu e por quê. */
export function contarDescartes(descartados) {
  return descartados.reduce((acc, d) => {
    const k = d.descarte?.motivo || "outro";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}
