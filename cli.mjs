/**
 * Varredura pela linha de comando.
 *
 * Existe para o caso em que a tela atrapalha: rodar três nichos seguidos sem
 * ficar com o navegador aberto, ou agendar uma varredura no Agendador de
 * Tarefas do Windows. Usa exatamente o mesmo motor do app web e grava no mesmo
 * `data/`, então a varredura feita aqui aparece no histórico da tela.
 *
 *   node cli.mjs "clínica odontológica" Uberaba MG 30
 *   node cli.mjs "clínica médica" Uberaba MG 30 --enviar
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { prospectar } from "./src/prospector.mjs";
import { novoId, salvar, paraCSV } from "./src/store.mjs";
import { enviarAoGestor } from "./src/gestor.mjs";

const RAIZ = dirname(fileURLToPath(import.meta.url));

// Mesmo leitor de .env do servidor — o CLI é usado sem passar pelo server.mjs.
const envArq = join(RAIZ, ".env");
if (existsSync(envArq)) {
  for (const linha of readFileSync(envArq, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const sinalizadores = new Set(args.filter((a) => a.startsWith("--")));
const posicionais = args.filter((a) => !a.startsWith("--"));

const [termo, cidade, uf = "", quantidade = "20"] = posicionais;

if (!termo || !cidade) {
  console.error("");
  console.error("  Uso:  node cli.mjs <nicho> <cidade> [UF] [quantidade] [--enviar] [--csv] [--rapida]");
  console.error('  Ex.:  node cli.mjs "clínica odontológica" Uberaba MG 30 --enviar');
  console.error("");
  process.exit(1);
}

const parametros = {
  termo,
  cidade,
  uf: uf.toUpperCase(),
  quantidade: Number(quantidade) || 20,
  profundidade: sinalizadores.has("--rapida") ? "rapida" : "completa",
};

console.log("");
console.log("  " + parametros.termo + " · " + parametros.cidade + " " + parametros.uf +
  " · até " + parametros.quantidade + " leads · profundidade " + parametros.profundidade);
console.log("");

const resultado = await prospectar(parametros, (e) => {
  if (e.tipo === "status") process.stdout.write("\r  " + e.texto.padEnd(78).slice(0, 78));
  if (e.tipo === "lead-pronto") {
    const s = e.lead.score;
    process.stdout.write("\r" + " ".repeat(80) + "\r");
    console.log("  " + s.emoji + " " + String(s.total).padStart(3) + "  " +
      e.lead.nome.slice(0, 44).padEnd(46) + s.rotulo);
  }
});

process.stdout.write("\r" + " ".repeat(80) + "\r");

const id = novoId(parametros);
salvar(id, resultado);

console.log("");
console.log("  " + resultado.total + " leads em " + resultado.duracaoSegundos + "s");
for (const [faixa, n] of Object.entries(resultado.porTemperatura)) {
  console.log("    " + faixa.padEnd(8) + n);
}
console.log("");
console.log("  Salvo em data/" + id + ".json");

if (sinalizadores.has("--csv")) {
  const { writeFileSync } = await import("node:fs");
  const arq = join(RAIZ, "data", id + ".csv");
  writeFileSync(arq, paraCSV(resultado), "utf8");
  console.log("  CSV em  data/" + id + ".csv");
}

if (sinalizadores.has("--enviar")) {
  // Só os que valem a pena: mandar gelado para o funil é entupir o CRM com
  // quem já tem site resolvido.
  const escolhidos = resultado.leads.filter((l) => ["quente", "morno"].includes(l.score.temperatura));

  if (!escolhidos.length) {
    console.log("  Nenhum lead quente ou morno para enviar ao gestor.");
  } else {
    try {
      const r = await enviarAoGestor(escolhidos, parametros, {
        url: process.env.GESTOR_URL || "http://localhost:3000",
        token: process.env.PROSPECTOR_TOKEN || "",
      });
      console.log("  Gestor: " + r.criados + " novos, " + r.duplicados + " atualizados, " + r.ignorados + " ignorados.");
    } catch (e) {
      console.error("  Falha ao enviar ao gestor: " + e.message);
      process.exitCode = 1;
    }
  }
}

console.log("");
