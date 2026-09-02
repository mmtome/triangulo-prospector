/*
 * Front do Prospector. Sem framework e sem build: o app tem uma tela, um
 * formulário e uma lista. React aqui custaria um passo de build para ganhar
 * nada — e o projeto inteiro se sustenta em não ter node_modules.
 *
 * O estado vive em `estado`, e `desenhar()` reconstrói a lista. Com dezenas de
 * leads o custo de redesenhar tudo é irrelevante, e some a classe de bug em que
 * a tela e os dados discordam.
 */

const $ = (sel) => document.querySelector(sel);

const estado = {
  execucaoId: null,
  leads: [],
  descartados: [],
  verDescartados: false,
  parametros: null,
  selecionados: new Set(),
  filtro: null,      // null = todas as temperaturas
  rodando: false,
  fonte: null,       // EventSource
  alvoLeads: 20,     // quantos leads a varredura prometeu entregar
  modelos: [],       // catálogo vindo de /api/modelos
  modelo: null,      // o escolhido para clonar
  propostas: {},     // indice do lead → resultado da clonagem
};

const TEMPERATURAS = [
  { chave: "quente", rotulo: "Quente", emoji: "🔥" },
  { chave: "morno", rotulo: "Morno", emoji: "🟠" },
  { chave: "frio", rotulo: "Frio", emoji: "🔵" },
  { chave: "gelado", rotulo: "Gelado", emoji: "⚪" },
];

const escapar = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const numero = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));

function telefoneBonito(t) {
  if (!t) return null;
  const br = t.startsWith("55") ? t.slice(2) : t;
  if (br.length === 11) return "(" + br.slice(0, 2) + ") " + br.slice(2, 7) + "-" + br.slice(7);
  if (br.length === 10) return "(" + br.slice(0, 2) + ") " + br.slice(2, 6) + "-" + br.slice(6);
  return t;
}

/* ── avisos ──────────────────────────────────────────────────────────────── */

function avisar(tipo, html) {
  $("#avisos").innerHTML = '<div class="aviso aviso-' + tipo + '">' + html + "</div>";
}
const limparAvisos = () => ($("#avisos").innerHTML = "");

/* ── diagnóstico ─────────────────────────────────────────────────────────── */

async function carregarDiagnostico() {
  try {
    const d = await (await fetch("/api/diagnostico")).json();

    const chromeOk = !!d.chrome;
    const gestorOk = d.gestor.tokenConfigurado;

    $("#diagnostico").innerHTML =
      '<span class="pino ' + (chromeOk ? "ok" : "ruim") + '" title="' + escapar(d.chrome || "Chrome não encontrado") + '">' +
        '<i class="bolha"></i>Chrome</span>' +
      '<span class="pino ' + (gestorOk ? "ok" : "") + '" title="' + escapar(d.gestor.url) + '">' +
        '<i class="bolha"></i>Gestor</span>' +
      '<span class="pino ' + (d.instagram?.logado ? "ok" : "") + '" title="' +
        escapar(
          d.instagram?.logado
            ? "Sessão salva — as varreduras navegam logadas"
            : "Anônimo. Rode `npm run login` para acabar com o bloqueio e liberar as fotos dos posts.",
        ) + '"><i class="bolha"></i>Instagram</span>';

    if (!chromeOk) {
      avisar("erro",
        "<b>O Chrome não foi encontrado.</b> O Prospector dirige um Chrome de verdade " +
        "para ler o Google Maps e o Instagram — sem ele nada roda. Instale o Google Chrome " +
        "ou aponte o caminho em <code>CHROME_PATH</code> no arquivo <code>.env</code>.");
    }

    desenharHistorico(d.execucoes || []);
  } catch {
    $("#diagnostico").innerHTML = '<span class="pino ruim"><i class="bolha"></i>Servidor</span>';
  }
}

function desenharHistorico(lista) {
  const alvo = $("#historico");
  if (!lista.length) {
    alvo.innerHTML = '<div style="font-size:12px;color:var(--faint)">Nada ainda.</div>';
    return;
  }
  alvo.innerHTML = lista
    .map((e) => {
      const q = e.porTemperatura?.quente || 0;
      const data = new Date(e.executadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      return '<button data-id="' + escapar(e.id) + '">' +
        escapar(e.termo) + " · " + escapar(e.cidade) +
        "<small>" + data + " — " + e.total + " leads" + (q ? " · " + q + " quentes" : "") + "</small>" +
        "</button>";
    })
    .join("");

  alvo.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => abrirExecucao(b.dataset.id)));
}

