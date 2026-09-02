/**
 * Importa a sessão do Instagram do seu Chrome para o perfil do Prospector.
 *
 * POR QUE COPIAR EM VEZ DE USAR O SEU PERFIL DIRETO
 * ────────────────────────────────────────────────
 * O Chrome recusa a porta de depuração quando já existe uma instância com
 * aquele perfil aberta. Usar o seu perfil de verdade obrigaria a fechar o
 * Chrome inteiro a cada varredura — e ainda entregaria ao scraper todas as
 * suas sessões: e-mail, banco, Vercel, tudo.
 *
 * Copiar os cookies uma vez resolve os dois: o Prospector passa a ter a sessão
 * do Instagram no perfil dele, você volta a usar o Chrome normalmente, e nada
 * além do Instagram é compartilhado.
 *
 * PRECISA DO CHROME FECHADO
 * ─────────────────────────
 * O banco de cookies fica travado enquanto o Chrome roda — a cópia falha com
 * EBUSY. É a única exigência, e é só nesta importação.
 *
 * Uso:  npm run importar-sessao
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PERFIL_FIXO } from "./src/cdp.mjs";

const USER_DATA = join(
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
  "Google",
  "Chrome",
  "User Data",
);

if (!existsSync(USER_DATA)) {
  console.error("Não achei o Chrome em " + USER_DATA);
  process.exit(1);
}

/** Nome legível de cada perfil, do índice do próprio Chrome. */
function perfis() {
  try {
    const ls = JSON.parse(readFileSync(join(USER_DATA, "Local State"), "utf8"));
    const info = ls.profile?.info_cache || {};
    return Object.entries(info).map(([dir, v]) => ({
      dir,
      conta: v.user_name || v.gaia_name || v.name || dir,
    }));
  } catch {
    return [{ dir: "Default", conta: "Default" }];
  }
}

/**
 * Um perfil só interessa se tiver `sessionid` — é o cookie que autentica. Ter
 * cookie de instagram.com não basta: visitar o site deslogado já cria vários.
 */
function temSessaoInstagram(dirPerfil, tmp) {
  const orig = join(USER_DATA, dirPerfil, "Network", "Cookies");
  if (!existsSync(orig)) return null;

  const copia = join(tmp, dirPerfil.replace(/\s+/g, "_") + ".db");
  try {
    copyFileSync(orig, copia);
  } catch (e) {
    if (String(e.code) === "EBUSY") throw new Error("CHROME_ABERTO");
    return null;
  }

  try {
    const db = new DatabaseSync(copia, { readOnly: true });
    const linhas = db
      .prepare("SELECT name FROM cookies WHERE host_key LIKE '%instagram.com'")
      .all();
    db.close();
    const nomes = new Set(linhas.map((l) => l.name));
    return { total: linhas.length, autenticado: nomes.has("sessionid") && nomes.has("ds_user_id") };
  } catch {
    return null;
  }
}

const tmp = mkdtempSync(join(tmpdir(), "prospector-sessao-"));

console.log("");
console.log("  Procurando sessão do Instagram nos perfis do Chrome…");
console.log("");

const encontrados = [];
try {
  for (const p of perfis()) {
    const r = temSessaoInstagram(p.dir, tmp);
    if (!r) continue;
    console.log(
      "  " + p.dir.padEnd(12) + p.conta.padEnd(38) +
        r.total + " cookies · " + (r.autenticado ? "LOGADO" : "deslogado"),
    );
    if (r.autenticado) encontrados.push(p);
  }
} catch (e) {
  if (e.message === "CHROME_ABERTO") {
    console.error("");
    console.error("  O Chrome está aberto e o banco de cookies fica travado.");
    console.error("  Feche o Chrome por completo (inclusive o ícone ao lado do relógio) e rode de novo.");
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  throw e;
}

if (!encontrados.length) {
  console.error("");
  console.error("  Nenhum perfil do Chrome está logado no Instagram.");
  console.error("  Abra o Chrome, entre no instagram.com com a conta que quiser usar,");
  console.error("  feche o Chrome e rode este comando de novo.");
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

/* Mais de um perfil logado: escolhe pelo argumento, senão o primeiro. Escolher
   sozinho entre contas seria arriscar prospectar com a conta de um cliente. */
const pedido = process.argv[2];
const escolhido = pedido
  ? encontrados.find((p) => p.dir === pedido || p.conta.includes(pedido))
  : encontrados[0];

if (!escolhido) {
  console.error("\n  Perfil '" + pedido + "' não está entre os logados.");
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

console.log("");
console.log("  Importando de: " + escolhido.dir + " (" + escolhido.conta + ")");

/* O que precisa ir junto:
   - Local State  → guarda a chave que decifra os cookies. Sem ele o Chrome do
     Prospector lê o arquivo e não entende nada, e a sessão não vale.
   - Network/Cookies → a sessão em si.
   - Local Storage → o Instagram guarda parte do estado de login aqui também.
   O resto do perfil (histórico, senhas, extensões) fica de fora de propósito. */
const destinoPerfil = join(PERFIL_FIXO, "Default");
mkdirSync(join(destinoPerfil, "Network"), { recursive: true });

const copias = [
  [join(USER_DATA, "Local State"), join(PERFIL_FIXO, "Local State")],
  [join(USER_DATA, escolhido.dir, "Network", "Cookies"), join(destinoPerfil, "Network", "Cookies")],
];

for (const [de, para] of copias) {
  try {
    copyFileSync(de, para);
    console.log("  ✓ " + de.replace(USER_DATA, "…"));
  } catch (e) {
    console.error("  ✗ " + de + " — " + e.message);
    if (String(e.code) === "EBUSY") {
      console.error("\n  Feche o Chrome por completo e rode de novo.");
      rmSync(tmp, { recursive: true, force: true });
      process.exit(1);
    }
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log("  Sessão copiada. Agora rode `npm run conferir-sessao` para validar");
console.log("  antes de prospectar — cookie copiado não é sessão confirmada.");
console.log("");
