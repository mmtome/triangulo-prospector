/**
 * Driver do Chrome pelo DevTools Protocol, sem nenhuma dependência.
 *
 * O projeto mora no Google Drive, onde `npm install` escreve dezenas de
 * milhares de arquivos pequenos que o Drive tenta sincronizar um a um. Puppeteer
 * traria isso e mais um Chromium de 200 MB. O Node 24 já tem `WebSocket` e
 * `fetch` nativos, e o Chrome já está instalado na máquina — então falar CDP
 * direto sai de graça e o repositório fica sem `node_modules`.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * UA de Chrome normal. Sem isso o navegador se anuncia como "HeadlessChrome" e
 * o Bing devolve uma página vazia — foi o único motivo do enriquecimento falhar
 * nos testes. Mantenha a versão perto da do Chrome instalado.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Remendos de superfície: `navigator.webdriver` é o que denuncia automação. */
const STEALTH = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = { runtime: {} };
`;

const CANDIDATOS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function acharChrome() {
  for (const c of CANDIDATOS) if (existsSync(c)) return c;
  return null;
}

/**
 * Sobe um Chrome próprio, com perfil descartável. Nunca reaproveita o perfil do
 * usuário: o Chrome recusa a porta de depuração quando já há uma instância com
 * aquele perfil aberta, e a sessão logada do usuário não deve ir para o scraper.
 */
export async function abrirNavegador({ headless = true, porta = 0 } = {}) {
  const chrome = acharChrome();
  if (!chrome) {
    throw new Error(
      "Chrome não encontrado. Instale o Google Chrome ou aponte CHROME_PATH no .env.",
    );
  }

  const perfil = mkdtempSync(join(tmpdir(), "triangulo-prospector-"));
  const p = porta || 9300 + Math.floor(Math.random() * 600);

  const args = [
    `--remote-debugging-port=${p}`,
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--mute-audio",
    "--lang=pt-BR",
    "--window-size=1440,1000",
    `--user-agent=${UA}`,
  ];
  if (headless) args.push("--headless=new", "--disable-gpu");

  const proc = spawn(chrome, args, { stdio: "ignore" });

  let versao = null;
  for (let i = 0; i < 80; i++) {
    try {
      versao = await (await fetch(`http://127.0.0.1:${p}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!versao) {
    proc.kill();
    throw new Error("O Chrome não respondeu na porta de depuração.");
  }

  const fechar = () => {
    try { proc.kill(); } catch { /* já morreu */ }
    // O Chrome ainda está escrevendo no perfil no instante em que morre.
    setTimeout(() => { try { rmSync(perfil, { recursive: true, force: true }); } catch {} }, 1500);
  };

  return { porta: p, proc, fechar };
}

/** Aba nova, já com o UA e os remendos aplicados. */
export async function novaAba(porta) {
  const alvo = await (
    await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, { method: "PUT" })
  ).json();

  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("Falha ao abrir o WebSocket do CDP."));
  });

  let seq = 0;
  const pendentes = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (!msg.id || !pendentes.has(msg.id)) return;
    const { res, rej, timer } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    clearTimeout(timer);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  };

  const enviar = (metodo, params = {}, timeoutMs = 45000) =>
    new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pendentes.delete(id);
        rej(new Error(`CDP ${metodo}: timeout`));
      }, timeoutMs);
      pendentes.set(id, { res, rej, timer });
      ws.send(JSON.stringify({ id, method: metodo, params }));
    });

  await enviar("Page.enable");
  await enviar("Runtime.enable");
  await enviar("Network.enable");
  await enviar("Network.setUserAgentOverride", {
    userAgent: UA,
    acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8",
    platform: "Win32",
  });
  await enviar("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH });

  /** Roda a função no contexto da página; argumentos vão serializados. */
  const avaliar = async (fn, ...args) => {
    const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const r = await enviar("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    }
    return r.result.value;
  };

  /**
   * Navega e espera. `Page.loadEventFired` não serve para SPA (Maps e Instagram
   * disparam load com a casca vazia), então o padrão é: navega, espera um piso
   * de tempo e depois faz polling por um seletor que só existe com conteúdo.
   */
  const irPara = async (url, { espera = 1500, ate = null, limite = 15000 } = {}) => {
    await enviar("Page.navigate", { url });
    await sleep(espera);
    if (!ate) return true;
    const fim = Date.now() + limite;
    while (Date.now() < fim) {
      try {
        if (await avaliar(ate)) return true;
      } catch { /* documento ainda trocando */ }
      await sleep(400);
    }
    return false;
  };

  const fechar = async () => {
    try { ws.close(); } catch {}
    await fetch(`http://127.0.0.1:${porta}/json/close/${alvo.id}`).catch(() => {});
  };

  return { enviar, avaliar, irPara, fechar };
}

/**
 * Versão do Chrome, para o diagnóstico da tela.
 *
 * `chrome.exe --version` não serve no Windows: quando já existe uma janela
 * aberta, o binário apenas repassa o comando para a instância em execução e
 * imprime "Abrindo em uma sessão de navegador existente". A versão real está no
 * nome da subpasta que o instalador cria ao lado do executável.
 */
export function versaoChrome() {
  const exe = acharChrome();
  if (!exe) return null;

  const pasta = dirname(exe);
  try {
    const versoes = readdirSync(pasta)
      .filter((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n))
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return 0;
      });
    if (versoes[0]) return (exe.includes("msedge") ? "Edge " : "Chrome ") + versoes[0];
  } catch { /* cai no genérico */ }

  return exe.includes("msedge") ? "Edge (instalado)" : "Chrome (instalado)";
}
