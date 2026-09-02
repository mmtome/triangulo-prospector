/**
 * Extração da identidade visual do lead — o que vira a proposta.
 *
 * O QUE DÁ E O QUE NÃO DÁ PARA EXTRAIR
 * ────────────────────────────────────
 *   logo    → a foto de perfil do Instagram (og:image). Em pet shop, clínica e
 *             salão ela é o logo em quase todos os perfis.
 *   paleta  → quantizada dessa mesma imagem. É a cor que o dono escolheu.
 *   fotos   → da grade de posts do Instagram; do Google Meu Negócio como
 *             reserva. A grade só aparece com sessão logada (`npm run login`),
 *             e é sempre melhor: são as imagens que o próprio dono escolheu
 *             publicar, não a fachada fotografada por um cliente.
 *   dados   → nome, telefone, endereço, @, nota e avaliações, já coletados.
 *
 * O que NÃO sai daqui é o texto: descrição de serviço, depoimento, redação de
 * seção. Nada disso está num perfil, e inventar não é extrair. A proposta nasce
 * com o texto de exemplo do modelo e a identidade real por cima — que é o que
 * faz o cliente se reconhecer na tela.
 *
 * POR QUE A IMAGEM É BAIXADA NO NODE E NÃO NA PÁGINA
 * ─────────────────────────────────────────────────
 * `getImageData` em canvas com imagem de outra origem lança SecurityError, e um
 * `fetch` na página esbarra em CORS. Baixar os bytes no Node — que não tem CORS
 * — e entregar como `data:` resolve os dois de uma vez: imagem `data:` não
 * contamina o canvas. Sem essa volta seria preciso navegar a aba para a origem
 * do CDN antes de cada leitura, o que é frágil e gasta requisição.
 */

/** Teto de download por imagem. Avatar de Instagram não passa de ~200 KB. */
const LIMITE_BYTES = 3 * 1024 * 1024;

/**
 * Baixa a imagem e devolve `data:image/...;base64,…`.
 *
 * Devolve null em vez de lançar: identidade é enriquecimento, e um avatar que
 * não baixou nunca pode derrubar a clonagem de um lead.
 */
export async function baixarComoDataUrl(url, { timeoutMs = 15000 } = {}) {
  if (!url) return null;
  try {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: controle.signal,
      headers: {
        // Sem Referer o CDN da Meta devolve 403 em parte dos avatares.
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(t);
    if (!r.ok) return null;

    const tipo = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!tipo.startsWith("image/")) return null;

    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > LIMITE_BYTES) return null;

    return "data:" + tipo + ";base64," + buf.toString("base64");
  } catch {
    return null;
  }
}

/* ── cor ───────────────────────────────────────────────────────────────────── */

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function rgbParaHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslParaHex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) return hex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return hex(canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255);
}

/**
 * Cores dominantes da imagem, já filtradas.
 *
 * Roda dentro da página porque é lá que existe canvas — decodificar JPEG em JS
 * puro seria reimplementar um decodificador, e o Chrome já está aberto.
 *
 * O filtro é o que separa "cor da marca" de "cor da foto": cinza, quase-branco
 * e quase-preto saem, porque são fundo e contorno, não escolha de marca. Um
 * avatar com logo preto sobre branco devolve lista vazia — e vazio aqui
 * significa "não sei", que é a resposta honesta.
 */
