# Prospector · Triângulo Solutions

Software web que varre o **Google Meu Negócio** e o **Instagram** atrás de
clientes para a agência, e classifica cada um por **temperatura de venda**.

Você preenche nicho, cidade e quantos leads quer. Ele devolve os leads ordenados, com o
contato, o diagnóstico do que falta em cada um e o motivo da nota — e manda os
escolhidos direto para o funil do CRM no gestor.

```bash
cp .env.example .env     # opcional: só para enviar ao gestor
npm start                # http://localhost:4546
```

**Não tem dependências.** Nenhum `npm install`, nenhum `node_modules`. Só Node
22+ e o Google Chrome instalado — o que importa porque o projeto mora no Google
Drive, onde `npm install` escreve dezenas de milhares de arquivos que o Drive
tenta sincronizar um a um.

---

## "Quantos leads entregar" entrega leads, não avaliações

O campo é o alvo de leads **aptos**. Pedir 20 devolve 20 — ele continua puxando
do mapa e avaliando até fechar a cota, porque cerca de metade da fila cai no
descarte e avaliar exatamente 20 devolvia 10.

Isso tem um teto: **3x o alvo**. Num nicho onde quase todo mundo já tem site não
existem 20 leads para achar, e sem limite a varredura desceria o mapa inteiro
tomando bloqueio. Quando o teto é atingido — ou quando o mapa acaba antes — a
tela diz qual dos dois aconteceu, porque as duas causas pedem ações opostas:
teto batido é nicho saturado (troque o nicho), mapa esgotado é cidade pequena
para esse nicho (troque a cidade).

A conta do alvo é refeita a cada lead com o **descarte final**, não com o
precoce. É o único jeito de a cota valer: o descarte final depende de saber se o
Bing caiu e se o Instagram limitou o IP, e essa informação só existe com o laço
já andado.

---

## Quem nem entra na lista

O app procura **lead de site**. Quem já tem site funcionando, ou está fechado,
ou comprovadamente não investe em digital, é **descartado antes de receber
temperatura** — nota serve para comparar candidatos, e ele não é candidato.
Classificar tudo e deixar o usuário filtrar esconde as 9 boas no meio de 31 que
nunca deveriam ter aparecido.

| Descarte | Quando |
|---|---|
| **Já tem site** | a auditoria classificou o site como `ok` — funcionando, próprio |
| **Fechado** | o Google marca como permanentemente fechado |
| **Sem presença digital** | o perfil **foi lido** e está parado (esforço < 25) |

`fraco`, `construtor`, `agregador`, `rede` e `quebrado` **continuam sendo lead** —
em vários casos lead melhor que "sem site", porque o dono já provou que se
importa e ainda assim está mal servido.

### O nicho buscado nunca identifica o negócio

A lista de palavras genéricas nasceu no nicho de odontologia. Rodando **pet
shop** ela deixava "pet" e "shop" contarem como prova de identidade: "Pet Shop
Casa do Bicho" casava 50% com `@rwpetshop` só por essas duas palavras — e mais
dez negócios diferentes junto. Onze leads com o mesmo perfil, os mesmos
seguidores e a mesma nota. Numa varredura de Uberlândia foram catorze.

Hoje as palavras do **termo buscado** e da **cidade** entram na lista de
genéricas da varredura, junto da forma grudada ("petshop"), porque metade dos
donos escreve sem espaço. Quem identifica é o que sobra depois de tirar as três.

Duas salvaguardas em volta:

- **Nome inteiro dentro do @ vale 1.** "Meu Pet Shop" é genérico de ponta a
  ponta e a limpeza o reduzia a "meu", perdendo o `@meupetshop.ura`, que é o
  perfil certo. Descartar um casamento bom também é errar.
- **Um @ por negócio na varredura.** Um perfil pertence a um negócio só; se o
  mesmo @ ganha duas vezes, uma está errada por definição. O segundo negócio
  fica com o próximo candidato acima do corte, não com nada.

