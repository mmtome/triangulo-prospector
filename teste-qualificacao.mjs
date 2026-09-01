import { descartePrecoce, descarteFinal } from "./src/qualificacao.mjs";

let ok = 0, falhou = 0;
const t = (nome, real, esperado) => {
  const passou = real === esperado;
  console.log((passou ? "  ok   " : "  FALHA") + "  " + nome +
    (passou ? "" : "   (esperado " + esperado + ", veio " + real + ")"));
  passou ? ok++ : falhou++;
};
const m = (d) => (d ? d.motivo : "fica");
const alta = { nivel: "alta" }, parcial = { nivel: "parcial" };
const base = { gmn: { fechado: false, avaliacoes: 2 }, site: { nivel: "inexistente" }, buscaBloqueada: false };

console.log("── descarte precoce (sem gastar busca nem Instagram) ──");
t("site ok → descarta", m(descartePrecoce({ site: { nivel: "ok", url: "https://x.com" } })), "temSite");
t("fechado → descarta", m(descartePrecoce({ fechado: true, site: { nivel: "inexistente" } })), "fechado");
for (const n of ["inexistente", "fraco", "construtor", "agregador", "rede", "quebrado"])
  t("site " + n + " → fica", m(descartePrecoce({ site: { nivel: n } })), "fica");

console.log("\n── unica prova aceita: perfil lido ──");
t("perfil lido e parado → descarta",
  m(descarteFinal({ ...base, instagram: { existe: true, posts: 6, seguidores: 90 },
    score: { esforco: 21, confianca: alta } }, {})), "semPresenca");
t("perfil lido e ativo → fica",
  m(descarteFinal({ ...base, instagram: { existe: true, posts: 300, seguidores: 5000 },
    score: { esforco: 74, confianca: alta } }, {})), "fica");

console.log("\n── INVARIANTE: incerteza nunca descarta ──");
t("sem perfil achado → fica (nao ha prova de ausencia)",
  m(descarteFinal({ ...base, instagram: null, score: { esforco: 0, confianca: alta } }, {})), "fica");
t("nota parcial → fica mesmo com esforco no chao",
  m(descarteFinal({ ...base, instagram: { existe: true, posts: 3, seguidores: 50 },
    score: { esforco: 18, confianca: parcial } }, {})), "fica");
t("clinica 678 avaliacoes, @ nao achado → fica",
  m(descarteFinal({ ...base, gmn: { fechado: false, avaliacoes: 678 }, instagram: null,
    score: { esforco: 19, confianca: parcial } }, {})), "fica");
t("Bing desligado na varredura → fica",
  m(descarteFinal({ ...base, instagram: null, score: { esforco: 0, confianca: alta } },
    { buscaDesligada: true })), "fica");
t("Bing bloqueou neste lead → fica",
  m(descarteFinal({ ...base, instagram: null, buscaBloqueada: true,
    score: { esforco: 0, confianca: alta } }, {})), "fica");
t("Instagram limitou o IP → fica",
  m(descarteFinal({ ...base, instagram: null, score: { esforco: 0, confianca: alta } },
    { instagramBloqueado: true })), "fica");
t("perfil pediu login → fica",
  m(descarteFinal({ ...base, instagram: { bloqueado: true },
    score: { esforco: 0, confianca: alta } }, {})), "fica");

console.log("\n── site descoberto pela bio (etapa 8 do prospector) ──");
t("bio revelou site ok → descarta no final",
  m(descarteFinal({ ...base, site: { nivel: "ok", url: "https://y.com" },
    instagram: { existe: true, posts: 400 }, score: { esforco: 80, confianca: alta } }, {})), "temSite");

console.log("\n" + ok + " passaram, " + falhou + " falharam");
process.exit(falhou ? 1 : 0);