export async function paletaDaImagem(aba, dataUrl) {
  if (!dataUrl) return [];
  try {
    return await aba.avaliar(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();

      // 72px de lado: suficiente para a distribuição de cor, e rápido.
      const lado = 72;
      const c = document.createElement("canvas");
      c.width = lado;
      c.height = lado;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, lado, lado);
      const { data } = ctx.getImageData(0, 0, lado, lado);

      const baldes = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;

        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2 / 255;
        const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));

        // Fundo e contorno fora: só entra cor com croma e luminosidade de marca.
        if (l < 0.12 || l > 0.93) continue;
        if (s < 0.18) continue;

        // Balde de 24 níveis por canal: junta tons vizinhos da mesma cor.
        const chave = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        const atual = baldes.get(chave) || { r: 0, g: 0, b: 0, n: 0 };
        atual.r += r; atual.g += g; atual.b += b; atual.n++;
        baldes.set(chave, atual);
      }

      /* Dez cores por imagem, não seis. A cor secundária de uma marca ocupa
         pouca área — o laranja dos botões do Zebu Petshop fica em ~5% do post,
         fora dos seis primeiros baldes, e some antes de a recorrência entre
         imagens poder resgatá-lo. */
      return [...baldes.values()]
        .sort((x, y) => y.n - x.n)
        .slice(0, 10)
        .map((v) => ({
          r: Math.round(v.r / v.n),
          g: Math.round(v.g / v.n),
          b: Math.round(v.b / v.n),
          peso: v.n,
        }));
    }, dataUrl);
  } catch {
    return [];
  }
}

/**
 * A paleta da MARCA, lida no conjunto das imagens — não numa só.
 *
 * O erro que isto conserta: o Zebu Petshop posta tudo sobre um fundo turquesa
 * com botão laranja. A foto de perfil dele é um logo de touro, e sozinha
 * devolveu amarelo. A proposta saiu amarela para uma marca turquesa.
 *
 * A regra que separa cor de marca de cor de foto é a RECORRÊNCIA: o turquesa
 * aparece em oito de oito posts porque é a identidade; o marrom do gato aparece
 * num post porque é o assunto daquele post. Por isso o ranking pesa primeiro em
 * quantas imagens a cor apareceu, e só depois em quanto ela ocupa.
 *
 * Os matizes entram em baldes de 15° para o mesmo turquesa em iluminações
 * diferentes contar como uma cor só, em vez de virar seis quase-empates.
 */
