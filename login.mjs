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

import { abrirNavegador, novaAba, PERFIL_FIXO, temSessao, sleep } from "./src/cdp.mjs";

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
  /* Os dois nomes de campo. O formulário servido hoje usa `email`/`pass`, ao
     estilo Facebook; a documentação e metade dos exemplos na internet falam de
     `username`/`password`, que é o que o Instagram usava antes. Procurar só um
     par foi o que fez o preenchimento falhar em silêncio três vezes. */
  let temCampos = false;
  for (let i = 0; i < 20 && !temCampos; i++) {
    temCampos = await aba
      .avaliar(
        () =>
          !!document.querySelector('input[name="username"], input[name="email"]') &&
          !!document.querySelector('input[name="password"], input[name="pass"]'),
      )
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
      const alvoUsuario = campos.find((i) => i.name === "username" || i.name === "email");
      const alvoSenha = campos.find((i) => i.name === "password" || i.name === "pass");
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
      // O envio hoje é um <input type="submit">, não um <button>.
      const enviar = [
        ...document.querySelectorAll('button[type="submit"], input[type="submit"]'),
      ].find((b) => !b.disabled);
      if (enviar) enviar.click();
      else document.querySelector("form")?.requestSubmit?.();
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

/* O laço OBSERVA, não navega enquanto você trabalha.
   A primeira versão voltava para /accounts/login a cada 3 segundos — o que
   apagaria a tela de código de verificação no meio da digitação. Enquanto o
   caminho for de login, 2FA, desafio ou captcha, o script só espera. */
const EM_ANDAMENTO = /^\/(accounts\/login|challenge|auth_platform)|two_factor/;

while (Date.now() < fim) {
  await sleep(3000);

  const caminho = await aba.avaliar(() => location.pathname).catch(() => null);
  if (!caminho || EM_ANDAMENTO.test(caminho)) continue;

  /* A ÚNICA prova que vale: /accounts/edit/ só abre para sessão autenticada.
     Já tentei duas coisas mais frouxas e as duas mentiram. "Não está em
     /accounts/login" mentiu porque o Instagram desvia para
     /auth_platform/recaptcha/ quando desconfia. "A grade de posts renderizou"
     mentiu porque, com o limite de IP liberado, perfil público carrega a grade
     para visitante anônimo também — deu 32 imagens sem nenhum login. */
  await aba.irPara("https://www.instagram.com/accounts/edit/", { espera: 5000 });
  const conferido = await aba.avaliar(() => location.pathname).catch(() => null);

  /* Confere DUAS vezes, com folga entre elas. O redirecionamento de volta ao
     login é feito pelo próprio JS da página e às vezes demora mais que a
     espera da navegação — ler uma vez só flagrou `/accounts/edit/` num
     instante em que a página ainda ia embora, e essa foi a terceira sessão
     falsa dada como boa. */
  if (conferido && conferido.includes("/accounts/edit")) {
    await sleep(5000);
    const denovo = await aba.avaliar(() => location.pathname).catch(() => null);
    if (denovo && denovo.includes("/accounts/edit")) {
      logado = true;
      break;
    }
  }

  // Não logado ainda: volta para a home, NUNCA para a tela de login — voltar
  // para lá reiniciaria um 2FA que você pode estar no meio de resolver.
  await aba.irPara("https://www.instagram.com/", { espera: 2500 });
}

/* Este script NÃO grava a marca de sessão, de propósito.
   Ele já deu três falsos positivos, cada um por um motivo diferente, e o padrão
   era sempre o mesmo: duas checagens de login vivendo em arquivos diferentes,
   com a daqui mais frouxa. Agora quem carimba é só o `conferir-sessao`, que é o
   verificador independente — se as duas discordarem, vale a de fora. */
if (logado) {
  await sleep(4000);
  console.log("  Login aparentemente concluído.");
} else {
  console.log("  Tempo esgotado sem login confirmado.");
}
console.log("  Rode `npm run conferir-sessao` para carimbar a sessão.");

await aba.fechar().catch(() => {});
navegador.fechar();
process.exit(logado ? 0 : 1);