/* ── varredura ───────────────────────────────────────────────────────────── */

$("#formulario").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (estado.rodando) return;

  const corpo = {
    termo: $("#termo").value.trim(),
    cidade: $("#cidade").value.trim(),
    uf: $("#uf").value.trim(),
    quantidade: Number($("#quantidade").value),
    profundidade: $("#profundidade").value,
    mostrarNavegador: $("#mostrarNavegador").checked,
  };

  limparAvisos();

  const resp = await fetch("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json();

  if (!resp.ok) return avisar("erro", escapar(dados.error));

  estado.execucaoId = dados.id;
  estado.parametros = dados.parametros;
  estado.leads = [];
  estado.descartados = [];
  estado.selecionados.clear();
  estado.filtro = null;
  estado.rodando = true;

  $("#btnProspectar").disabled = true;
  $("#btnProspectar").textContent = "Prospectando…";
  $("#progresso").classList.add("ativo");
  $("#contador").textContent = "0";
  $("#contadorAlvo").textContent = "de " + corpo.quantidade + " leads";
  estado.alvoLeads = corpo.quantidade;
  $("#barraInterna").style.width = "0%";

  desenhar();
  ouvir(dados.id, corpo.quantidade);
});

/* A barra mede o alvo de leads. Medir lugares avaliados faria ela encher e
   parar em 33% numa varredura bem-sucedida, porque o mapa agora colhe até 3x
   o alvo e o laço para assim que a cota fecha. */
function avancarBarra() {
  const alvo = estado.alvoLeads || 1;
  $("#barraInterna").style.width = Math.min(100, (estado.leads.length / alvo) * 100) + "%";
}

function ouvir(id, alvo) {
  if (estado.fonte) estado.fonte.close();

  const fonte = new EventSource("/api/prospeccao/" + encodeURIComponent(id) + "/eventos");
  estado.fonte = fonte;

  fonte.onmessage = (ev) => {
    const e = JSON.parse(ev.data);

    if (e.tipo === "status") {
      $("#statusTexto").textContent = e.texto;
    } else if (e.tipo === "encontrados") {
      if (e.alvoLeads) estado.alvoLeads = e.alvoLeads;
      $("#contadorAlvo").textContent = "de " + (e.alvoLeads || e.total) + " leads";
      $("#statusTexto").textContent =
        "Analisando " + e.total + " estabelecimentos até juntar " + (e.alvoLeads || e.total) + " leads…";
    } else if (e.tipo === "lead-pronto") {
      // Evita duplicar quando o SSE reenvia o histórico numa reconexão.
      if (!estado.leads.some((l) => l.gmn?.placeId && l.gmn.placeId === e.lead.gmn?.placeId)) {
        estado.leads.push(e.lead);
      }
      $("#contador").textContent = String(estado.leads.length);
      avancarBarra();
      desenhar();
    } else if (e.tipo === "lead-descartado") {
      // Não entra na lista — só na contagem. O motivo fica guardado porque uma
      // varredura que descarta quase tudo precisa poder ser auditada.
      if (!estado.descartados.some((d) => d.gmn?.placeId && d.gmn.placeId === e.lead.gmn?.placeId)) {
        estado.descartados.push(e.lead);
      }
      avancarBarra();
      desenhar();
    } else if (e.tipo === "fim") {
      terminar();
      estado.leads = e.resultado.leads;
      estado.descartados = e.resultado.descartados || [];
      estado.parametros = e.resultado.parametros;
      $("#statusTexto").textContent =
        e.resultado.total + " leads de site" +
        (e.resultado.pedidos ? " de " + e.resultado.pedidos + " pedidos" : "") +
        " em " + (e.resultado.avaliados ?? e.resultado.total) +
        " avaliados, em " + e.resultado.duracaoSegundos + "s.";
      if (!avisarSobreBusca(e.resultado.busca)) avisarSobreAlvo(e.resultado);
      desenhar();
      carregarDiagnostico();
    } else if (e.tipo === "erro") {
      terminar();
      avisar("erro", "<b>A varredura falhou.</b> " + escapar(e.mensagem));
    } else if (e.tipo === "encerrado") {
      terminar();
    }
  };

  fonte.onerror = () => { /* o EventSource reconecta sozinho */ };
}