`node teste-semelhanca.mjs` roda a regra contra as varreduras salvas em `data/`
e falha se algum @ aparecer em dois negócios.

---

### A regra que sustenta o filtro: incerteza nunca descarta

Todo descarte exige **prova positiva**. Não existe descarte por dado ausente, e
isso não é escrúpulo teórico — é o que os dados salvos em `data/` mostraram.

Uma primeira versão da regra também cortava quem ficou sem @ com a busca
aparentemente saudável. Rodada sobre a varredura de 25 clínicas, ela cortava 9
— todas sem @ localizado e todas com **74 a 678 avaliações no Google**, entre
elas o Primer Odontocenter, que este README já cita como o caso em que a busca
falhou e o negócio tem dois perfis. Eram os leads mais quentes da lista.

Por isso, hoje:

- a nota **parcial** é veto absoluto: se a própria pontuação diz que faltou
  dado, o lead fica;
- Bing desligado, Instagram limitado por IP ou muro de login em qualquer lead
  **suspendem** o descarte por falta de presença na varredura inteira;
- "não achei o perfil" nunca vira "não tem perfil".

O custo dos dois erros é assimétrico: manter um lead frio custa uma linha na
tela; descartar um lead quente custa o cliente.

### O corte acontece antes do caro

"Já tem site" é decidido logo depois da auditoria do site, **antes** de gastar
consulta no Bing e leitura no Instagram. Nas varreduras salvas isso tira cerca
de metade da fila — 25 → 12, 20 → 10, 20 → 7 — e cada lead cortado devolve ~12
a 25 s e uma consulta ao orçamento que o Bing racionaliza.

"Sem presença digital" é decidido **no fim**, quando já se sabe se o Bing caiu e
se o Instagram limitou o IP. Julgar isso dentro do laço seria julgar sem a
informação que decide se o julgamento vale.

### Na tela

Os descartados não entram na lista, mas aparecem como contagem com o motivo, e
a lista abre em um clique. Sumir com eles de vez tornaria impossível distinguir
"nicho saturado de sites" de "a coleta quebrou" — e as duas devolvem uma tela
quase vazia.

---

## O que ele considera um lead quente

O critério é o do briefing: **quem investe tempo em rede social e mesmo assim
não tem site**. Posta, grava vídeo, mantém o perfil vivo — e quando o cliente
quer saber mais, só existe um WhatsApp.

Isso são duas coisas diferentes, então a nota tem **dois eixos** em vez de um
número só:

| Eixo | O que mede | De onde vem |
|---|---|---|
| **Esforço** | o quanto o negócio já investe em presença digital | nº de posts, seguidores, conta comercial, avaliações no Google |
| **Carência** | o que falta de site e de GMN para esse esforço virar cliente | ausência/qualidade do site, tipo do link na bio, campos vazios no GMN |

A nota final é a **média geométrica** dos dois: `√(esforço × carência)`.

Não é firula matemática — é a regra do briefing escrita como fórmula. A
geométrica só fica alta quando as **duas** ficam, e vai a zero se qualquer uma
zerar. A média aritmética daria 50 para quem tem esforço 100 e carência 0, ou
seja, colocaria a clínica com site impecável no mesmo patamar do lead ideal.

| Faixa | Nota | O que significa |
|---|---|---|
| 🔥 **Quente** | ≥ 70 | posta muito, não tem site. A conversa mais fácil da lista. |
| 🟠 **Morno** | 50–69 | tem presença e alguma lacuna real. Segunda leva. |
| 🔵 **Frio** | 30–49 | pouco esforço, ou site já resolvido. |
| ⚪ **Gelado** | < 30 | ou não investe em digital, ou já tem tudo. Não é lead de site. |

> **Por que clínica parada e sem site não é lead quente.** Ela tem carência
> máxima e esforço zero. Quem não gasta uma hora por semana no Instagram
> também não vai gastar em site — o lead bom é quem **já** investe e está
> perdendo a conversão por não ter para onde mandar a audiência.

### O sinal que mais pesa: o link da bio

É o que separa o quente do morno, e o app classifica em cinco estados:

