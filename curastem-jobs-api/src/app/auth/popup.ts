/**
 * GET /auth/popup
 *
 * Auth relay for environments where Firebase signInWithPopup can't run
 * directly (e.g. Framer canvas, unauthorized domains).
 *
 * Opens as a popup from the main app. Shows a "Continue with Google" button.
 * On click, calls signInWithPopup from THIS page (api.curastem.org is an
 * authorized Firebase domain), so we never navigate the popup away — keeping
 * window.opener alive. After sign-in the session token is postMessage'd back
 * to the opener, then the popup closes.
 *
 * Full-page redirect fallback: if the user's browser blocked even our popup,
 * the main app redirects here with ?return_to=<url>. We use signInWithRedirect
 * instead and bounce back with ?curastem_token= in the URL.
 *
 * Firebase authorized domains MUST include: api.curastem.org
 *
 * Contributors running their own stack (not the production Curastem Firebase
 * project) must replace the embedded `FIREBASE_CONFIG` below with their own
 * Web app config from the Firebase console, or generate this HTML at build
 * time from env vars so the relay page matches their `app/web.tsx` client.
 */

const FIREBASE_SDK_VERSION = "10.14.1"
const FIREBASE_CONFIG = JSON.stringify({
    apiKey: "AIzaSyA3LmDjf_uwzNCnvte_sQWul9e515Tnpnc",
    authDomain: "curastem.firebaseapp.com",
    projectId: "curastem",
    storageBucket: "curastem.firebasestorage.app",
    messagingSenderId: "256990056414",
    appId: "1:256990056414:web:658aeb5c85676c83e5d74f",
})

export function handleAuthPopup(): Response {
    const sdkBase = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0a;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}
    #btn{
      display:flex;align-items:center;gap:12px;padding:12px 20px;
      background:#1a1a1a;color:rgba(255,255,255,0.9);
      border:none;border-radius:999px;
      font-size:14px;font-family:inherit;cursor:pointer;transition:background 0.15s;
      -webkit-appearance:none;
    }
    #btn:hover:not(:disabled){background:#2a2a2a}
    #btn:disabled{opacity:0.5;cursor:default}
    #err{color:rgba(255,100,100,0.9);font-size:13px;margin-top:16px;text-align:center;display:none}
  </style>
</head>
<body>
  <div style="display:flex;flex-direction:column;align-items:center">
    <button id="btn">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
        <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
      </svg>
      Continue with Google
    </button>
    <div id="err"></div>
  </div>

  <script type="module">
const SDK = "${sdkBase}";
const CFG = ${FIREBASE_CONFIG};
const API = location.origin;

function showError(msg) {
  const el = document.getElementById("err");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("btn").disabled = false;
}

async function finish(payload) {
  if (window.opener) {
    // Normal popup mode — postMessage back to the opener and close.
    window.opener.postMessage({ type: "curastem_auth", ...payload }, "*");
    window.close();
    return;
  }
  const params = new URLSearchParams(location.search);
  const ret   = params.get("return_to");
  const state = params.get("state");
  if (ret && payload.token) {
    // Full-page redirect fallback — bounce back to the Framer frame with token in URL.
    const sep = ret.includes("?") ? "&" : "?";
    location.replace(ret + sep
      + "curastem_token=" + encodeURIComponent(payload.token)
      + "&curastem_user=" + encodeURIComponent(JSON.stringify(payload.user)));
  } else if (state && payload.token) {
    // Device-flow: opened in a different browser than the main app (e.g. Framer
    // on Electron opens popups in the default browser). Store the session in KV;
    // the main app polls GET /auth/pending?state= to claim it.
    try {
      await fetch(API + "/auth/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, token: payload.token, user: payload.user }),
      });
      document.body.innerHTML = \`<div style="display:flex;flex-direction:column;align-items:center;gap:12px;color:rgba(255,255,255,0.8);font-family:Inter,-apple-system,sans-serif;font-size:14px;text-align:center;padding:40px">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#34C759" stroke-width="1.5"/><path d="M7 12l3.5 3.5L17 9" stroke="#34C759" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Signed in! You can close this tab.
      </div>\`;
    } catch (err) {
      showError("Sign in failed. Please close this tab and try again.");
    }
  } else if (ret) {
    location.replace(ret);
  }
}

async function exchangeAndFinish(firebaseUser) {
  const idToken = await firebaseUser.getIdToken(true);
  const resp = await fetch(API + "/auth/firebase", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Curastem-Client": "web" },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!resp.ok) throw new Error("server-error-" + resp.status);
  const data = await resp.json();
  await finish({ token: data.token, user: data.user });
}

async function run() {
  const [appMod, authMod] = await Promise.all([
    import(SDK + "/firebase-app.js"),
    import(SDK + "/firebase-auth.js"),
  ]);
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(CFG);
  const auth = authMod.getAuth(app);
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  // Handle return from signInWithRedirect (full-page fallback path only)
  const redirectResult = await authMod.getRedirectResult(auth).catch(() => null);
  if (redirectResult?.user) {
    await exchangeAndFinish(redirectResult.user);
    return;
  }

  // Both popup-mode (window.opener set) and standalone-tab mode (opened in a
  // different browser by Framer/Electron) use the same button + signInWithPopup
  // path. signInWithPopup works fine from this top-level authorized domain page.
  document.getElementById("btn").addEventListener("click", async () => {
    document.getElementById("btn").disabled = true;
    try {
      const result = await authMod.signInWithPopup(auth, provider);
      await exchangeAndFinish(result.user);
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/popup-blocked|popup-not-allowed/i.test(msg)) {
        // signInWithPopup blocked from the relay tab too — fall back to redirect.
        try {
          await authMod.signInWithRedirect(auth, provider);
          // Page will navigate away; getRedirectResult handles it on return.
        } catch (redirErr) {
          showError("Sign in failed. Please try again.");
          document.getElementById("btn").disabled = false;
        }
      } else if (/cancelled|closed-by-user/i.test(msg)) {
        document.getElementById("btn").disabled = false;
      } else {
        finish({ error: msg });
        document.getElementById("btn").disabled = false;
      }
    }
  });
}

run().catch(err => finish({ error: err?.message ?? String(err) }));
  </script>
</body>
</html>`

    return new Response(html, {
        headers: {
            "Content-Type": "text/html;charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "SAMEORIGIN",
        },
    })
}
