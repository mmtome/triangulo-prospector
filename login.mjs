/**
 * Login no Instagram, uma vez só.
 *
 * Abre um Chrome visível com o perfil persistente do Prospector, na tela de
 * login. Você entra na mão, o Chrome guarda a sessão na pasta do perfil, e
 * todas as varreduras seguintes passam a navegar logadas.
 *
 * POR QUE ISSO IMPORTA
 * ────────────────────
 * Anônimo, o Instagram corta o acesso depois de algumas dezenas de perfis do
 * mesmo IP e redireciona tudo para /accounts/login?is_from_rle. A varredura sai
 * sem @, sem logo e sem paleta — e como o eixo de esforço zera, a cidade
 * inteira vem "gelada". Logado, a cota é muito maior e a grade de posts fica
 * visível, que é a fonte boa de foto para a proposta.
 *
 * USE UMA CONTA DESCARTÁVEL
 * ─────────────────────────
 * O Instagram suspende conta usada para automação. Nunca a conta da Triângulo,
 * nunca a de cliente: crie uma secundária que, se cair, não custa nada. Este
 * aviso está aqui e no README porque é o único erro caro deste arquivo.
 *
 * Uso:  npm run login
 */

import { writeFileSync } from "node:fs";
import { abrirNavegador, novaAba, PERFIL_FIXO, MARCA_SESSAO, temSessao, sleep } from "./src/cdp.mjs";

console.log("");
console.log("  Perfil do Prospector: " + PERFIL_FIXO);
console.log(temSessao() ? "  Já existe sessão salva — entrar de novo apenas substitui." : "  Nenhuma sessão salva ainda.");
console.log("");
console.log("  ⚠  Use uma conta SECUNDÁRIA. O Instagram suspende conta usada para automação.");
console.log("");

const navegador = await abrirNavegador({ headless: false, perfilFixo: true });
const aba = await novaAba(navegador.porta);

await aba.irPara("https://www.instagram.com/accounts/login/", { espera: 3500 });

/* Preenchimento opcional, por variável de ambiente e nunca por arquivo:
 *   IG_USUARIO=... IG_SENHA=... npm run login
 * A senha some quando o processo morre; o que fica no disco é a sessão do
 * Chrome, que é o objetivo. Gravar credencial em .env seria guardar a senha em
 * texto puro numa pasta que também tem token de deploy.
 *
 * Mesmo preenchido, o resto continua na mão: 2FA, "salvar informações?" e o
 * checkpoint de verificação aparecem quando o Instagram quiser, e tentar
 * adivinhar cada um seria mais frágil que deixar você clicar. */
const usuario = process.env.IG_USUARIO;
const senha = process.env.IG_SENHA;

if (usuario && senha) {
  /* Espera o formulário existir antes de tentar preencher. Sem isto o script
     dava "não achei os campos" e seguia: o Instagram monta a tela por JS, e
     3 segundos de espera fixa não bastam em conexão lenta. */
  let temCampos = false;
  for (let i = 0; i < 20 && !temCampos; i++) {
    temCampos = await aba
      .avaliar(() => !!document.querySelector('input[name="username"]'))
      .catch(() => false);
    if (!temCampos) await sleep(1000);
  }

  if (!temCampos) {
    const onde = await aba.avaliar(() => location.pathname).catch(() => "");
    console.log(
      onde.includes("recaptcha")
        ? "  O Instagram serviu um CAPTCHA no lugar do formulário.\n" +
          "  Resolva na janela do Chrome e faça o login lá — não dá para automatizar isso."
        : "  O formulário não apareceu em 20s — faça o login na janela.",
    );
  }

  console.log("  Preenchendo o formulário…");
  const preencheu = await aba.avaliar(
    (u, s) => {
      const campos = [...document.querySelectorAll("input")];
      const alvoUsuario = campos.find((i) => i.name === "username");
      const alvoSenha = campos.find((i) => i.name === "password");
      if (!alvoUsuario || !alvoSenha) return false;

      /* O React do Instagram ignora `value =` direto: ele guarda o valor no
         próprio nó e só reage ao evento. Escrever pelo setter nativo e disparar
         o `input` é o que faz o botão de entrar sair do estado desabilitado. */
      const setar = (el, valor) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(el, valor);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };

      setar(alvoUsuario, u);
      setar(alvoSenha, s);
      return true;
    },
    usuario,
    senha,
  );

  if (preencheu) {
    await sleep(600);
    await aba.avaliar(() => {
      const botao = [...document.querySelectorAll('button[type="submit"]')].find(
        (b) => !b.disabled,
      );
      if (botao) botao.click();
    });
    console.log("  Enviado. Se aparecer código de verificação ou 2FA, resolva na janela.");
  } else {
    console.log("  Não achei os campos — faça o login na janela que abriu.");
  }
} else {
  console.log("  Chrome aberto. Faça o login na janela que abriu.");
}

console.log("  Este terminal fecha sozinho quando o login for detectado.");
console.log("");

/* A confirmação NÃO pode ser "saiu de /accounts/login".
   Foi a primeira versão e deu falso positivo: durante o carregamento a página
   passa por outros caminhos por um instante, o script declarou sucesso, e as
   varreduras seguiram achando que estavam logadas enquanto tomavam bloqueio em
   todo lead. O teste honesto é abrir um perfil de verdade e ver se ele carrega
   sem redirecionar de volta para o login. */
const LIMITE_MS = 10 * 60 * 1000;
const fim = Date.now() + LIMITE_MS;
let logado = false;

while (Date.now() < fim) {
  await sleep(3000);

  const caminho = await aba.avaliar(() => location.pathname).catch(() => null);
  if (!caminho || caminho.startsWith("/accounts/login")) continue;

  // Saiu do login: agora confere de verdade, num perfil qualquer.
  await aba.irPara("https://www.instagram.com/instagram/", { espera: 4000 });
  const conferido = await aba
    .avaliar(() => ({
      caminho: location.pathname,
      grade: document.querySelectorAll("main img, article img").length,
    }))
    .catch(() => null);

  /* Exigir a GRADE, não só "não está no login".
     Sem esta condição o script deu falso positivo duas vezes: o Instagram
     desviou para /auth_platform/recaptcha/ — que não é /accounts/login — e a
     sessão foi dada como salva com zero imagem carregada. Grade vazia é muro
     de login com outro nome. */
  if (conferido && !conferido.caminho.startsWith("/accounts/login") && conferido.grade > 0) {
    logado = true;
    console.log("  Perfil de teste abriu com " + conferido.grade + " imagens na grade.");
    break;
  }

  if (conferido?.caminho.includes("recaptcha")) {
    console.log("  O Instagram pediu captcha. Resolva na janela do Chrome — o script espera.");
  }

  // Ainda no muro: volta para o login e continua esperando você resolver.
  await aba.irPara("https://www.instagram.com/accounts/login/", { espera: 2500 });
}

if (logado) {
  // Um instante para o Chrome gravar cookies e storage no disco do perfil.
  await sleep(4000);
  writeFileSync(
    MARCA_SESSAO,
    JSON.stringify({ verificadaEm: new Date().toISOString(), usuario: usuario ?? null }, null, 2),
    "utf8",
  );
  console.log("  ✓ Sessão verificada e salva. As varreduras já usam este login.");
} else {
  console.log("  Tempo esgotado sem login confirmado. Rode `npm run login` de novo.");
}

await aba.fechar().catch(() => {});
navegador.fechar();
process.exit(logado ? 0 : 1);