| Estado | Leitura |
|---|---|
| **nenhum** | a audiência não tem para onde ir — o mais quente |
| **whatsapp** | vai direto para o zap, sem site no meio |
| **agregador** | Linktree, Beacons, bio.link — página de links, não site |
| **rede** | aponta para outra rede social |
| **site** | tem site de verdade; esfria o lead |

Encurtador (`bit.ly`, `cutt.ly`) é **resolvido antes de classificar**: metade
das bios de clínica usa um `bit.ly` que termina no WhatsApp, e classificar pelo
domínio do encurtador marcaria isso como "tem site".

### "Tem site" é resposta pobre

O que decide a abordagem é *que tipo* de site. A auditoria classifica em sete
níveis — `inexistente`, `agregador`, `rede`, `construtor`, `quebrado`, `fraco`,
`ok` — porque uma página de Canva, um perfil de Facebook e um domínio que não
responde mais são, na prática, ausência de site. Às vezes uma dor maior, porque
o dono acha que resolveu.

---

## Como ele coleta

Um Chrome de verdade, dirigido pelo DevTools Protocol. Em série, uma aba só.

```
Google Maps ─► ficha do GMN ─► auditoria do site ─┬─► Instagram ─► pontuação
                                                  │
                            @ vem, nesta ordem, de:
                            1. campo "site" do GMN (quando é o insta)
                            2. link no próprio site do negócio
                            3. busca no Bing (com filtro de semelhança)
```

**Por que um navegador de verdade e não `fetch`.** O Instagram devolve a casca
sem `og:description` para quem não é navegador; o Maps carrega os resultados por
JavaScript. Num Chrome os dois renderizam.

**Por que Bing e não Google.** O Google devolve captcha para navegador
automatizado já na primeira consulta. O DuckDuckGo bloqueia na segunda. O Bing
aguenta muito mais. Ainda assim, o buscador é o **último** recurso — as duas
primeiras origens do @ não gastam consulta e não erram de negócio.

### O orçamento de consultas

Numa varredura de 25 leads, o Bing começou a devolver *"Resolva o desafio
abaixo para continuar"* no meio do caminho. O sintoma era traiçoeiro: a página
volta com 122 caracteres, a busca não acha nada, e o lead sai **"sem
Instagram"** como se o negócio não tivesse perfil. Onze dos 25 caíram assim — e
eram justamente os de maior carência, ou seja, os candidatos a lead quente. O
Primer Odontocenter, marcado como sem perfil, tem dois.

Três defesas, nesta ordem:

1. **Pool coletivo.** Uma consulta por *varredura* (não por lead) do tipo
   `site:instagram.com <nicho> <cidade>` colhe dezenas de perfis locais de uma
   vez. Quem casa com o pool não gasta consulta nenhuma. Todo perfil visto em
   qualquer consulta também entra no pool — o que apareceu buscando a clínica A
   pode ser o da clínica B, dez leads adiante.
2. **Reconhecer o desafio** pelo texto *e pelo tamanho* — uma página de
   resultados do Bing nunca tem menos de mil caracteres, então resposta curta é
   bloqueio disfarçado, não busca sem resultado. Aí recua de verdade: 25 s de
   pausa e uma repetição.
3. **Desligar o buscador no segundo desafio.** Insistir só rende mais desafio.
   O resto da varredura sai com nota parcial e o card diz o porquê — honesto, e
   economiza 12 s por lead restante.

**Por que em série e devagar.** Paralelizar é o caminho mais curto para tomar
bloqueio. O gargalo é a rede, não a CPU, e um bloqueio custa mais caro que a
espera. Conte cerca de **25 a 40 segundos por lead** na profundidade completa.

### O filtro de semelhança

Buscar "Clínica Sorriso Uberaba instagram" traz o perfil do shopping vizinho
com a mesma facilidade que o da clínica. Todo @ vindo de busca — e todo @ que
aparece no rodapé de um site — passa por uma comparação com o nome do negócio,
ignorando acento e as palavras que toda clínica tem no nome (`clínica`,
`odontologia`, `dr`, `centro`…). Abaixo do corte, o lead sai **sem** @.

