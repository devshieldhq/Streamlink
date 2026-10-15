// link-wallet — proves a person controls a wallet, then links it to their account.
//
// Flow: the browser asks the wallet to sign a human-readable message that names
// the account and wallet and carries a timestamp. We recover the signer from the
// signature, check it matches the claimed wallet, and only then write the link
// using the service role. Users can read their own row in public.wallets but have
// no write policy, so a "verified" row can only come from this function.
//
// JWT verification is done in the handler (admin.auth.getUser) rather than by the
// platform flag, so it works regardless of the project's JWT signing-key setup.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage, isAddress } from "npm:ethers@6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HEADER_LINE = "StreamLink XR wants to link this wallet to your account.";
const MAX_AGE_MS = 5 * 60 * 1000;   // a signed request is good for 5 minutes
const MAX_SKEW_MS = 2 * 60 * 1000;  // tolerate a slightly fast client clock

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Pure check — no network, no database — so it can be tested on its own.
export function checkLinkRequest(body, userId, now = Date.now()) {
  const { address, message, signature } = body || {};
  const bad = (error, status = 400) => ({ ok: false, status, error });

  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string")
    return bad("Missing address, message or signature.");
  if (message.length > 1000 || signature.length > 200) return bad("Request too large.");
  if (!isAddress(address)) return bad("That doesn't look like a wallet address.");

  const lines = message.split("\n");
  if (lines[0] !== HEADER_LINE) return bad("Unrecognised message.");
  const field = (name) => {
    const line = lines.find((l) => l.startsWith(name + ": "));
    return line ? line.slice(name.length + 2).trim() : null;
  };

  if (field("Account") !== userId) return bad("This message was made for a different account.");
  if (field("Wallet") !== address.toLowerCase()) return bad("The message and wallet don't match.");

  const issued = Date.parse(field("Issued") || "");
  if (!Number.isFinite(issued)) return bad("The message has no valid timestamp.");
  const age = now - issued;
  if (age > MAX_AGE_MS || age < -MAX_SKEW_MS) return bad("This request expired. Please try again.");

  let recovered;
  try { recovered = verifyMessage(message, signature); }
  catch (_e) { return bad("That signature isn't valid."); }
  if (recovered.toLowerCase() !== address.toLowerCase())
    return bad("The signature doesn't match that wallet.");

  return { ok: true, address: address.toLowerCase() };
}

async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data || !data.user) return json({ error: "Your session has expired. Please sign in again." }, 401);
  const user = data.user;

  let body;
  try { body = await req.json(); } catch (_e) { return json({ error: "Bad request." }, 400); }

  if (body.action === "unlink") {
    const { error: delErr } = await admin.from("wallets").delete().eq("user_id", user.id);
    if (delErr) return json({ error: "Could not unlink the wallet." }, 500);
    return json({ ok: true });
  }
  if (body.action !== "link") return json({ error: "Unknown action." }, 400);

  const check = checkLinkRequest(body, user.id);
  if (!check.ok) return json({ error: check.error }, check.status);

  const { error: upErr } = await admin
    .from("wallets")
    .upsert({ user_id: user.id, address: check.address, verified_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (upErr) {
    if (upErr.code === "23505") return json({ error: "That wallet is already linked to another account." }, 409);
    return json({ error: "Could not save the wallet." }, 500);
  }
  return json({ ok: true, address: check.address });
}

if (typeof Deno !== "undefined") Deno.serve(handler);