function terminar() {
  estado.rodando = false;
  $("#btnProspectar").disabled = false;
  $("#btnProspectar").textContent = "Prospectar";
  $("#barraInterna").style.width = "100%";
  if (estado.fonte) { estado.fonte.close(); estado.fonte = null; }
}

/**
 * "11 leads sem Instagram" significa coisas opostas conforme o Bing tenha
 * respondido ou bloqueado. Sem este aviso, uma varredura bloqueada parece uma
 * lista de negócios sem presença digital — e é justamente o contrário: os
 * leads sem @ são os que ficaram sem ser avaliados.
 */
function avisarSobreBusca(busca) {
  if (!busca) return false;

  // O muro de login do Instagram é o pior dos casos e vem primeiro: sem ele o
  // eixo de esforço zera em todo mundo e a cidade inteira sai gelada.
  if (busca.instagramBloqueado) {
    avisar("erro",
      "<b>O Instagram exigiu login em todos os perfis desta varredura.</b> " +
      "É o limite de acessos deste IP (nenhum perfil foi lido em " + busca.instagramBloqueios + " tentativas). " +
      "<b>As notas desta lista não valem</b> — sem os posts e seguidores, o eixo de esforço zera " +
      "e todo lead parece gelado. Espere algumas horas e rode de novo.");
    return true;
  }

  if (busca.bloqueado && busca.semInstagram > 0) {
    avisar("erro",
      "<b>O Bing bloqueou a busca no meio da varredura.</b> " +
      busca.semInstagram + " lead(s) ficaram sem @ e estão com <b>nota parcial</b> — " +
      "não é que não tenham Instagram, é que não deu para procurar. " +
      "Rode a mesma busca daqui a alguns minutos: o histórico deduplica pelo Google, " +
      "então ninguém é prospectado duas vezes.");
  } else if (busca.bloqueado) {
    /* Bloqueou mas não custou lead: o pool inicial já tinha os perfis. Vermelho
       aqui treina o usuário a ignorar o aviso vermelho que importa. */
    avisar("nota",
      "O Bing bloqueou a busca no fim da varredura, mas <b>nenhum lead ficou sem @</b> — " +
      "o pool inicial deu conta. Nada a refazer.");
  } else if (busca.semInstagram > busca.pool && busca.semInstagram >= 5) {
    avisar("nota",
      busca.semInstagram + " lead(s) saíram sem Instagram. A busca respondeu normalmente " +
      "(" + busca.consultas + " consultas, " + busca.pool + " perfis no pool), então são " +
      "negócios sem perfil localizável — mas vale conferir um ou dois na mão antes de descartar.");
  } else {
    return false;
  }
  return true;
}

/* Por que um resultado curto precisa de explicação: o campo promete N leads, e
   entregar menos parece defeito. Só existem duas causas, e elas pedem ações
   opostas — teto batido (nicho saturado: mude o nicho ou aceite menos) e mapa
   esgotado (a cidade não tem mais desse nicho: mude a cidade). */
function avisarSobreAlvo(r) {
  const pedidos = r.pedidos;
  if (!pedidos || r.total >= pedidos) return false;

  const bateuTeto = r.tetoAvaliados && r.avaliados >= r.tetoAvaliados;
  avisar("nota",
    "Você pediu <b>" + pedidos + "</b> leads e a varredura entregou <b>" + r.total + "</b>. " +
    (bateuTeto
      ? "Ela avaliou " + r.avaliados + " negócios (o teto) e parou: neste nicho a maioria " +
        "já tem site. Os descartados estão logo abaixo, com o motivo de cada um."
      : "O mapa acabou antes — só existem " + r.avaliados + " " +
        "desse nicho na cidade, e os descartados estão logo abaixo com o motivo."));
  return true;
}

async function abrirExecucao(id) {
  limparAvisos();
  const r = await fetch("/api/prospeccao/" + encodeURIComponent(id));
  const d = await r.json();
  if (!r.ok) return avisar("erro", escapar(d.error));

  estado.execucaoId = id;
  estado.leads = d.resultado.leads || [];
  estado.descartados = d.resultado.descartados || [];
  estado.parametros = d.resultado.parametros;
  estado.selecionados.clear();
  estado.filtro = null;
  $("#progresso").classList.remove("ativo");
  if (!avisarSobreBusca(d.resultado.busca)) avisarSobreAlvo(d.resultado);
  desenhar();
}