Isso é deliberado: melhor um lead sem Instagram do que um lead com o Instagram
do vizinho. No teste, foi o que impediu a agência que fez o site de um lead de
ser cadastrada como se fosse ele.

### Nota parcial

Quando o @ não foi encontrado, a nota sai marcada como **parcial** e o card
avisa. Um lead sem Instagram encontrado pontua igual a um lead que
comprovadamente não tem Instagram, e são coisas opostas — o primeiro pode ser o
mais quente da lista, com um @ que a busca não achou.

---

## Enviando ao gestor

O botão **Enviar ao gestor** manda os selecionados para o funil do CRM, na
primeira coluna, **os mais quentes no topo**. Cada card chega com o dossiê
inteiro nas anotações: a nota, os dois eixos, os sinais que a produziram, o
diagnóstico do site, os números do Instagram e a bio.

Para funcionar, três coisas:

1. O gestor precisa estar rodando (`npm run dev` na pasta `../gestor`) **com o
   banco provisionado** — hoje ele ainda não tem `.env`; ver *O que falta* no
   README de lá.
2. `GESTOR_URL` no `.env` daqui apontando para ele.
3. `PROSPECTOR_TOKEN` **com o mesmo valor** nos dois `.env`.

Sem o token a rota de ingestão recusa tudo — ela nunca fica aberta por omissão.

O prospector **não escreve no banco do gestor**. Ele fala com
`POST /api/prospector/leads` e deixa o gestor ser dono das próprias regras:
normalização de @ e telefone, rank do kanban, estágio de entrada, deduplicação.
Duas aplicações gravando na mesma tabela com cópias dessas regras é como o funil
começa a divergir de si mesmo.

**A deduplicação não sobrescreve trabalho humano.** Lead que já existe (mesmo @,
mesmo telefone, ou mesmo nome + cidade) só tem os campos **vazios**
preenchidos, e a nova varredura é anexada às anotações com a data. O card pode
ter sido editado à mão desde a última coleta, e a coleta automática não tem
autoridade para desfazer isso.

Quem não quiser passar pelo gestor tem **Baixar CSV** — separado por ponto e
vírgula e com BOM, que é o que o Excel em pt-BR abre sem pedir importação.

---

## Por que ele não vai para a Vercel

O gestor está hospedado na Vercel; este app **não**, e não é por falta de
tentar. Ele não é um site — é um robô que dirige um Chrome de verdade, e cada
uma das quatro peças que o fazem funcionar é incompatível com serverless:

| O que faz | Onde | Por que não cabe |
|---|---|---|
| `spawn` de um Chrome instalado | [`src/cdp.mjs`](src/cdp.mjs) | não existe Chrome no runtime |
| varredura de **minutos**, fora da requisição | [`server.mjs`](server.mjs) | a função é cortada em 60 s (plano Hobby) |
| execução em memória + SSE (`const execucoes = new Map()`) | [`server.mjs`](server.mjs) | cada invocação é um processo novo; a memória não sobrevive |
| `writeFileSync` das varreduras em `data/` | [`src/store.mjs`](src/store.mjs) | disco somente leitura |

E o motivo que sobrevive a qualquer reescrita: **o Google Maps e o Instagram
bloqueiam IP de datacenter.** Este README já documenta o Instagram limitando por
IP a partir de uma conexão residencial — de um IP da Vercel, compartilhado com
todo mundo, a varredura volta vazia. Trocar o Chrome por `@sparticuz/chromium` e
mover o estado para o Postgres resolveria os quatro itens da tabela e não
resolveria esse.

**O arranjo que vale:** a coleta roda aqui, no seu IP residencial, e o resultado
vai para o funil do gestor em produção — que é onde a equipe olha, de qualquer
lugar. É para isso que serve o `GESTOR_URL` apontando para
`https://triangulo-gestor.vercel.app`.

