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

  window.SLAuth = {
    enabled,
    client,
    getUser,
    loadCredentials,
    saveCredentials,
    deleteCredential,
    fillInputs,

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
