/**
 * Envio dos leads para o gestor da Triângulo.
 *
 * O prospector **não** escreve no banco do gestor. Ele fala com uma rota de
 * ingestão (`/api/prospector/leads`) e deixa o gestor ser o dono das próprias
 * regras: normalização de @ e telefone, rank do kanban, deduplicação, estágio
 * inicial. Duas aplicações escrevendo na mesma tabela com regras próprias é
 * como o funil começa a divergir de si mesmo.
 *
 * O lead vira um dossiê em `notes`, e não um punhado de campos perdidos: quem
 * abre o card três dias depois precisa ver de onde saiu a temperatura sem
 * voltar aqui.
 */

const MAPA_SITE = {
  inexistente: "não tem site",
  agregador: "só link na bio",
  rede: "só rede social",
  construtor: "site de construtor grátis",
  quebrado: "site fora do ar",
  fraco: "site fraco",
  ok: "site próprio ok",
};

/** O tri-estado de `hasWebsite` do gestor: null / false / true. */
function temSite(nivel) {
  if (nivel === "ok" || nivel === "fraco") return true;
  if (nivel === "inexistente" || nivel === "quebrado" || nivel === "agregador" || nivel === "rede") return false;
  if (nivel === "construtor") return true; // existe uma página, ainda que ruim
  return null;
}

/** O dossiê que vai para as anotações do card. */
function montarAnotacoes(lead, parametros) {
  const l = [];
  const s = lead.score;

  l.push(s.emoji + " " + s.rotulo.toUpperCase() + " — " + s.total + "/100  (esforço " + s.esforco + " · carência " + s.carencia + ")");
  l.push(s.resumo);
  l.push("");

  l.push("POR QUE:");
  for (const sinal of s.sinais.filter((x) => x.peso > 0).slice(0, 8)) {
    l.push("  • " + sinal.texto);
  }

  const neutros = s.sinais.filter((x) => x.peso === 0);
  if (neutros.length) {
    l.push("");
    l.push("CONTRAPONTOS:");
    for (const sinal of neutros.slice(0, 4)) l.push("  • " + sinal.texto);
  }

  l.push("");
  l.push("SITE: " + (MAPA_SITE[lead.site?.nivel] || "não verificado") +
    (lead.site?.url ? " — " + lead.site.url : ""));
  if (lead.site?.motivo) l.push("  " + lead.site.motivo);

  if (lead.instagram?.existe) {
    l.push("");
    l.push("INSTAGRAM: @" + lead.instagram.handle +
      " · " + (lead.instagram.seguidores?.toLocaleString("pt-BR") ?? "?") + " seguidores" +
      " · " + (lead.instagram.posts ?? "?") + " posts");
    if (lead.instagram.link?.url) {
      l.push("  Link da bio: " + lead.instagram.link.url + " (" + lead.instagram.link.tipo + ")");
    } else {
      l.push("  Link da bio: nenhum");
    }
    if (lead.instagram.bio) l.push("  Bio: " + lead.instagram.bio.slice(0, 240));
    if (lead.instagram.origem) l.push("  (@ encontrado por: " + lead.instagram.origem + ")");
  } else {
    l.push("");
    l.push("INSTAGRAM: não encontrado.");
  }

  l.push("");
  l.push("GOOGLE MEU NEGÓCIO:");
  l.push("  Nota " + (lead.gmn?.nota ?? "—") + " · " + (lead.gmn?.avaliacoes ?? "—") + " avaliações");
  if (lead.endereco) l.push("  " + lead.endereco);
  if (lead.gmn?.url) l.push("  " + lead.gmn.url);

  if (lead.erros?.length) {
    l.push("");
    l.push("RESSALVAS DA COLETA:");
    for (const e of lead.erros) l.push("  • " + e);
  }

  l.push("");
  l.push("— Coletado pelo Prospector em " +
    new Date().toLocaleDateString("pt-BR") +
    " · busca: " + parametros.termo + " em " + parametros.cidade + " " + (parametros.uf || ""));

  return l.join("\n");
}

/** Traduz um lead da varredura para o formato que a rota do gestor espera. */
export function paraLeadDoGestor(lead, parametros) {
  return {
    name: lead.nome,
    company: lead.categoria || null,
    city: lead.cidade || null,
    instagram: lead.instagram?.handle || null,
    phone: lead.telefone || null,
    email: lead.email || null,
    website: ["ok", "fraco", "construtor"].includes(lead.site?.nivel) ? lead.site.url : null,
    hasWebsite: temSite(lead.site?.nivel),
    source: "Prospector · " + parametros.termo + " · " + parametros.cidade,
    notes: montarAnotacoes(lead, parametros),
    // Campos fora do modelo Lead: a rota usa para ordenar e deduplicar, não grava.
    _temperatura: lead.score.temperatura,
    _pontos: lead.score.total,
    _placeId: lead.gmn?.placeId || null,
  };
}

/**
 * Envia ao gestor. Devolve o relatório de quem entrou, quem já existia e quem
 * falhou — a UI mostra os três, porque "23 enviados" esconde o caso em que 20
 * eram repetidos.
 */
export async function enviarAoGestor(leads, parametros, { url, token }) {
  if (!url) throw new Error("GESTOR_URL não está configurado no .env.");
  if (!token) throw new Error("PROSPECTOR_TOKEN não está configurado no .env.");

  const base = url.replace(/\/+$/, "");
  const corpo = {
    origem: "prospector",
    parametros,
    leads: leads.map((l) => paraLeadDoGestor(l, parametros)),
  };

  let resp;
  try {
    resp = await fetch(base + "/api/prospector/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-prospector-token": token },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    throw new Error(
      "Não foi possível falar com o gestor em " + base + " (" + e.message + "). " +
      "Confira se ele está rodando e se GESTOR_URL aponta para o endereço certo.",
    );
  }

  const texto = await resp.text();
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error("O gestor respondeu " + resp.status + " sem JSON: " + texto.slice(0, 200));
  }

  if (!resp.ok) {
    throw new Error(dados.error || "O gestor recusou o envio (" + resp.status + ").");
  }

  return dados;
}