export async function paletaDoConjunto(aba, dataUrls) {
  const imagens = (dataUrls || []).filter(Boolean);
  if (!imagens.length) return null;

  const baldes = new Map(); // matiz → { imagens:Set, peso, r, g, b, n }

  for (let i = 0; i < imagens.length; i++) {
    const cores = await paletaDaImagem(aba, imagens[i]);

    /* Cada imagem vota uma vez por matiz. Sem isto um post com fundo turquesa
       inteiro daria seis votos de turquesa e a recorrência viraria contagem de
       pixel com outro nome. */
    const vistosNestaImagem = new Set();

    for (let posicao = 0; posicao < cores.length; posicao++) {
      const c = cores[posicao];
      const [h, s] = rgbParaHsl(c.r, c.g, c.b);
      if (s < 0.22) continue; // cinza não é identidade

      const balde = Math.round(h * 24) % 24;
      if (vistosNestaImagem.has(balde)) continue;
      vistosNestaImagem.add(balde);

      /* O VOTO PESA PELA ÁREA, pela posição da cor dentro da imagem.
         Recorrência pura elegia o bege: pelo de bicho aparece em 9 de 9 posts
         de pet shop. Mas pelo nunca é a MAIOR área — o fundo é. No post do gato
         do Zebu, o turquesa é a cor nº 1 e o gato é a nº 2. Contar 5 pontos
         para a primeira cor, 4 para a segunda e assim por diante separa fundo
         de assunto sem lista de cores proibidas. */
      const atual = baldes.get(balde) || { imagens: new Set(), peso: 0, sat: 0, r: 0, g: 0, b: 0, n: 0 };
      atual.imagens.add(i);
      /* O voto é a MASSA DE PIXEL, somada entre as imagens.
         É o sinal que eu tinha e joguei fora ao tentar votar por posição: nas
         fotos do Zebu o turquesa ocupa 2515, 1676, 770 e 1619 pixels da amostra
         — o bege do pelo ocupa 262. Fundo de marca é área; assunto de foto não
         é. Recorrência sozinha empatava os dois em 9 de 9 imagens. */
      atual.peso += c.peso || 1;
      /* PICO de croma do matiz, não média. Com dez cores por imagem o mesmo
         turquesa entra em versões lavadas (sombra, reflexo), e a média puxava
         a saturação do balde para baixo até um amarelo quebrado ganhar dele.
         O que importa é se aquele matiz aparece VIBRANTE em algum lugar — cor
         de marca aparece; pelo e madeira não aparecem em lugar nenhum. */
      if (s > atual.sat) {
        // O balde é REPRESENTADO pela sua cor mais vibrante, não pela média.
        // Um balde de 15° junta o laranja #f48543 e o marrom #a35c3a, e a média
        // dos dois é uma lama que não existe em lugar nenhum da marca.
        atual.sat = s;
        atual.r = c.r; atual.g = c.g; atual.b = c.b;
      }
      atual.n++;
      baldes.set(balde, atual);
    }
  }

  if (!baldes.size) return null;

  /* Recorrência sozinha não basta, e o Zebu Petshop mostrou por quê: bege de
     pelo apareceu em 9 de 9 imagens — todo post de pet shop tem bicho — e
     ganhou do turquesa da marca, que aparecia nas mesmas 9.

     O desempate é o CROMA. Cor de marca é escolhida e vibrante; pelo, pele,
     madeira e concreto são tons quebrados. O turquesa do Zebu tem saturação
     0,98 contra 0,51 do bege, e multiplicar recorrência por saturação inverte
     o ranking sem precisar de lista de cores proibidas. */
  const ranking = [...baldes.values()]
    .map((v) => {
      const saturacao = v.sat;
      return {
        r: v.r,
        g: v.g,
        b: v.b,
        recorrencia: v.imagens.size,
        saturacao,
        nota: v.peso * saturacao,
      };
    })
    .sort((a, b) => b.nota - a.nota);

  /* Uma cor que apareceu em UMA imagem só não é identidade, é assunto. Com
     poucas imagens o piso é 1, senão um conjunto de 2 fotos nunca decidiria. */
  const piso = imagens.length >= 4 ? 2 : 1;
  const daMarca = ranking.filter((c) => c.recorrencia >= piso);

  const paleta = derivarPaleta(daMarca.length ? daMarca : ranking);
  if (paleta) {
    paleta.recorrencia = (daMarca[0] || ranking[0]).recorrencia;
    paleta.imagensLidas = imagens.length;
  }
  return paleta;
}

/**
 * Monta o conjunto de tokens que o modelo consome, a partir da cor dominante.
 *
 * O modelo-1 não pede "uma cor": ele pede uma família (base, viva, clara,
 * suave), um creme de fundo e uma tinta de texto. Derivar tudo de um matiz só
 * mantém a página coerente mesmo quando a extração acerta só a cor principal —
 * e é melhor que espalhar cores soltas do avatar pela interface.
 *
 * A tinta e o creme carregam um resto do matiz da marca em vez de serem cinza
 * neutro: é o que faz a página parecer desenhada para aquele negócio.
 */
export function derivarPaleta(cores) {
  if (!cores?.length) return null;

  const principal = cores[0];
  const [h, s, l] = rgbParaHsl(principal.r, principal.g, principal.b);

  // Cor de marca com croma de menos vira cinza no site inteiro.
  const sBase = Math.max(s, 0.45);

  /* O destaque tem duas exigências, e a segunda foi aprendida no Zebu Petshop:
     precisa ser outro matiz (abaixo de ~15% no círculo é a mesma cor com outra
     luz), e precisa ser VIBRANTE. Com o piso antigo de 0,25 o segundo lugar
     virava o bege do pelo dos bichos — que aparece em toda foto de pet shop e
     não é decisão de ninguém. O laranja dos botões do Zebu passa de 0,8; pelo,
     madeira e concreto ficam abaixo de 0,55. */
  const destaque = cores.slice(1).find((c) => {
    const [h2, s2] = rgbParaHsl(c.r, c.g, c.b);
    const dist = Math.min(Math.abs(h2 - h), 1 - Math.abs(h2 - h));
    return dist > 0.15 && s2 >= 0.55;
  });

  return {
    primaria: hslParaHex(h, sBase, Math.min(Math.max(l, 0.42), 0.6)),
    primariaVivo: hslParaHex(h, Math.min(sBase + 0.08, 1), Math.min(l + 0.08, 0.68)),
    primariaClaro: hslParaHex(h, Math.min(sBase, 0.85), 0.72),
    primariaSuave: hslParaHex(h, Math.min(sBase, 0.6), 0.9),
    creme: hslParaHex(h, 0.35, 0.97),
    tinta: hslParaHex(h, 0.22, 0.09),
    branco: "#ffffff",
    destaque: destaque ? hex(destaque.r, destaque.g, destaque.b) : null,
    // Amostra crua, para a tela mostrar de onde a derivação saiu.
    amostra: cores.slice(0, 5).map((c) => hex(c.r, c.g, c.b)),
  };
}

