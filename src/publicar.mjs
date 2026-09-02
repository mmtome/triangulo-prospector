/**
 * Publica a proposta na Vercel e devolve um link compartilhável.
 *
 * UM PROJETO, MUITOS DEPLOYMENTS
 * ─────────────────────────────
 * Todas as propostas vão para o MESMO projeto (`PROPOSTAS_PROJECT_ID`), cada
 * uma como um deployment próprio. Cada deployment ganha uma URL única e
 * permanente — que é o link que se manda para o cliente.
 *
 * Um projeto por lead seria a outra saída, e é pior: estoura o limite de
 * projetos da conta, enche o painel de lixo e obriga a apagar projeto a projeto
 * quando a proposta não vinga.
 *
 * POR QUE `--prod`, SE CADA PROPOSTA É UMA SÓ
 * ───────────────────────────────────────────
 * Por proteção de acesso, não por promoção. Deployment de preview nesta conta
 * responde **302 para uma tela de login da Vercel** — inútil como link para
 * mandar a cliente. Produção é público, e é a única diferença que importa aqui.
 *
 * O que se manda é a URL imutável do deployment
 * (`triangulo-propostas-<hash>-…`), nunca o alias `triangulo-propostas.
 * vercel.app`: o alias aponta sempre para a última proposta publicada, então
 * serve para conferir o que acabou de subir e para mais nada.
 *
 * A proteção do projeto foi desligada uma vez (`ssoProtection: null` na API).
 * Se um dia as propostas voltarem a pedir login, é ela que religou.
 *
 * NADA DE `.vercel/project.json` NEM `vercel.json` NA PASTA
 * ────────────────────────────────────────────────────────
 * Foi a primeira tentativa e a CLI respondia `EPERM, Permission denied` na
 * própria pasta de envio — sem explicar qual arquivo. As duas variáveis de
 * ambiente abaixo já dizem para onde mandar, e a pasta vai limpa.
 *
 * O QUE SOBE
 * ──────────
 * O `dist/` do modelo mais o `marca.json` e as imagens do cliente, na mesma
 * pasta. É o mesmo arranjo do servidor local — o site procura `./marca.json`
 * ao lado do `index.html` e se adapta.
 */

import { cpSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acharModelo } from "./modelos.mjs";
import { PASTA_CLONES } from "./clonagem.mjs";

const exec = promisify(execFile);

/** Publicar sobe imagens e roda um build remoto; 4 min é folga confortável. */
const TIMEOUT_MS = 4 * 60 * 1000;

export function configurada() {
  return !!(process.env.PROPOSTAS_PROJECT_ID && process.env.VERCEL_ORG_ID);
}

/**
 * Monta a pasta e sobe. Devolve `{ url }` ou lança com uma mensagem que diz o
 * que fazer — publicar falha por motivo mundano (não está logado, rede caiu) e
 * "erro ao publicar" sozinho não ajuda ninguém.
 */
export async function publicar(slug) {
  if (!configurada()) {
    throw new Error(
      "Publicação não configurada. Defina PROPOSTAS_PROJECT_ID e VERCEL_ORG_ID no .env " +
        "do Prospector — o README explica como criar o projeto uma vez.",
    );
  }

  const pastaClone = join(PASTA_CLONES, slug);
  if (!existsSync(join(pastaClone, "marca.json"))) {
    throw new Error("A proposta '" + slug + "' não existe. Clone o lead primeiro.");
  }

  const marca = JSON.parse(readFileSync(join(pastaClone, "marca.json"), "utf8"));
  const modelo = acharModelo(marca.modelo);
  if (!modelo) throw new Error("O modelo '" + marca.modelo + "' não está mais disponível.");

  /* Pasta de envio na home, e não dentro do projeto: este projeto mora em
     "…/Gestão MKT/", e a CLI da Vercel devolve um EPERM incompreensível quando
     o diretório de trabalho tem caractere não-ASCII no caminho — o erro mostra
     "Gest?o MKT" com o "ã" corrompido. Apagada no fim, sempre. */
  const envio = join(homedir(), ".triangulo-propostas", slug + "-" + Date.now());
  mkdirSync(envio, { recursive: true });

  try {
    cpSync(modelo.dist, envio, { recursive: true });
    cpSync(pastaClone, envio, { recursive: true }); // marca.json e imagens por cima

    /* `shell: true` no Windows não é preferência: `npx` lá é um .cmd, e o Node
       recusa spawn de .cmd sem shell desde a correção de CVE-2024-27980 — o
       erro que aparece é um `spawn EINVAL` que não explica nada. */
    const { stdout } = await exec(
      "npx",
      ["--yes", "vercel", "deploy", "--yes", "--prod"],
      {
        cwd: envio,
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === "win32",
        /* O par VERCEL_ORG_ID + VERCEL_PROJECT_ID é o jeito documentado de
           mandar um deployment para um projeto específico sem pasta vinculada.
           E precisa ser o PAR: o .env do Prospector já exporta o ORG_ID, e a
           CLI recusa o envio se enxergar um sem o outro. */
        env: {
          ...process.env,
          VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
          VERCEL_PROJECT_ID: process.env.PROPOSTAS_PROJECT_ID,
        },
      },
    );

    // A CLI imprime a URL do deployment na última linha útil da saída.
    const url = (stdout.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();
    if (!url) throw new Error("A Vercel não devolveu uma URL. Saída: " + stdout.slice(-300));

    return { url };
  } catch (e) {
    const saida = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n");

    if (/credentials|not authenticated|log in/i.test(saida)) {
      throw new Error("A Vercel recusou: rode `npx vercel login` uma vez nesta máquina.");
    }
    if (/ETIMEDOUT|timeout/i.test(saida)) {
      throw new Error("A publicação passou de 4 minutos e foi cancelada. Tente de novo.");
    }
    throw new Error(saida.split("\n").filter(Boolean).slice(-3).join(" · ").slice(0, 400));
  } finally {
    /* A limpeza NUNCA pode derrubar a publicação. No Windows a CLI da Vercel
       ainda segura handles da pasta quando o processo volta, e o `rmSync`
       levanta um EPERM que, vindo do `finally`, sobrepõe o retorno de sucesso:
       o deployment ia para o ar e a tela dizia que tinha falhado. Uma pasta
       esquecida na home custa alguns MB; um link perdido custa o lead. */
    try {
      rmSync(envio, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch { /* fica para a próxima */ }
  }
}
