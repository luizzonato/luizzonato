// Edla Finanças - API (Cloudflare Workers + D1).
// Os arquivos estáticos (HTML/CSS/JS) são servidos pelo binding "assets";
// este Worker só atende /api/*.

const CATEGORIES = [
  'Mercado', 'Alimentação', 'Transporte', 'Casa', 'Saúde', 'Lazer',
  'Compras', 'Empréstimo', 'Cartão', 'Contas', 'Renda', 'Outros',
];
const KINDS = ['expense', 'installment', 'fixed', 'income'];

const PBKDF2_ITERATIONS = 100000; // máximo permitido pelo runtime do Workers
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 dias
const MAX_BODY_BYTES = 300 * 1024;
const MAX_AVATAR_CHARS = 200 * 1024;
const LOGIN_WINDOW_S = 15 * 60;
const LOGIN_MAX_FAILS = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- utilidades ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...extraHeaders,
    },
  });
}

const b64 = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
}

function timingSafeEqual(a, b) {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { pass_hash: b64(hash), salt: b64(salt), iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(password, user) {
  const hash = await pbkdf2(password, unb64(user.salt), user.iterations);
  return timingSafeEqual(hash, unb64(user.pass_hash));
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookieName(url) {
  return url.protocol === 'https:' ? '__Host-sid' : 'sid';
}

function sessionCookie(url, value, maxAge) {
  const secure = url.protocol === 'https:';
  return `${cookieName(url)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Conteúdo inválido.');
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Requisição grande demais.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Requisição grande demais.');
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

// ---------- validação ----------

function str(value, field, { min = 0, max = 100 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `Campo inválido: ${field}.`);
  const v = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (v.length < min || v.length > max) throw new HttpError(400, `Campo inválido: ${field}.`);
  return v;
}

function validateMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, 'Mês inválido.');
  }
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) throw new HttpError(400, 'Mês inválido.');
  return value;
}

function validateEntry(body) {
  const kind = body.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Tipo inválido.');
  const description = str(body.description, 'descrição', { min: 1, max: 80 });
  const amount = body.amount_cents;
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) {
    throw new HttpError(400, 'Valor inválido.');
  }
  const method = str(body.method ?? '', 'forma de pagamento', { max: 40 });
  const category = body.category ?? 'Outros';
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Categoria inválida.');
  const start_month = validateMonth(body.start_month);
  const note = str(body.note ?? '', 'observação', { max: 200 });

  let months = body.months ?? null;
  if (kind === 'expense') {
    months = 1;
  } else if (kind === 'installment') {
    if (!Number.isInteger(months) || months < 2 || months > 120) throw new HttpError(400, 'Número de parcelas inválido.');
  } else if (months !== null && (!Number.isInteger(months) || months < 1 || months > 600)) {
    throw new HttpError(400, 'Duração inválida.');
  }
  let split_pct = body.split_pct ?? null;
  if (split_pct !== null && (!Number.isInteger(split_pct) || split_pct < 1 || split_pct > 99)) throw new HttpError(400, 'Divisão inválida.');
  const is_private = body.is_private === true || body.is_private === 1 ? 1 : 0;
  if (kind === 'income' || is_private) split_pct = null; // renda e lançamento privado não se dividem
  return { kind, description, amount_cents: amount, method, category, start_month, months, note, split_pct, is_private };
}

const AVATAR_MAGIC = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
};

function validateAvatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_AVATAR_CHARS) throw new HttpError(400, 'Foto inválida ou grande demais.');
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) throw new HttpError(400, 'Foto inválida.');
  let bytes;
  try {
    bytes = unb64(m[2].slice(0, 24).padEnd(Math.ceil(Math.min(m[2].length, 24) / 4) * 4, '='));
  } catch {
    throw new HttpError(400, 'Foto inválida.');
  }
  if (!AVATAR_MAGIC[m[1]](bytes)) throw new HttpError(400, 'Foto inválida.');
  return value;
}

// ---------- sessão ----------

async function currentUser(request, env, url) {
  const token = parseCookies(request.headers.get('Cookie'))[cookieName(url)];
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.avatar FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(hash, Math.floor(Date.now() / 1000)).first();
  return row || null;
}

async function createSession(env, userId) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, expires).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)).run();
  return token;
}

// O "dono" é o primeiro e-mail da lista ALLOWED_EMAILS: só ele pode marcar lançamentos como privados.
const isOwner = (env, u) => String(env.ALLOWED_EMAILS || '').split(',')[0].trim().toLowerCase() === String(u.username).toLowerCase();
const publicUser = (u, env) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar, owner: env ? isOwner(env, u) : false });

// ---------- rotas ----------

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // Verificação do app Android (TWA): faz o APK abrir em tela cheia, sem barra de endereço.
  if (pathname === '/.well-known/assetlinks.json' && (method === 'GET' || method === 'HEAD')) {
    const pkg = env.ANDROID_PACKAGE;
    const sha = env.ANDROID_SHA256;
    if (!/^[a-zA-Z][\w.]{2,100}$/.test(pkg || '') || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(sha || '')) {
      throw new HttpError(404, 'Não encontrado.');
    }
    return json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [sha] },
    }], 200, { 'Cache-Control': 'public, max-age=300' });
  }

  // Proteção CSRF: pedidos que alteram dados precisam vir do mesmo site.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    let originHost = null;
    try { originHost = origin ? new URL(origin).host : null; } catch { /* origem inválida */ }
    if (originHost !== url.host) throw new HttpError(403, 'Origem não permitida.');
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env, url);
    if (user) return json({ user: publicUser(user, env) });
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    return json({ user: null, firstAccess: n === 0 }, 401);
  }

  if (pathname === '/api/google' && method === 'POST') return googleLogin(request, env, url);

  // Tudo abaixo exige login.
  const user = await currentUser(request, env, url);
  if (!user) throw new HttpError(401, 'Faça login para continuar.');

  if (pathname === '/api/logout' && method === 'POST') {
    const token = parseCookies(request.headers.get('Cookie'))[cookieName(url)];
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, '', 0) });
  }

  if (pathname === '/api/password' && method === 'POST') {
    const body = await readJson(request);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = str(body.next, 'nova senha', { min: 8, max: 200 });
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    if (!(await verifyPassword(current, row))) throw new HttpError(403, 'Senha atual incorreta.');
    const h = await hashPassword(next);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ?, iterations = ? WHERE id = ?').bind(h.pass_hash, h.salt, h.iterations, user.id),
      // Encerra as outras sessões deste usuário; a atual é recriada abaixo.
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    ]);
    const token = await createSession(env, user.id);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, token, SESSION_TTL_S) });
  }

  if (pathname === '/api/avatar' && method === 'PUT') {
    const body = await readJson(request);
    const avatar = validateAvatar(body.avatar ?? null);
    await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(avatar, user.id).run();
    return json({ ok: true, avatar });
  }

  if (pathname === '/api/settings') {
    if (method === 'GET') return json(await loadSettings(env));
    if (method === 'PUT') {
      const body = await readJson(request);
      const pct = body.limit_pct;
      if (!Number.isInteger(pct) || pct < 10 || pct > 100) throw new HttpError(400, 'Percentual inválido.');
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('limit_pct', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(String(pct)).run();
      return json(await loadSettings(env));
    }
  }

  if (pathname === '/api/entries') {
    const owner = isOwner(env, user);
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT e.id, e.kind, e.description, e.amount_cents, e.method, e.category,
                e.start_month, e.months, e.note, e.created_at, e.is_private, e.split_pct,
                e.created_by AS owner_id, u.name AS created_by
         FROM entries e LEFT JOIN users u ON u.id = e.created_by
         WHERE (e.is_private = 0 OR ? = 1)
         ORDER BY e.start_month DESC, e.id DESC LIMIT 5000`,
      ).bind(owner ? 1 : 0).all();
      const partner = await env.DB.prepare('SELECT id, name FROM users WHERE id != ? ORDER BY id LIMIT 1').bind(user.id).first();
      const pays = await env.DB.prepare(
        `SELECT p.entry_id, p.month, p.user_id FROM payments p JOIN entries e ON e.id = p.entry_id
         WHERE (e.is_private = 0 OR ? = 1)`,
      ).bind(owner ? 1 : 0).all();
      return json({ entries: results, categories: CATEGORIES, partner: partner || null, payments: pays.results });
    }
    if (method === 'POST') {
      const e = validateEntry(await readJson(request));
      if (!owner) { e.is_private = 0; }
      const res = await env.DB.prepare(
        `INSERT INTO entries (kind, description, amount_cents, method, category, start_month, months, note, created_by, is_private, split_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(e.kind, e.description, e.amount_cents, e.method, e.category, e.start_month, e.months, e.note, user.id, e.is_private, e.split_pct).run();
      return json({ ok: true, id: res.meta.last_row_id }, 201);
    }
  }

  if (pathname === '/api/payments' && method === 'POST') {
    const body = await readJson(request);
    const entryId = body.entry_id;
    if (!Number.isInteger(entryId) || entryId < 1) throw new HttpError(400, 'Lançamento inválido.');
    const month = validateMonth(body.month);
    const visible = await env.DB.prepare('SELECT id FROM entries WHERE id = ? AND (is_private = 0 OR ? = 1)')
      .bind(entryId, isOwner(env, user) ? 1 : 0).first();
    if (!visible) throw new HttpError(404, 'Lançamento não encontrado.');
    if (body.paid === true) {
      await env.DB.prepare('INSERT OR IGNORE INTO payments (entry_id, month, user_id) VALUES (?, ?, ?)').bind(entryId, month, user.id).run();
    } else {
      await env.DB.prepare('DELETE FROM payments WHERE entry_id = ? AND month = ? AND user_id = ?').bind(entryId, month, user.id).run();
    }
    return json({ ok: true });
  }

  const m = /^\/api\/entries\/(\d{1,12})$/.exec(pathname);
  if (m) {
    const id = Number(m[1]);
    if (method === 'PUT') {
      const e = validateEntry(await readJson(request));
      const owner = isOwner(env, user) ? 1 : 0;
      // Quem não é o dono nunca altera a privacidade nem mexe em lançamento privado.
      const res = await env.DB.prepare(
        `UPDATE entries SET kind=?, description=?, amount_cents=?, method=?, category=?, start_month=?, months=?, note=?,
                split_pct=?, is_private = CASE WHEN ? = 1 THEN ? ELSE is_private END
         WHERE id = ? AND (is_private = 0 OR ? = 1)`,
      ).bind(e.kind, e.description, e.amount_cents, e.method, e.category, e.start_month, e.months, e.note, e.split_pct, owner, e.is_private, id, owner).run();
      if (!res.meta.changes) throw new HttpError(404, 'Lançamento não encontrado.');
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const res = await env.DB.prepare('DELETE FROM entries WHERE id = ? AND (is_private = 0 OR ? = 1)').bind(id, isOwner(env, user) ? 1 : 0).run();
      if (!res.meta.changes) throw new HttpError(404, 'Lançamento não encontrado.');
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Não encontrado.');
}

async function loadSettings(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'limit_pct'").first();
  return { limit_pct: row ? Number(row.value) : 70 };
}

async function register(request, env, url) {
  const body = await readJson(request);
  const ip = clientIp(request);
  await assertNotLocked(env, [`ip:${ip}`]);

  if (!env.INVITE_CODE) throw new HttpError(403, 'Cadastro desativado: configure o INVITE_CODE no Cloudflare.');
  const invite = typeof body.invite === 'string' ? body.invite : '';
  const same = timingSafeEqual(
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(invite))),
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(env.INVITE_CODE))),
  );
  if (!same) {
    await recordFail(env, [`ip:${ip}`]);
    throw new HttpError(403, 'Código de convite incorreto.');
  }

  const name = str(body.name, 'nome', { min: 1, max: 40 });
  const username = str(body.username, 'usuário', { min: 3, max: 30 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, 'Usuário: use letras, números, ponto, hífen ou _.');
  const password = str(body.password, 'senha', { min: 8, max: 200 });

  const h = await hashPassword(password);
  const maxUsers = Math.max(1, Math.min(10, Number(env.MAX_USERS) || 2));
  // INSERT condicional: evita passar do limite de contas mesmo com pedidos simultâneos.
  const res = await env.DB.prepare(
    `INSERT INTO users (name, username, pass_hash, salt, iterations)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM users) < ?`,
  ).bind(name, username, h.pass_hash, h.salt, h.iterations, maxUsers).run().catch((err) => {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'Esse usuário já existe.');
    throw err;
  });
  if (!res.meta.changes) throw new HttpError(403, 'Limite de contas atingido.');

  const token = await createSession(env, res.meta.last_row_id);
  const user = await env.DB.prepare('SELECT id, name, username, avatar FROM users WHERE id = ?').bind(res.meta.last_row_id).first();
  return json({ user: publicUser(user) }, 201, { 'Set-Cookie': sessionCookie(url, token, SESSION_TTL_S) });
}

// ---------- login com Google (Firebase Auth) ----------
// O navegador entrega um ID token do Firebase; aqui conferimos a assinatura, o projeto e se o e-mail está na lista.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function b64urlToBytes(v) {
  const s = v.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyFirebaseToken(token, projectId, now = Math.floor(Date.now() / 1000), jwks) {
  const bad = () => new HttpError(401, 'Login com Google inválido.');
  if (typeof token !== 'string' || token.length > 4000 || !projectId) throw bad();
  const parts = token.split('.');
  if (parts.length !== 3) throw bad();
  let header; let claims;
  try {
    header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
  } catch { throw bad(); }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  const keys = jwks || (await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })).json()).keys;
  const jwk = (keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const okSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!okSig) throw bad();
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw bad();
  if (!claims.sub || !(claims.exp > now) || !(claims.iat <= now + 60)) throw bad();
  if (claims.email_verified !== true || claims.firebase?.sign_in_provider !== 'google.com') throw bad();
  return claims;
}

async function googleLogin(request, env, url) {
  const ip = clientIp(request);
  await assertNotLocked(env, [`ip:${ip}`]);
  const body = await readJson(request);
  let claims;
  try {
    claims = await verifyFirebaseToken(body.idToken, env.FIREBASE_PROJECT_ID);
  } catch (err) {
    await recordFail(env, [`ip:${ip}`]);
    throw err;
  }
  const email = String(claims.email || '').toLowerCase();
  const allowed = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean);
  if (!email || !allowed.includes(email)) {
    await recordFail(env, [`ip:${ip}`]);
    throw new HttpError(403, 'Esta conta Google não tem acesso ao app.');
  }
  let row = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(email).first();
  if (!row) {
    const first = String(claims.name || email.split('@')[0]).trim().split(/\s+/)[0].slice(0, 40) || 'Usuário';
    const h = await hashPassword(b64url(crypto.getRandomValues(new Uint8Array(24)))); // senha aleatória: ninguém entra por senha
    const res = await env.DB.prepare('INSERT INTO users (name, username, pass_hash, salt, iterations) VALUES (?, ?, ?, ?, ?)')
      .bind(first, email, h.pass_hash, h.salt, h.iterations).run();
    row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(res.meta.last_row_id).first();
  }
  const token = await createSession(env, row.id);
  return json({ user: publicUser(row, env) }, 200, { 'Set-Cookie': sessionCookie(url, token, SESSION_TTL_S) });
}

// Hash falso para gastar o mesmo tempo quando o usuário não existe.
const DUMMY_USER = { salt: b64(new Uint8Array(16)), iterations: PBKDF2_ITERATIONS, pass_hash: b64(new Uint8Array(32)) };

async function login(request, env, url) {
  const body = await readJson(request);
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 30) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const keys = [`ip:${clientIp(request)}`, `u:${username}`];
  await assertNotLocked(env, keys);

  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(password, row || DUMMY_USER);
  if (!row || !ok) {
    await recordFail(env, keys);
    throw new HttpError(401, 'Usuário ou senha incorretos.');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(`u:${username}`).run();
  const token = await createSession(env, row.id);
  return json({ user: publicUser(row) }, 200, { 'Set-Cookie': sessionCookie(url, token, SESSION_TTL_S) });
}

async function assertNotLocked(env, keys) {
  const since = Math.floor(Date.now() / 1000) - LOGIN_WINDOW_S;
  for (const key of keys) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND ts > ?').bind(key, since).first();
    if (n >= LOGIN_MAX_FAILS) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  }
}

async function recordFail(env, keys) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    ...keys.map((k) => env.DB.prepare('INSERT INTO login_attempts (key, ts) VALUES (?, ?)').bind(k, now)),
    env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(now - LOGIN_WINDOW_S),
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Erro interno:', err && err.stack ? err.stack : err);
      return json({ error: 'Erro interno. Tente novamente.' }, 500);
    }
  },
};