/* ── desenho ─────────────────────────────────────────────────────────────── */

function desenhar() {
  desenharResumo();
  desenharDescartados();
  desenharAcoes();
  desenharLeads();
}

const ROTULO_DESCARTE = {
  temSite: "já têm site",
  semPresenca: "sem presença digital",
  fechado: "fechados",
};

/**
 * A linha dos descartados.
 *
 * Eles não entram na lista — foi o pedido — mas some-los por completo tornaria
 * impossível distinguir "nicho saturado de sites" de "a coleta quebrou". Fica a
 * contagem com o motivo, e a lista abre em um clique.
 */
function desenharDescartados() {
  const alvo = $("#descartados");
  if (!alvo) return;

  const ds = estado.descartados || [];
  if (!ds.length) return (alvo.innerHTML = "");

  const contagem = ds.reduce((acc, d) => {
    const k = d.descarte?.motivo || "outro";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const detalhe = Object.entries(contagem)
    .map(([k, n]) => n + " " + (ROTULO_DESCARTE[k] || k))
    .join(" · ");

  let html =
    '<button class="linha-descarte" id="alternarDescartados" aria-expanded="' + estado.verDescartados + '">' +
      "<b>" + ds.length + "</b> fora da lista — " + escapar(detalhe) +
      "<span>" + (estado.verDescartados ? "ocultar" : "ver") + "</span>" +
    "</button>";

  if (estado.verDescartados) {
    html += '<ul class="lista-descarte">' + ds.map((d) =>
      "<li><b>" + escapar(d.nome || "?") + "</b>" +
      (d.gmn?.url ? ' <a href="' + escapar(d.gmn.url) + '" target="_blank" rel="noreferrer">maps</a>' : "") +
      "<small>" + escapar(d.descarte?.texto || "") + "</small></li>").join("") + "</ul>";
  }

  alvo.innerHTML = html;
  $("#alternarDescartados").onclick = () => {
    estado.verDescartados = !estado.verDescartados;
    desenharDescartados();
  };
}

function desenharResumo() {
  if (!estado.leads.length) return ($("#resumo").innerHTML = "");

  const contagem = {};
  for (const l of estado.leads) contagem[l.score.temperatura] = (contagem[l.score.temperatura] || 0) + 1;

  const fichas = TEMPERATURAS.filter((t) => contagem[t.chave]).map((t) =>
    '<button class="ficha" data-temp="' + t.chave + '" aria-pressed="' + (estado.filtro === t.chave) + '">' +
      t.emoji + " " + t.rotulo + " <b>" + contagem[t.chave] + "</b></button>");

  fichas.unshift(
    '<button class="ficha" data-temp="" aria-pressed="' + (estado.filtro === null) + '">' +
    "Todos <b>" + estado.leads.length + "</b></button>");

  $("#resumo").innerHTML = fichas.join("");
  $("#resumo").querySelectorAll(".ficha").forEach((b) =>
    b.addEventListener("click", () => {
      estado.filtro = b.dataset.temp || null;
      desenhar();
    }));
}

function visiveis() {
  return estado.leads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !estado.filtro || l.score.temperatura === estado.filtro);
}

function desenharAcoes() {
  if (!estado.leads.length) return ($("#acoes").innerHTML = "");

  const n = estado.selecionados.size;
  const lista = visiveis();

  $("#acoes").innerHTML =
    '<button class="btn btn-pequeno" id="selecionarVisiveis">Selecionar os ' + lista.length + " visíveis</button>" +
    '<button class="btn btn-pequeno" id="selecionarQuentes">Só os quentes</button>' +
    '<button class="btn btn-pequeno" id="limparSelecao">Limpar seleção</button>' +
    '<span class="empurra"></span>' +
    '<a class="btn btn-pequeno" href="/api/exportar/' + encodeURIComponent(estado.execucaoId) + '.csv">Baixar CSV</a>' +
    seletorDeModelo() +
    '<button class="btn btn-pequeno" id="enviarGestor"' + (n ? "" : " disabled") + ">" +
      (n ? "Enviar " + n + " sem proposta" : "Enviar sem proposta") + "</button>";

  $("#selecionarVisiveis").onclick = () => {
    lista.forEach(({ i }) => estado.selecionados.add(i));
    desenhar();
  };
  $("#selecionarQuentes").onclick = () => {
    estado.selecionados.clear();
    estado.leads.forEach((l, i) => { if (l.score.temperatura === "quente") estado.selecionados.add(i); });
    desenhar();
  };
  $("#limparSelecao").onclick = () => { estado.selecionados.clear(); desenhar(); };
  $("#enviarGestor").onclick = enviarAoGestor;
}

function desenharLeads() {
  const alvo = $("#leads");
  const lista = visiveis();

  if (!lista.length) {
    alvo.innerHTML = estado.rodando
      ? '<div class="vazio"><b>Coletando…</b>Os leads aparecem aqui conforme são analisados.</div>'
      : '<div class="vazio"><b>Nenhum lead nessa faixa</b>Troque o filtro acima.</div>';
    return;
  }

  alvo.innerHTML = lista.map(({ l, i }) => cartao(l, i)).join("");

  alvo.querySelectorAll('.btn-clonar').forEach((b) =>
    b.addEventListener('click', () => clonarLead(Number(b.dataset.i), b)));

  alvo.querySelectorAll('input[type="checkbox"]').forEach((c) =>
    c.addEventListener("change", () => {
      const i = Number(c.dataset.i);
      c.checked ? estado.selecionados.add(i) : estado.selecionados.delete(i);
      c.closest(".lead").classList.toggle("marcado", c.checked);
      desenharAcoes();
    }));
}

function cartao(l, i) {
  const s = l.score;
  const marcado = estado.selecionados.has(i);

  const dados = [];

  if (l.telefone) {
    dados.push('<span class="dado' + (l.temWhatsapp ? " bom" : "") + '">' +
      (l.temWhatsapp ? "WhatsApp" : "Telefone") + " <b>" + escapar(telefoneBonito(l.telefone)) + "</b></span>");
  }

  if (l.instagram?.existe) {
    dados.push('<span class="dado">@<b>' + escapar(l.instagram.handle) + "</b></span>");
    dados.push('<span class="dado">' + numero(l.instagram.seguidores) + " seguidores</span>");
    dados.push('<span class="dado">' + numero(l.instagram.posts) + " posts</span>");
    const tipo = l.instagram.link?.tipo || "nenhum";
    const rotuloLink = {
      nenhum: "Sem link na bio", whatsapp: "Bio → WhatsApp", agregador: "Bio → link na bio",
      rede: "Bio → rede social", site: "Bio → site", encurtador: "Bio → encurtador", invalido: "Bio → link inválido",
    }[tipo];
    dados.push('<span class="dado ' + (tipo === "site" ? "" : "alerta") + '">' + rotuloLink + "</span>");
  } else {
    dados.push('<span class="dado">Sem Instagram encontrado</span>');
  }

  const rotuloSite = {
    inexistente: "Sem site", agregador: "Só link na bio", rede: "Só rede social",
    construtor: "Construtor grátis", quebrado: "Site fora do ar", fraco: "Site fraco", ok: "Site próprio ok",
  }[l.site?.nivel] || "Site não verificado";
  dados.push('<span class="dado ' + (l.site?.nivel === "ok" ? "" : "alerta") + '">' + rotuloSite + "</span>");

  if (l.gmn?.nota != null) {
    dados.push('<span class="dado">Google <b>' + String(l.gmn.nota).replace(".", ",") + "</b>" +
      (l.gmn.avaliacoes != null ? " · " + numero(l.gmn.avaliacoes) + " aval." : "") + "</span>");
  }

  const sinais = s.sinais.slice(0, 5).map((x) =>
    '<li class="' + (x.peso ? "" : "neutro") + '">' + escapar(x.texto) + "</li>").join("");

  const links = [];
  if (l.temWhatsapp && l.telefone) {
    links.push('<a class="btn btn-pequeno" target="_blank" rel="noopener" href="https://wa.me/' + l.telefone + '">WhatsApp</a>');
  }
  if (l.instagram?.url) {
    links.push('<a class="btn btn-pequeno" target="_blank" rel="noopener" href="' + escapar(l.instagram.url) + '">Instagram</a>');
  }
  if (l.gmn?.url) {
    links.push('<a class="btn btn-pequeno" target="_blank" rel="noopener" href="' + escapar(l.gmn.url) + '">Google Maps</a>');
  }
  if (l.site?.url) {
    links.push('<a class="btn btn-pequeno" target="_blank" rel="noopener" href="' + escapar(l.site.url) + '">Site</a>');
  }

  /* Clonar é o gesto que promove o lead: gera a proposta com a marca dele e é
     só aí que ele sobe para o CRM. O funil é para quem a agência vai abordar
     com uma proposta na mão, não para todo negócio que a varredura achou. */
  const proposta = estado.propostas[i];
  links.push(
    proposta
      ? '<a class="btn btn-pequeno btn-primario" target="_blank" rel="noopener" href="' +
        escapar(proposta.publicacao?.url || proposta.url) + '">' +
        (proposta.publicacao?.url ? "Abrir proposta publicada" : "Abrir proposta (local)") + "</a>"
      : '<button class="btn btn-pequeno btn-primario btn-clonar" data-i="' + i + '">Clonar modelo</button>',
  );

  const repetido = l.jaVisto
    ? '<div style="margin-top:10px;font-size:11px;color:var(--faint)">' +
      "↻ Já apareceu na varredura <b>" + escapar(l.jaVisto) + "</b>.</div>"
    : "";

  // A nota parcial é dita na cara: um lead sem @ encontrado pode ser o mais
  // quente da lista, e esconder isso faria confiar num número que não sabe.
  const parcial = l.score.confianca?.nivel === "parcial"
    ? '<div style="margin-top:10px;font-size:11px;color:var(--morno)">' +
      "◐ Nota parcial — " + escapar(l.score.confianca.faltas.join("; ")) + ".</div>"
    : "";

  const ressalvas = l.erros?.length
    ? '<div style="margin-top:6px;font-size:11px;color:var(--faint)">⚠ ' +
      l.erros.map(escapar).join(" · ") + "</div>"
    : "";

  return '' +
  '<article class="lead t-' + s.temperatura + (marcado ? " marcado" : "") + '">' +
    '<input type="checkbox" data-i="' + i + '"' + (marcado ? " checked" : "") + ' aria-label="Selecionar ' + escapar(l.nome) + '" />' +
    "<div>" +
      '<div class="cabeca">' +
        '<span class="selo">' + s.emoji + " " + escapar(s.rotulo) + "</span>" +
        "<div>" +
          "<h3>" + escapar(l.nome) + "</h3>" +
          '<div class="sub">' + escapar([l.categoria, l.endereco].filter(Boolean).join(" · ")) + "</div>" +
        "</div>" +
        '<div class="pontos"><b>' + s.total + "</b><small>de 100</small></div>" +
      "</div>" +

      '<p class="resumo-lead">' + escapar(s.resumo) + "</p>" +

      '<div class="eixos">' +
        '<div class="eixo"><span>Esforço digital <b>' + s.esforco + "</b></span>" +
          '<i style="--v:' + s.esforco + '%"></i></div>' +
        '<div class="eixo carencia"><span>Carência <b>' + s.carencia + "</b></span>" +
          '<i style="--v:' + s.carencia + '%"></i></div>' +
      "</div>" +

      '<div class="dados">' + dados.join("") + "</div>" +
      '<ul class="sinais">' + sinais + "</ul>" +
      '<div class="links">' + links.join("") + "</div>" +
      parcial + repetido + ressalvas +
    "</div>" +
  "</article>";
}

/* ── clonagem ────────────────────────────────────────────────────────────── */

async function carregarModelos() {
  try {
    const r = await fetch("/api/modelos");
    const d = await r.json();
    estado.modelos = d.modelos || [];
    if (!estado.modelo && estado.modelos.length) estado.modelo = estado.modelos[0].id;
  } catch {
    estado.modelos = [];
  }
}

/**
 * O seletor some quando só existe um modelo: escolher entre uma opção é um
 * clique inútil, e ocupa espaço que a barra de ações não tem sobrando.
 */
function seletorDeModelo() {
  if (estado.modelos.length < 2) return "";
  return (
    '<select id="modeloClone" class="btn-pequeno" title="Modelo usado ao clonar">' +
    estado.modelos
      .map(
        (m) =>
          '<option value="' + escapar(m.id) + '"' +
          (m.id === estado.modelo ? " selected" : "") + ">" + escapar(m.rotulo) + "</option>",
      )
      .join("") +
    "</select>"
  );
}

/**
 * Clona um lead: gera a proposta com a marca dele e o manda ao CRM.
 *
 * Demora — são downloads de imagem e um Chrome que sobe só para ler a paleta —
 * então o botão vira o próprio indicador de progresso. Uma barra global aqui
 * mentiria: você pode clonar três leads ao mesmo tempo.
 */
async function clonarLead(i, botao) {
  const lead = estado.leads[i];
  if (!lead) return;

  const original = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Clonando e publicando…";

  try {
    const r = await fetch("/api/clonar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: estado.execucaoId,
        indice: i,
        modelo: $("#modeloClone")?.value || estado.modelo || "",
      }),
    });
    const d = await r.json();

    if (!r.ok) {
      botao.disabled = false;
      botao.textContent = original;
      return avisar("erro", "<b>A clonagem falhou.</b> " + escapar(d.error || "erro desconhecido"));
    }

    estado.propostas[i] = d;

    /* O relatório conta o que entrou e o que não entrou. Uma proposta com a
       paleta do modelo em vez da do cliente ainda serve, mas você precisa saber
       disso antes de mandar o link — não depois que ele responde. */
    const partes = [];
    partes.push(d.temLogo ? "logo do perfil" : "sem logo");
    partes.push(d.paleta ? "paleta da marca" : "paleta do modelo");
    partes.push(d.fotos + (d.fotos === 1 ? " foto do Google" : " fotos do Google"));

    if (d.publicacao?.url) partes.push("publicada na Vercel");
    else if (d.publicacao?.erro) partes.push("<b>não publicou</b>: " + escapar(d.publicacao.erro));

    if (d.gestor?.erro) {
      partes.push("<b>não entrou no CRM</b>: " + escapar(d.gestor.erro));
    } else if (d.gestor) {
      partes.push(d.gestor.duplicados ? "já estava no CRM" : "no CRM");
    }

    const ressalvas = d.ressalvas?.length
      ? "<br><small>" + d.ressalvas.map(escapar).join("<br>") + "</small>"
      : "";

    avisar(
      d.gestor?.erro ? "nota" : "ok",
      "<b>Proposta gerada</b> — " + escapar(lead.nome) + ": " + partes.join(" · ") +
        '. <a href="' + escapar(d.publicacao?.url || d.url) + '" target="_blank" rel="noopener">' +
        (d.publicacao?.url ? "Abrir o link do cliente" : "Abrir proposta") + "</a>" +
        (d.publicacao?.url ? " <code>" + escapar(d.publicacao.url) + "</code>" : "") +
        ressalvas,
    );

    desenhar();
  } catch (e) {
    botao.disabled = false;
    botao.textContent = original;
    avisar("erro", "<b>A clonagem falhou.</b> " + escapar(e.message));
  }
}

