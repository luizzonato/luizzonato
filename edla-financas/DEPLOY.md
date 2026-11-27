# Caminho mais fácil: publicar e gerar o APK pelo GitHub (sem instalar nada)

Um fluxo automático (`.github/workflows/edla-apk.yml`) cria o banco, publica no Cloudflare e gera o APK nos servidores do GitHub.

## Preparação (uma vez)

1. **Cloudflare, token:** em <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* → modelo **Edit Cloudflare Workers** e, em *Permissions*, adicione **Account → D1 → Edit**. Copie o token.
2. **Cloudflare, ID da conta:** no painel, página *Workers & Pages*; o *Account ID* aparece na barra lateral. Se for o primeiro acesso, o painel pede para escolher um subdomínio `workers.dev`: aceite.
3. **GitHub:** no repositório → *Settings → Secrets and variables → Actions → New repository secret*. Crie três:
   - `CLOUDFLARE_API_TOKEN`: o token do passo 1
   - `CLOUDFLARE_ACCOUNT_ID`: o ID do passo 2
   - `INVITE_CODE`: uma frase longa inventada por você (será pedida ao criar as contas)

## Gerar

> O GitHub só mostra o botão *Run workflow* quando o arquivo `.github/workflows/edla-apk.yml` está na branch **main**. Faça o merge desta branch na main primeiro.

*Actions → "Edla Finanças - publicar e gerar APK" → Run workflow*. Leva uns 5 a 10 minutos.
No fim, abra a execução: o endereço do app aparece no **Resumo** e o APK em **Artifacts → edla-financas-apk** (baixe o .zip e extraia).

## Depois

1. Instale o APK no celular da Edla (permitir "fontes desconhecidas"), abra, e crie as duas contas com o código de convite.
2. **Feche o cadastro:** rode o fluxo de novo marcando **close_signup** (e apague o segredo `INVITE_CODE` do GitHub).

Observações:
- Cada execução gera um APK com chave nova: **desinstale o antigo antes de instalar o novo**. Os dados ficam na nuvem, nada se perde.
- Para atualizar o app, sempre rode este fluxo (um `wrangler deploy` manual remove a verificação de tela cheia, e a barra de endereço aparece no APK).
- O APK não tem nenhum dado seu; só abre o endereço do app. Mesmo assim, este repositório é público, então qualquer pessoa logada no GitHub conseguiria baixá-lo. Sem login no app, ela não vê nada.

---

# Caminho manual (pelo terminal)


Precisa de: uma conta gratuita no Cloudflare e Node.js 20+ no computador.
Tudo abaixo é feito **uma vez**, dentro da pasta `edla-financas`.

## 1. Instalar e entrar na conta

```bash
npm install
npx wrangler login          # abre o navegador para autorizar
```

## 2. Criar o banco de dados

```bash
npx wrangler d1 create edla-financas
```

O comando mostra um `database_id`. Copie e cole no arquivo `wrangler.jsonc`, no lugar de `00000000-0000-0000-0000-000000000000`.

Depois crie as tabelas:

```bash
npx wrangler d1 migrations apply edla-financas --remote
```

## 3. Definir o código de convite (segredo)

Sem isso **ninguém consegue criar conta**. Escolha uma frase longa e guarde-a só para vocês dois:

```bash
npx wrangler secret put INVITE_CODE
```

## 4. Publicar

```bash
npx wrangler deploy
```

O endereço aparece no final, algo como `https://edla-financas.SEU-USUARIO.workers.dev`.

## 5. Criar as duas contas

Abra o endereço → **"Primeiro acesso? Criar conta"** → preencha nome, usuário, senha (mín. 8 caracteres) e o código de convite. Faça uma conta para a Edla e outra para o Luiz.

**Depois que as duas existirem, desative o cadastro** (boa prática de segurança):

```bash
npx wrangler secret delete INVITE_CODE
```

## 6. Instalar no celular da Edla

**Opção A: direto pelo Chrome (recomendada, 30 segundos).**
Abrir o endereço no Chrome do Android → menu ⋮ → **Instalar app**. Vira um ícone na tela inicial, abre em tela cheia, igual a um aplicativo.

**Opção B: gerar o APK.**
1. Acesse <https://www.pwabuilder.com>, cole o endereço do app e escolha **Android → Download**.
2. Guarde o arquivo de assinatura (`.keystore`) e a senha: sem eles não dá para atualizar o app depois.
3. Envie o `.apk` para o celular dela e instale (permitir "fontes desconhecidas").
4. Para sumir a barra de endereço dentro do APK, o PWABuilder fornece um `assetlinks.json`; coloque em `public/.well-known/assetlinks.json` e rode `npx wrangler deploy` de novo.

**Luiz:** abre o endereço no navegador e usa "Adicionar à tela inicial" / fixar, como já faz com outros apps.

## Manutenção

| Situação | Comando |
|---|---|
| Atualizar o app | `npx wrangler deploy` |
| Backup dos dados | `npx wrangler d1 export edla-financas --remote --output backup.sql` |
| Esqueceu a senha | `npx wrangler secret put INVITE_CODE`, depois `npx wrangler d1 execute edla-financas --remote --command "DELETE FROM users WHERE username='edla'"` e crie a conta de novo (os lançamentos ficam, só perdem o "por quem"). Depois apague o convite de novo. |
| Ver erros | `npx wrangler tail` |

## Cuidados

- **Este repositório é público.** Nunca coloque no código: senhas, o código de convite, o arquivo `.dev.vars`, backups `.sql` ou fotos. O `.gitignore` já protege `.dev.vars`; os segredos reais ficam apenas no Cloudflare.
- Os dados financeiros ficam só no banco D1 da sua conta Cloudflare, protegidos por login.
- Considere mover esta pasta para um **repositório privado** próprio.
