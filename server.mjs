/**
 * Servidor do Prospector.
 *
 * `node:http` puro, sem framework. O app tem sete rotas e serve quatro
 * arquivos estáticos — Express aqui seria um `node_modules` inteiro dentro do
 * Google Drive para economizar trinta linhas.
 *
 * A varredura demora minutos, então ela **não** acontece dentro da requisição.
 * `POST /api/prospeccao` devolve um id na hora e a execução segue em memória;
 * o navegador acompanha por SSE em `/api/prospeccao/:id/eventos`. Assim
 * recarregar a página não mata a coleta, e dá para fechar a aba e voltar.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { prospectar } from "./src/prospector.mjs";
import { novoId, salvar, carregar, lerIndice, apagar, paraCSV } from "./src/store.mjs";
import { enviarAoGestor } from "./src/gestor.mjs";
import { listarModelos, sugerirModelo, acharModelo } from "./src/modelos.mjs";
import { clonar, listarClones, PASTA_CLONES } from "./src/clonagem.mjs";
import { abrirNavegador, novaAba, versaoChrome } from "./src/cdp.mjs";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PUBLICO = join(RAIZ, "public");

/* ── .env ─────────────────────────────────────────────────────────────────── */

/**
 * Leitor de .env de uma linha só. O projeto não tem dependências e `dotenv`
 * seria a primeira — para ler três chaves.
 */
function carregarEnv() {
  const arq = join(RAIZ, ".env");
  if (!existsSync(arq)) return;
  for (const linha of readFileSync(arq, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = valor;
  }
}
carregarEnv();

const PORTA = Number(process.env.PORT || 4546);
const GESTOR_URL = process.env.GESTOR_URL || "http://localhost:3000";
const PROSPECTOR_TOKEN = process.env.PROSPECTOR_TOKEN || "";

/* ── execuções em andamento ───────────────────────────────────────────────── */

/**
 * Uma varredura por vez, de propósito. Duas em paralelo dobram o número de
 * abas contra o Maps e o Bing e é assim que se toma bloqueio — que custa muito
 * mais caro do que esperar a fila.
 */
const execucoes = new Map();

function novaExecucao(id, parametros) {
  const exec = {
    id,
    parametros,
    estado: "rodando",
    iniciadaEm: Date.now(),
    eventos: [],
    ouvintes: new Set(),
    leads: [],
    resultado: null,
    erro: null,
  };
  execucoes.set(id, exec);
  return exec;
}

function emitir(exec, evento) {
  const carimbado = { ...evento, em: Date.now() };
  exec.eventos.push(carimbado);
  if (exec.eventos.length > 500) exec.eventos.splice(0, exec.eventos.length - 500);
  for (const escrever of exec.ouvintes) {
    try { escrever(carimbado); } catch { /* cliente sumiu */ }
  }
}

const rodandoAgora = () => [...execucoes.values()].some((e) => e.estado === "rodando");

/* ── utilidades de resposta ───────────────────────────────────────────────── */

const json = (res, dados, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(dados));
};

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

