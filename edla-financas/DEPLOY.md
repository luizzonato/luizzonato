# Couple Bank: publicar e gerar o APK (sem instalar nada)

Um fluxo automático (`.github/workflows/edla-apk.yml`, na raiz do repositório) cria o banco, publica no Cloudflare e gera o APK nos servidores do GitHub. O login é **só pelo Google**, e só entram os e-mails da lista `ALLOWED_EMAILS`.

## Preparação (uma vez)

1. **Cloudflare, token:** em <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* → modelo **Edit Cloudflare Workers** e, em *Permissions*, adicione **Account → D1 → Edit**. Copie o token.
2. **Cloudflare, ID da conta:** no painel, *Workers & Pages*; o *Account ID* aparece na barra lateral. No primeiro acesso o painel pede um subdomínio `workers.dev`: aceite.
3. **GitHub:** no repositório → *Settings → Secrets and variables → Actions → New repository secret*. Crie três:
   - `CLOUDFLARE_API_TOKEN`: o token do passo 1
   - `CLOUDFLARE_ACCOUNT_ID`: o ID do passo 2
   - `ALLOWED_EMAILS`: os e-mails Google autorizados, separados por vírgula (fica em segredo porque o repositório é público)

## Gerar

> O GitHub só mostra o botão *Run workflow* quando o arquivo do fluxo está na branch **main**. Faça o merge primeiro.

*Actions → "Couple Bank - publicar e gerar APK" → Run workflow*. Leva uns 5 a 10 minutos.
No fim, abra a execução: o endereço do app aparece no **Resumo** e o APK em **Artifacts → edla-financas-apk** (baixe o .zip e extraia).

## Depois da primeira execução (obrigatório)

No console do Firebase (projeto `edila-financas`) → **Authentication → Settings → Authorized domains** → adicione o endereço do app (`edla-financas.SEU-USUARIO.workers.dev`, sem `https://`). Sem isso o Google recusa o login no site publicado.

## Usar

- **iPhone:** abra o endereço no **Safari** → Compartilhar → *Adicionar à Tela de Início*. O login do Google deve ser feito dentro do ícone criado.
- **Android:** instale o APK (permitir "fontes desconhecidas"), ou use o site como no iPhone.

Observações:
- Cada execução gera um APK com chave nova: **desinstale o antigo antes de instalar o novo**. Os dados ficam na nuvem.
- Para atualizar o app, rode sempre este fluxo (um `wrangler deploy` manual remove a verificação de tela cheia do APK).
- O APK não tem nenhum dado financeiro; só abre o endereço do app. O repositório é público, então qualquer pessoa logada no GitHub poderia baixá-lo. Sem uma conta Google autorizada, ninguém entra no app.

---

# Caminho manual (pelo terminal)

Precisa de: conta gratuita no Cloudflare e Node.js 20+.

```bash
npm install
npx wrangler login
npx wrangler d1 create edla-financas      # copie o database_id para o wrangler.jsonc
npx wrangler d1 migrations apply edla-financas --remote
npx wrangler secret put ALLOWED_EMAILS    # e-mails Google autorizados, separados por vírgula
npx wrangler deploy
```

Depois adicione o domínio do app nos *Authorized domains* do Firebase (veja acima).

## Testar no computador

```bash
npm run migrate:local
# crie o arquivo .dev.vars (não vai para o Git) com:
#   FIREBASE_PROJECT_ID=edila-financas
#   ALLOWED_EMAILS=email1@gmail.com,email2@gmail.com
npm run dev          # http://localhost:8787
npm test
```

## Segurança

- Login só pelo Google; o servidor confere a assinatura do token do Firebase, o projeto e o e-mail na lista autorizada.
- Cada lançamento pode ser privado (só o dono vê). Quem não é o dono nunca altera a privacidade.
- Sessões duram 30 dias e ficam em cookie `HttpOnly`.