/* ── marca.json ────────────────────────────────────────────────────────────── */

/** Só dígitos, com DDI — mesmo formato do gestor. */
function telefoneLimpo(v) {
  if (!v) return null;
  const d = String(v).replace(/\D/g, "");
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? "55" + d : d;
}

/** "Uberaba - MG" → "Uberaba — MG", que é como o modelo escreve. */
const cidadeBonita = (v) => (v ? String(v).replace(/\s*-\s*/, " — ") : null);

/**
 * O `marca.json`: tudo que a proposta precisa saber sobre ESTE negócio.
 *
 * Só entra o que foi coletado. Campo que não veio fica `null` e o modelo cai no
 * padrão dele — em vez de inventar um endereço ou um horário, que é o tipo de
 * erro que o cliente percebe na primeira olhada e que queima a proposta.
 */
export function montarMarca(lead, { modelo, paleta, logo, fotos }) {
  const tel = telefoneLimpo(lead.telefone || lead.instagram?.telefoneBio);

  return {
    versao: 1,
    modelo,
    geradoEm: new Date().toISOString(),

    negocio: {
      nome: lead.nome,
      categoria: lead.categoria || null,
      slogan: null, // não é extraível; o modelo usa o dele
      telefone: tel,
      telefoneExibido: tel ? formatarTelefone(tel) : null,
      whatsapp: tel ? "https://wa.me/" + tel : null,
      endereco: lead.endereco || null,
      cidade: cidadeBonita(lead.cidade),
      mapsUrl: lead.gmn?.url || null,
      email: lead.email || lead.instagram?.emailBio || null,
    },

    social: {
      instagram: lead.instagram?.handle ? "https://www.instagram.com/" + lead.instagram.handle : null,
      instagramHandle: lead.instagram?.handle ? "@" + lead.instagram.handle : null,
      seguidores: lead.instagram?.seguidores ?? null,
      posts: lead.instagram?.posts ?? null,
      bio: lead.instagram?.bio || null,
      linkBio: lead.instagram?.link?.url || null,
    },

    reputacao: {
      notaGoogle: lead.gmn?.nota ?? null,
      avaliacoesGoogle: lead.gmn?.avaliacoes ?? null,
    },

    identidade: {
      paleta,
      // Caminhos relativos: quem clona resolve onde os arquivos vão morar.
      logo: logo ? { arquivo: "logo" + logo.extensao, origem: "instagram" } : null,
      fotos: fotos.map((f, i) => ({ arquivo: "foto-" + (i + 1) + f.extensao, origem: f.origem })),
    },

    /* A procedência vai junto no arquivo, não num log: quem abrir a proposta
       daqui a um mês precisa saber que a nota do Google foi lida naquele dia e
       que o texto é do modelo, não do cliente. */
    procedencia: {
      varredura: lead._varredura || null,
      temperatura: lead.score?.temperatura || null,
      pontos: lead.score?.total ?? null,
      textoEhDoModelo: true,
      paletaExtraidaDe: paleta?.origem ?? null,
    },
  };
}

/** (34) 99999-9999 a partir dos dígitos com DDI. */
function formatarTelefone(d) {
  const br = d.startsWith("55") ? d.slice(2) : d;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return d;
}