async function servirArquivo(res, alvo, raiz) {
  // normalize + prefixo: sem isso "/../.env" sairia servido.
  if (!normalize(alvo).startsWith(normalize(raiz))) {
    return json(res, { error: "caminho inválido" }, 400);
  }
  try {
    const dados = await readFile(alvo);
    res.writeHead(200, {
      "Content-Type": TIPOS[extname(alvo)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(dados);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve uma proposta: `/proposta/<slug>/…`.
 *
 * A pasta do clone vem primeiro e o `dist/` do modelo depois. É essa ordem que
 * faz a proposta funcionar sem copiar o site: `marca.json`, `logo.png` e as
 * fotos saem do clone; todo o resto — HTML, JS, CSS, imagens do modelo — sai do
 * modelo, compartilhado por todas as propostas. Corrigir o modelo conserta
 * todas de uma vez.
 *
 * Caminho que não existe em nenhum dos dois cai no `index.html` do modelo, que
 * é o de sempre em app de página única.
 */
async function servirProposta(res, rota) {
  const partes = rota.split("/").filter(Boolean); // ["proposta", slug, ...resto]
  const slug = partes[1];
  if (!slug) return json(res, { error: "Proposta não informada." }, 404);

  const pastaClone = join(PASTA_CLONES, slug);
  if (!existsSync(join(pastaClone, "marca.json"))) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Proposta não encontrada. Clone o lead primeiro.");
  }

  const marca = JSON.parse(readFileSync(join(pastaClone, "marca.json"), "utf8"));
  const modelo = acharModelo(marca.modelo);
  if (!modelo) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("O modelo '" + marca.modelo + "' desta proposta não está mais disponível.");
  }

  const resto = partes.slice(2).join("/") || "index.html";

  if (await servirArquivo(res, join(pastaClone, resto), pastaClone)) return;
  if (await servirArquivo(res, join(modelo.dist, resto), modelo.dist)) return;
  if (await servirArquivo(res, join(modelo.dist, "index.html"), modelo.dist)) return;

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Não encontrado.");
}

async function servirEstatico(res, caminho) {
  const alvo = normalize(join(PUBLICO, caminho === "/" ? "index.html" : caminho));
  if (!alvo.startsWith(PUBLICO)) return json(res, { error: "caminho inválido" }, 400);

  try {
    const dados = await readFile(alvo);
    res.writeHead(200, {
      "Content-Type": TIPOS[extname(alvo)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(dados);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Não encontrado.");
  }
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = "";
    req.on("data", (c) => {
      bruto += c;
      if (bruto.length > 8_000_000) reject(new Error("Corpo grande demais."));
    });
    req.on("end", () => {
      try { resolve(bruto ? JSON.parse(bruto) : {}); }
      catch { reject(new Error("JSON inválido no corpo da requisição.")); }
    });
    req.on("error", reject);
  });
}

/* ── rotas ────────────────────────────────────────────────────────────────── */

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const rota = url.pathname;

  try {
    /* Diagnóstico: a tela mostra isso antes de deixar prospectar, porque sem
       Chrome nada funciona e o erro apareceria só depois de um minuto. */
    if (rota === "/api/diagnostico") {
      return json(res, {
        chrome: versaoChrome(),
        gestor: { url: GESTOR_URL, tokenConfigurado: !!PROSPECTOR_TOKEN },
        rodando: rodandoAgora(),
        execucoes: lerIndice().slice(0, 20),
      });
    }

    if (rota === "/api/prospeccao" && req.method === "POST") {
      if (rodandoAgora()) {
        return json(res, { error: "Já existe uma varredura em andamento. Espere ela terminar." }, 409);
      }

      const corpo = await lerCorpo(req);
      const termo = String(corpo.termo || "").trim();
      const cidade = String(corpo.cidade || "").trim();

      if (!termo) return json(res, { error: "Informe o nicho ou o termo de busca." }, 400);
      if (!cidade) return json(res, { error: "Informe a cidade." }, 400);

      const parametros = {
        termo,
        cidade,
        uf: String(corpo.uf || "").trim().toUpperCase(),
        quantidade: Math.min(120, Math.max(1, Number(corpo.quantidade) || 20)),
        profundidade: corpo.profundidade === "rapida" ? "rapida" : "completa",
        mostrarNavegador: !!corpo.mostrarNavegador,
      };

      const id = novoId(parametros);
      const exec = novaExecucao(id, parametros);

      // Dispara e não espera: a resposta sai agora, a coleta segue.
      prospectar(parametros, (e) => {
        if (e.tipo === "lead-pronto") exec.leads.push(e.lead);
        emitir(exec, e);
      })
        .then((resultado) => {
          exec.estado = "concluida";
          exec.resultado = resultado;
          salvar(id, resultado);
          emitir(exec, { tipo: "fim", resultado });
        })
        .catch((erro) => {
          exec.estado = "erro";
          exec.erro = erro.message;
          emitir(exec, { tipo: "erro", mensagem: erro.message });
        });

      return json(res, { id, parametros });
    }

    /* SSE. Reenvia o histórico ao conectar — quem recarregou a página no meio
       da varredura vê o que já aconteceu, não uma tela vazia. */
    const mEventos = rota.match(/^\/api\/prospeccao\/([^/]+)\/eventos$/);
    if (mEventos) {
      const exec = execucoes.get(decodeURIComponent(mEventos[1]));
      if (!exec) return json(res, { error: "Execução não encontrada." }, 404);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const escrever = (evento) => res.write("data: " + JSON.stringify(evento) + "\n\n");
      for (const e of exec.eventos) escrever(e);
      if (exec.estado !== "rodando") escrever({ tipo: "encerrado", estado: exec.estado });

      exec.ouvintes.add(escrever);

      // Comentário SSE a cada 20 s: sem tráfego, proxies e o próprio Windows
      // derrubam a conexão no meio de uma varredura longa.
      const pulso = setInterval(() => res.write(": pulso\n\n"), 20000);
      req.on("close", () => {
        clearInterval(pulso);
        exec.ouvintes.delete(escrever);
      });
      return;
    }

    const mExec = rota.match(/^\/api\/prospeccao\/([^/]+)$/);
    if (mExec) {
      const id = decodeURIComponent(mExec[1]);

      if (req.method === "DELETE") {
        apagar(id);
        execucoes.delete(id);
        return json(res, { ok: true });
      }

      const exec = execucoes.get(id);
      if (exec) {
        return json(res, {
          id,
          estado: exec.estado,
          parametros: exec.parametros,
          erro: exec.erro,
          resultado: exec.resultado || { ...exec.parametros, leads: exec.leads, total: exec.leads.length },
        });
      }
      const salvo = carregar(id);
      if (!salvo) return json(res, { error: "Execução não encontrada." }, 404);
      return json(res, { id, estado: "concluida", resultado: salvo });
    }

    if (rota === "/api/execucoes") return json(res, { execucoes: lerIndice() });


    const mCsv = rota.match(/^\/api\/exportar\/([^/]+)\.csv$/);
    if (mCsv) {
      const id = decodeURIComponent(mCsv[1]);
      const dados = carregar(id) || execucoes.get(id)?.resultado;
      if (!dados) return json(res, { error: "Execução não encontrada." }, 404);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + id + '.csv"',
      });
      return res.end(paraCSV(dados));
    }

    if (rota === "/api/gestor/enviar" && req.method === "POST") {
      const corpo = await lerCorpo(req);
      const id = String(corpo.id || "");
      const dados = carregar(id) || execucoes.get(id)?.resultado;
      if (!dados) return json(res, { error: "Execução não encontrada." }, 404);

      // A tela manda os índices marcados; sem seleção, vão todos.
      const escolhidos = Array.isArray(corpo.indices) && corpo.indices.length
        ? corpo.indices.map((i) => dados.leads[i]).filter(Boolean)
        : dados.leads;

      if (!escolhidos.length) return json(res, { error: "Nenhum lead selecionado." }, 400);

      try {
        const relatorio = await enviarAoGestor(escolhidos, dados.parametros, {
          url: GESTOR_URL,
          token: PROSPECTOR_TOKEN,
        });
        dados.enviadosAoGestor = (dados.enviadosAoGestor || 0) + (relatorio.criados || 0);
        salvar(id, dados);
        return json(res, relatorio);
      } catch (e) {
        return json(res, { error: e.message }, 502);
      }
    }

    if (rota === "/api/modelos") {
      const modelos = listarModelos().map(({ id, rotulo, descricao, nicho }) => ({
        id, rotulo, descricao, nicho,
      }));
      return json(res, { modelos });
    }

    if (rota === "/api/clones") return json(res, { clones: listarClones() });

    /**
     * Clonar. É aqui que o lead vira proposta E entra no CRM — as duas coisas
     * no mesmo gesto, de propósito: o funil é para quem a agência vai abordar
     * com uma proposta na mão, não para todo negócio que a varredura encontrou.
     * Mandar os 30 ao gestor enche o CRM de gente que ninguém vai procurar.
     *
     * A ordem importa. Cloná primeiro, manda depois: se a clonagem falhar, o
     * lead não entra no funil e você tenta de novo. Se mandasse antes, um erro
     * na clonagem deixaria um lead no CRM prometendo uma proposta que não
     * existe — e ninguém descobre isso olhando o funil.
     */
    if (rota === "/api/clonar" && req.method === "POST") {
      const corpo = await lerCorpo(req);
      const id = String(corpo.id || "");
      const dados = carregar(id) || execucoes.get(id)?.resultado;
      if (!dados) return json(res, { error: "Execução não encontrada." }, 404);

      const lead = dados.leads[Number(corpo.indice)];
      if (!lead) return json(res, { error: "Lead não encontrado nesta varredura." }, 404);

      const modelo = String(corpo.modelo || "") || sugerirModelo(dados.parametros?.termo);
      if (!modelo) {
        return json(res, {
          error:
            "Nenhum modelo disponível. Rode `npm run build` no modelo em '../modelos site/<nicho>/<modelo>' — " +
            "só entram na lista os que têm dist/index.html.",
        }, 409);
      }

      // Navegador próprio e curto: a varredura já fechou o dela, e a paleta
      // precisa de canvas. Headless sempre — clonar não é para ser assistido.
      let navegador = null;
      let aba = null;
      let resultado;
      try {
        navegador = await abrirNavegador({ headless: true });
        aba = await novaAba(navegador.porta);
        resultado = await clonar(lead, { modelo, aba, varredura: id });
      } catch (e) {
        return json(res, { error: "A clonagem falhou: " + e.message }, 500);
      } finally {
        await aba?.fechar().catch(() => {});
        navegador?.fechar();
      }

      // Proposta pronta: agora o lead pode entrar no funil.
      let gestor = null;
      if (corpo.enviarAoGestor !== false) {
        try {
          gestor = await enviarAoGestor([lead], dados.parametros, {
            url: GESTOR_URL,
            token: PROSPECTOR_TOKEN,
          });
          dados.enviadosAoGestor = (dados.enviadosAoGestor || 0) + (gestor.criados || 0);
          salvar(id, dados);
        } catch (e) {
          // A proposta está feita; dizer isso e separar o erro do envio é mais
          // útil que devolver 502 e deixar o usuário achar que perdeu tudo.
          gestor = { erro: e.message };
        }
      }

      return json(res, { ...resultado, gestor });
    }

    if (rota.startsWith("/api/")) return json(res, { error: "Rota inexistente." }, 404);

    if (rota.startsWith("/proposta/")) return servirProposta(res, rota);

    return servirEstatico(res, rota);
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
});

servidor.listen(PORTA, "127.0.0.1", () => {
  const chrome = versaoChrome();
  console.log("");
  console.log("  Prospector Triângulo");
  console.log("  → http://localhost:" + PORTA);
  console.log("");
  console.log("  Chrome: " + (chrome || "NÃO ENCONTRADO — instale o Chrome ou defina CHROME_PATH no .env"));
  console.log("  Gestor: " + GESTOR_URL + (PROSPECTOR_TOKEN ? "" : "  (sem PROSPECTOR_TOKEN — o envio ao gestor vai recusar)"));
  console.log("");
});
