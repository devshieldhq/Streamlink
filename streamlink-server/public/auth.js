/* StreamLink XR — shared auth helper.
 *
 * Needs, loaded before this file:
 *   <script src="/config.js"></script>                       (url + publishable key, from server env)
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * If either is missing (e.g. running locally without SUPABASE_* set), everything
 * degrades quietly: SLAuth.enabled is false and the pages just behave as before —
 * no account features, but nothing breaks.
 *
 * Saved stream keys live in public.platform_credentials. The browser talks to
 * Supabase directly with the signed-in user's session; Row Level Security
 * (auth.uid() = user_id) is what stops anyone reading anyone else's keys.
 */
(function () {
  const cfg = window.__SUPABASE__ || {};
  const enabled = !!(cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient);
  const client = enabled ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  // The server decides whether signing in is mandatory (it is, whenever Supabase is
  // configured, unless REQUIRE_SIGN_IN=false). The pages follow the server's answer.
  const required = enabled && cfg.required !== false;

  async function getUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ? data.session.user : null;
  }

  async function loadCredentials() {
    if (!client) return [];
    const { data, error } = await client
      .from('platform_credentials')
      .select('platform_name, stream_key, ingest_url');
    if (error) { console.warn('Could not load saved platforms:', error.message); return []; }
    return data || [];
  }

  // list: [{ name, key?, url? }] — same shape the lobby/go-live pages already build.
  async function saveCredentials(list) {
    const user = await getUser();
    if (!client || !user || !list || !list.length) return { saved: 0 };
    const rows = list.map(p => ({
      user_id: user.id,
      platform_name: p.name,
      stream_key: p.key || null,
      ingest_url: p.url || null,
      updated_at: new Date().toISOString()
    }));
    const { error } = await client
      .from('platform_credentials')
      .upsert(rows, { onConflict: 'user_id,platform_name' });
    if (error) { console.warn('Could not save platforms:', error.message); return { saved: 0, error }; }
    return { saved: rows.length };
  }

  async function deleteCredential(platformName) {
    const user = await getUser();
    if (!client || !user) return;
    await client.from('platform_credentials').delete().eq('platform_name', platformName).eq('user_id', user.id);
  }

  // Fills inputs built by the lobby/go-live pages: <input data-platform data-field="key|url">
  function fillInputs(saved, rootSelector) {
    const root = document.querySelector(rootSelector);
    if (!root) return 0;
    let filled = 0;
    for (const row of saved) {
      const key = root.querySelector(`input[data-platform="${row.platform_name}"][data-field="key"]`);
      const url = root.querySelector(`input[data-platform="${row.platform_name}"][data-field="url"]`);
      if (key && row.stream_key && !key.value) { key.value = row.stream_key; filled++; }
      if (url && row.ingest_url && !url.value) { url.value = row.ingest_url; }
    }
    return filled;
  }

  /* ── Stream history (feeds the creator passport) ──────────────────────── */
  async function startSession(info) {
    const user = await getUser();
    if (!client || !user) return null;
    const { data, error } = await client.from('stream_sessions')
      .insert({ user_id: user.id, platform_count: (info && info.platformCount) || 0, quality: (info && info.quality) || null, via: (info && info.via) || null })
      .select('id').single();
    if (error) { console.warn('Could not record stream:', error.message); return null; }
    return data.id;
  }

  async function endSession(id) {
    if (!client || !id) return;
    await client.from('stream_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id);
  }

  async function loadStats() {
    if (!client) return null;
    const { data, error } = await client.from('stream_sessions')
      .select('started_at, ended_at, platform_count').order('started_at', { ascending: false }).limit(1000);
    if (error) { console.warn('Could not load stream history:', error.message); return null; }
    let minutes = 0, maxPlatforms = 0;
    for (const r of data) {
      maxPlatforms = Math.max(maxPlatforms, r.platform_count || 0);
      if (r.ended_at) minutes += (new Date(r.ended_at) - new Date(r.started_at)) / 60000;
    }
    return { streams: data.length, minutes: Math.round(minutes), maxPlatforms };
  }

  /* ── Wallet (Sign in with Ethereum, verified by Supabase Auth) ────────── */
  function isWalletUser(user) {
    if (!user) return false;
    return (user.app_metadata && user.app_metadata.provider === 'web3') ||
           (user.identities || []).some(i => i.provider === 'web3');
  }

  // Supabase stores the verified address on the web3 identity; check the places it can appear.
  function walletAddressOf(user) {
    if (!user) return null;
    const w = (user.identities || []).find(i => i.provider === 'web3');
    const d = (w && w.identity_data) || {};
    const um = user.user_metadata || {};
    return (d.custom_claims && d.custom_claims.address) || d.address ||
           (um.custom_claims && um.custom_claims.address) || um.address || null;
  }

  async function signInWithWallet() {
    if (!window.ethereum) {
      return { error: { message: "No browser wallet found. Install a wallet such as MetaMask, or open this page inside your wallet app's built-in browser." } };
    }
    return client.auth.signInWithWeb3({
      chain: 'ethereum',
      statement: 'Sign in to StreamLink XR. This is free and gives no access to your funds.'
    });
  }

  // Read-only balance on Base via a public RPC. Returns a number of ETH, or null if unavailable.
  async function baseBalance(address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) return null;
    try {
      const r = await fetch('https://mainnet.base.org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] })
      });
      const j = await r.json();
      if (!j.result) return null;
      return Number(BigInt(j.result) / 1000000000000n) / 1e6;
    } catch (e) { return null; }
  }


  /* ---------------- Creator wallet (Web3) ----------------
   * Linking proves ownership: the wallet signs a message naming this account,
   * and the `link-wallet` edge function verifies the signature before saving.
   * The browser can read its own wallet row but cannot write it.
   * Needs an injected wallet (MetaMask, Coinbase Wallet, a wallet app's built-in
   * browser). The Meta Quest browser has none, so link on a phone or desktop
   * and the VR room will show it. */
  function shortAddress(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }

  async function getWallet() {
    if (!client) return null;
    const { data, error } = await client.from('wallets').select('address, verified_at').maybeSingle();
    if (error) { console.warn('Could not load wallet:', error.message); return null; }
    return data || null;
  }

  async function callWalletFn(body) {
    const { data, error } = await client.functions.invoke('link-wallet', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_e) {}
      throw new Error(msg);
    }
    return data;
  }

  async function linkWallet() {
    const user = await getUser();
    if (!user) throw new Error('Sign in first.');
    const eth = window.ethereum;
    if (!eth) throw new Error('NO_WALLET');
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const address = ((accounts && accounts[0]) || '').toLowerCase();
    if (!address) throw new Error('No wallet account was shared.');
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
    const message = [
      'StreamLink XR wants to link this wallet to your account.',
      '',
      'Account: ' + user.id,
      'Wallet: ' + address,
      'Issued: ' + new Date().toISOString(),
      'Nonce: ' + nonce,
      '',
      'Signing this message is free and does not send a transaction or give StreamLink access to your funds.'
    ].join('\n');
    let signature;
    try { signature = await eth.request({ method: 'personal_sign', params: [message, address] }); }
    catch (e) { if (e && e.code === 4001) throw new Error('You cancelled the signature request.'); throw e; }
    return callWalletFn({ action: 'link', address, message, signature });
  }

  const unlinkWallet = () => callWalletFn({ action: 'unlink' });

  /* ---------------- Stream history + creator badges ----------------
   * Rows go in public.stream_sessions. They are written by the browser, so they
   * are self-reported: fine for a personal profile, not proof for anything
   * on-chain. */
  async function startSession({ platformCount, quality, via }) {
    const user = await getUser();
    if (!client || !user) return null;
    const { data, error } = await client.from('stream_sessions')
      .insert({ user_id: user.id, platform_count: platformCount || 0, quality: quality || null, via: via || null })
      .select('id').single();
    if (error) { console.warn('Could not record stream start:', error.message); return null; }
    return data.id;
  }

  async function endSession(id) {
    if (!client || !id) return;
    const { error } = await client.from('stream_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id);
    if (error) console.warn('Could not record stream end:', error.message);
  }

  async function getStats() {
    if (!client) return null;
    const { data, error } = await client.from('stream_sessions').select('started_at, ended_at, platform_count');
    if (error) { console.warn('Could not load stream history:', error.message); return null; }
    const rows = data || [];
    let totalMs = 0, longestMs = 0, maxPlatforms = 0;
    for (const r of rows) {
      maxPlatforms = Math.max(maxPlatforms, r.platform_count || 0);
      if (r.ended_at) {
        const ms = Date.parse(r.ended_at) - Date.parse(r.started_at);
        if (ms > 0) { totalMs += ms; longestMs = Math.max(longestMs, ms); }
      }
    }
    const streams = rows.length, hours = totalMs / 3600000, longestHours = longestMs / 3600000;
    return {
      streams, hours, longestHours, maxPlatforms,
      badges: [
        { id: 'first',    name: 'First broadcast', desc: 'Go live once',                     earned: streams >= 1 },
        { id: 'regular',  name: 'Regular',         desc: '10 broadcasts',                    earned: streams >= 10 },
        { id: 'multi',    name: 'Multi-platform',  desc: 'Stream to 3+ platforms at once',   earned: maxPlatforms >= 3 },
        { id: 'marathon', name: 'Marathon',        desc: 'One broadcast of 2+ hours',        earned: longestHours >= 2 }
      ]
    };
  }


  /* ---------------- Sign-in gate ----------------
   * /live and /app call requireSignIn() on load. Signed-out visitors are sent to
   * /account.html and brought back to the page they wanted once they're in.
   * This is the friendly half; the server enforces the real rule (every call that
   * starts, feeds or controls a stream needs a valid token), so skipping this
   * script gets nobody anywhere. */
  const NEXT_KEY = 'sl_next';
  const NEXT_PATHS = { '/live': '/live', '/go-live.html': '/live', '/app': '/app', '/streamlink-xr.html': '/app' };

  async function requireSignIn() {
    if (!required) return null;
    const user = await getUser();
    if (user) return user;
    try {
      localStorage.setItem(NEXT_KEY, JSON.stringify({ path: NEXT_PATHS[window.location.pathname] || '/live', t: Date.now() }));
    } catch (_e) {}
    window.location.replace('/account.html?reason=signin');
    return new Promise(() => {}); // the page is navigating away — never carry on
  }

  // Where to send someone after they finish signing in (only ever /live or /app).
  function consumeNext() {
    try {
      const raw = localStorage.getItem(NEXT_KEY);
      if (!raw) return null;
      localStorage.removeItem(NEXT_KEY);
      const { path, t } = JSON.parse(raw);
      if (path !== '/live' && path !== '/app') return null;
      if (Date.now() - t > 30 * 60 * 1000) return null; // stale
      return path;
    } catch (_e) { return null; }
  }

  async function getToken() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  // fetch() that carries the signed-in user's token. If the server says 401 (the
  // token just expired), refresh the session once and retry.
  async function authedFetch(url, opts) {
    opts = opts || {};
    const send = async () => {
      const token = await getToken();
      const headers = Object.assign({}, opts.headers || {});
      if (token) headers.Authorization = 'Bearer ' + token;
      return fetch(url, Object.assign({}, opts, { headers }));
    };
    let res = await send();
    if (res.status === 401 && client) {
      const { error } = await client.auth.refreshSession();
      if (!error) res = await send();
    }
    return res;
  }

  // Socket.IO options; the token is looked up fresh on every (re)connect.
  function socketOptions() {
    const o = { transports: ['websocket'] };
    if (enabled) o.auth = (cb) => { getToken().then((t) => cb({ token: t })); };
    return o;
  }

  window.SLAuth = {
    enabled,
    required,
    client,
    getUser,
    loadCredentials,
    saveCredentials,
    deleteCredential,
    fillInputs,
    shortAddress,
    getWallet,
    linkWallet,
    unlinkWallet,
    startSession,
    endSession,
    getStats,
    requireSignIn,
    consumeNext,
    getToken,
    fetch: authedFetch,
    socketOptions,
    startSession,
    endSession,
    loadStats,
    isWalletUser,
    walletAddressOf,
    baseBalance,
    signInWithWallet: () => signInWithWallet(),

    // Same call signs someone in or creates their account — Supabase makes the
    // user on first use of an address. (Needs custom SMTP to reach real users.)
    sendMagicLink: (email) => client.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin + '/account.html' }
    }),
    // Needs the Google provider enabled in Supabase → Authentication → Providers.
    signInWithGoogle: () => client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin + '/account.html' }
    }),
    signOut: () => client.auth.signOut(),
    onChange: (cb) => client ? client.auth.onAuthStateChange((_e, session) => cb(session ? session.user : null)) : null
  };
})();