/* ── envio ao gestor ─────────────────────────────────────────────────────── */

async function enviarAoGestor() {
  const indices = [...estado.selecionados];
  if (!indices.length) return;

  const btn = $("#enviarGestor");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  limparAvisos();

  try {
    const r = await fetch("/api/gestor/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: estado.execucaoId, indices }),
    });
    const d = await r.json();

    if (!r.ok) {
      avisar("erro", "<b>O envio ao gestor falhou.</b> " + escapar(d.error));
    } else {
      // "23 enviados" esconderia o caso em que 20 já existiam no funil.
      const partes = [];
      if (d.criados) partes.push("<b>" + d.criados + "</b> novos leads no funil");
      if (d.duplicados) partes.push("<b>" + d.duplicados + "</b> já existiam e foram atualizados");
      if (d.ignorados) partes.push("<b>" + d.ignorados + "</b> ignorados");

      avisar("ok", "Enviado ao gestor: " + (partes.join(" · ") || "nada a fazer") +
        '. <a href="' + escapar(d.urlDoFunil || "#") + '" target="_blank" rel="noopener">Abrir o funil</a>');

      estado.selecionados.clear();
      desenhar();
    }
  } catch (e) {
    avisar("erro", "<b>O envio falhou.</b> " + escapar(e.message));
  } finally {
    btn.disabled = false;
    desenharAcoes();
  }
}

carregarDiagnostico();
carregarModelos();
