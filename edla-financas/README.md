# Edla Finanças

App de controle financeiro para o casal. A Edla lança gastos, parcelas, contas fixas e renda; o app soma o mês e mostra **quanto da renda já está comprometido**, quanto sobra, quanto dá para gastar por dia e responde "e se eu gastar mais X?".

Roda 100% no Cloudflare (Workers + D1, plano gratuito basta), sem servidor para manter. É um **PWA**: instala no Android como um aplicativo e abre no navegador do computador.

## O que ele faz

| Tipo de lançamento | Exemplo | Como conta |
|---|---|---|
| **Gasto** | Fatura Nubank R$ 512,40 | Só no mês escolhido |
| **Parcelado** | Amazon, parcela de R$ 78 em 10x | R$ 78 por mês durante 10 meses (mostra "parcela 3/10") |
| **Conta fixa** | Empréstimo do carro, R$ 170 por 36 meses | Todo mês, com ou sem data de fim |
| **Renda** | Salário R$ 3.500 | Todo mês (ou só por alguns meses) |

- **Resumo do mês:** anel com % da renda comprometida, aviso colorido (dentro da meta / acima da meta / passou da renda), gasto por cartão e por categoria.
- **Meta configurável** (padrão 70%): o app avisa quando os gastos passam dela.
- **Simulador:** digite um valor e veja como ficaria o mês.
- **Foto de perfil:** enviada pelo próprio app (recortada e reduzida no aparelho). Fica só no banco de dados, nunca no código.
- **Dois acessos** (limite de contas configurável em `MAX_USERS`), cada um com seu login. Os dois enxergam os mesmos lançamentos e cada lançamento mostra quem criou.

## Segurança (resumo)

- Senhas com PBKDF2-SHA256 (100 mil iterações, salt aleatório). Nunca guardadas em texto.
- Sessão em cookie `HttpOnly` + `Secure` + `SameSite=Strict`; só o hash do token vai para o banco.
- Cadastro só com **código de convite** (segredo no Cloudflare) e no máximo `MAX_USERS` contas.
- Bloqueio de 15 min após 8 tentativas erradas (por IP e por usuário).
- Proteção CSRF (checagem de `Origin` + JSON obrigatório), validação rigorosa de tudo no servidor, SQL sempre parametrizado.
- CSP restritiva (`script-src 'self'`, sem scripts/estilos inline), HSTS, `X-Frame-Options`, etc.
- Tela construída com `textContent` (sem `innerHTML` com dados do usuário) → sem XSS.
- Foto: só JPEG/PNG/WebP (confere o cabeçalho do arquivo), máx. ~200 KB. SVG é recusado de propósito.

## Publicar

Veja [DEPLOY.md](./DEPLOY.md).

## Desenvolvimento local

```bash
npm install
echo 'INVITE_CODE=meu-codigo-de-teste' > .dev.vars   # nunca vai para o git
npm run migrate:local
npm run dev                                          # http://localhost:8787
npm test                                             # regras de cálculo
```

## Estrutura

```
src/worker.js        API (login, lançamentos, ajustes, foto)
public/              Telas (HTML/CSS/JS puro, sem build) + PWA (manifest, service worker, ícones)
public/calc.js       Regras financeiras (testadas em test/)
migrations/          Banco D1
```