Se um dia precisar dele no ar 24h, o caminho é um VPS de ~US$6/mês com processo
persistente e Chrome instalado, não serverless.

---

## Estrutura

```
prospector/
├── server.mjs              HTTP + SSE, sem framework
├── src/
│   ├── cdp.mjs             driver do Chrome pelo DevTools Protocol
│   ├── prospector.mjs      orquestra as fontes num lead pontuado
│   ├── score.mjs           os dois eixos e a temperatura
│   ├── store.mjs           um JSON por varredura, em data/
│   ├── gestor.mjs          envio ao CRM
│   └── sources/
│       ├── gmn.mjs         Google Maps: busca no feed + ficha do lugar
│       ├── instagram.mjs   perfil público: seguidores, posts, bio, link
│       ├── busca.mjs       descoberta do @ + filtro de semelhança
│       └── site.mjs        auditoria e classificação do site
├── public/                 a tela (HTML + CSS + JS, sem build)
└── data/                   varreduras salvas
```

A varredura **não** acontece dentro da requisição HTTP: `POST /api/prospeccao`
devolve um id na hora e a coleta segue em memória, com o navegador acompanhando
por SSE. Recarregar a página não mata a coleta, e dá para fechar a aba e voltar.

Uma varredura por vez, de propósito: duas em paralelo dobram o número de abas
contra o Maps e o Bing.

---

## Limites conhecidos

**Não dá para ler a data do último post.** A grade de posts do Instagram fica
atrás do login. "Investe tempo" é estimado pelo *volume* de posts, não pela
frequência recente — um perfil com 400 posts que parou há dois anos pontua como
ativo. Quando o lead for abordado, o @ está no card: dois segundos de olho
resolvem.

**O Bing desafia varreduras longas.** Ver *O orçamento de consultas*. O app
recua, e no terceiro desafio seguido para de buscar — os leads restantes saem
com nota parcial em vez de nota errada. Se isso acontecer no meio de uma lista
grande, rode o restante mais tarde: o histórico dedupe pelo `place_id`, então
nada é prospectado duas vezes.

**O Instagram também limita por IP, e esse é o pior caso.** Passado o volume,
ele para de servir perfis públicos e redireciona tudo para
`/accounts/login/?…&is_from_rle` — *rle* de *rate limit exceeded*. Existente ou
não, todo perfil responde igual.

Isso é tratado como categoria própria, não como "perfil não encontrado", porque
confundir os dois **destrói a lista inteira**: sem posts e seguidores o eixo de
esforço zera em todo mundo, e uma cidade cheia de clínicas ativas é entregue
como um deserto digital, com todos os leads gelados. Quando acontece, a tela
avisa em vermelho que **as notas daquela varredura não valem** e manda esperar.

O limite passa sozinho em algumas horas. Duas coisas ajudam a não chegar nele:
não rodar varreduras grandes em sequência, e usar a profundidade *rápida*
quando você só quer a lista do GMN.

**O Maps corta perto de 120 resultados** por busca, não importa a cidade. Para
ir além, varra por termos vizinhos ("dentista", "odontologia", "implante
dentário") — a deduplicação entre varreduras usa o `place_id` do Google, que é
estável quando nome e telefone mudam.

**A varredura roda na sua máquina, com o seu IP.** Não é um serviço para deixar
ligado o dia inteiro.

---

## Sobre a coleta

O que é lido aqui é o que qualquer pessoa vê ao abrir o Google Maps e um perfil
público de Instagram: nome, endereço, telefone comercial, avaliações, bio. São
dados de **empresas**, publicados por elas para serem encontrados, usados para
uma abordagem comercial B2B.

Ainda assim, os buscadores e o Instagram desestimulam automação nos termos de
uso, e é por isso que o app anda devagar, em série e em volume de prospecção
manual — algumas dezenas de leads por vez. Não transforme em serviço contínuo,
não venda a base coletada e respeite pedido de descadastro na abordagem (LGPD,
art. 7º, IX — legítimo interesse cobre a prospecção B2B, não cobre insistir
depois do "não").
