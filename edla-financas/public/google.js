// Login com Google via Firebase Auth. O SDK é carregado do CDN oficial do Google.
import { firebaseConfig } from '/firebase-config.js';

const V = '11.0.2';
let sdk;

export const googleConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// Chame cedo (ao abrir o app) para o clique no botão abrir o popup sem esperar download.
export function preloadGoogle() {
  if (!googleConfigured()) return null;
  sdk = sdk || Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  ]).then(([app, auth]) => {
    const a = auth.getAuth(app.initializeApp(firebaseConfig));
    return { auth, a };
  });
  return sdk;
}

// Resultado de um login por redirecionamento (quando o popup não é possível).
export async function pendingRedirectToken() {
  const m = await preloadGoogle();
  if (!m) return null;
  const r = await m.auth.getRedirectResult(m.a);
  return r ? r.user.getIdToken() : null;
}

export async function googleIdToken() {
  const m = await preloadGoogle();
  const provider = new m.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const r = await m.auth.signInWithPopup(m.a, provider);
    return r.user.getIdToken();
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await m.auth.signInWithRedirect(m.a, provider);
      return null; // a página recarrega e pendingRedirectToken() conclui
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return null;
    throw e;
  }
}

export async function googleSignOut() {
  const m = await preloadGoogle();
  if (m) await m.auth.signOut(m.a).catch(() => {});
}
