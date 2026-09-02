/**
 * Confere se o Prospector está mesmo logado no Instagram — e só então marca.
 *
 * Existe porque a checagem ingênua deu falso positivo duas vezes: "não está em
 * /accounts/login" parecia prova de login, mas o Instagram desvia para
 * /auth_platform/recaptcha/ quando desconfia, e o script dava a sessão como
 * boa. As varreduras seguintes rodavam achando que estavam logadas e voltavam
 * sem @, sem logo e sem foto.
 *
 * A prova aqui é a grade de posts: ela só renderiza para sessão válida. Zero
 * imagem é muro de login com outro nome.
 *
 * Uso:  npm run conferir-sessao
 */

import { writeFileSync, rmSync, existsSync } from "node:fs";
import { abrirNavegador, novaAba, MARCA_SESSAO } from "./src/cdp.mjs";

// /accounts/edit/ e a unica prova: so abre para sessao autenticada. Perfil
// publico carrega a grade para visitante anonimo tambem, e foi o que gerou dois
// falsos positivos antes.
const PROVA = "https://www.instagram.com/accounts/edit/";

const navegador = await abrirNavegador({ headless: true, perfilFixo: true });
const aba = await novaAba(navegador.porta);

let resultado = null;
try {
  await aba.irPara(PROVA, { espera: 6000 });
  resultado = await aba.avaliar(() => ({
    caminho: location.pathname,
    grade: document.querySelectorAll("main img, article img").length,
  }));
} catch (e) {
  console.error("  Falhou ao abrir o Instagram: " + e.message);
} finally {
  await aba.fechar().catch(() => {});
  navegador.fechar();
}

console.log("");
if (!resultado) {
  console.log("  Sem resposta do Instagram.");
} else {
  console.log("  caminho: " + resultado.caminho);
  console.log("  imagens na grade: " + resultado.grade);
}

const logado =
  !!resultado &&
  !resultado.caminho.startsWith("/accounts/login") &&
  !resultado.caminho.includes("recaptcha") &&
  resultado.caminho.includes("/accounts/edit");

if (logado) {
  writeFileSync(MARCA_SESSAO, JSON.stringify({ verificadaEm: new Date().toISOString() }, null, 2), "utf8");
  console.log("");
  console.log("  ✓ Logado. As varreduras vão usar esta sessão.");
} else {
  // Some com a marca: melhor o app se saber anônimo do que mentir para si.
  if (existsSync(MARCA_SESSAO)) rmSync(MARCA_SESSAO, { force: true });
  console.log("");
  console.log("  ✗ Não está logado.");
  console.log("    Abra o Chrome, entre no instagram.com, FECHE o Chrome por completo,");
  console.log("    e rode `npm run importar-sessao` seguido de `npm run conferir-sessao`.");
}

console.log("");
process.exit(logado ? 0 : 1);
