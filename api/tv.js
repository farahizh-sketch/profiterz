// POST /api/tv?secret=...&strategy=gold&action=buy_exit
// strategy: gold | nifty10 | nifty12     action: buy | buy_exit | sell | sell_exit
// (strategy/action may also come as fields in a JSON alert body)
// Forwards the alert only to users who saved a webhook for that strategy + action.
const { createClient } = require("@supabase/supabase-js");
const { waitUntil } = require("@vercel/functions");
const dns = require("dns").promises;
const net = require("net");

const STRATEGIES = ["gold", "nifty10", "nifty12"];
const ACTIONS = ["buy", "buy_exit", "sell", "sell_exit"];
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const isPrivate = (ip) =>
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip) ||
  ip === "::1" || /^(fc|fd|fe80)/i.test(ip);

async function isSafe(u) {
  const url = new URL(u);
  if (url.protocol !== "https:") return false;
  const ip = net.isIP(url.hostname) ? url.hostname : (await dns.lookup(url.hostname)).address;
  return !isPrivate(ip);
}

async function fanOut(strategy, action, body, isJson) {
  const { data, error } = await db.from("webhooks").select("url")
    .eq("strategy", strategy).eq("action", action).eq("active", true).limit(5000);
  if (error) return console.error("db error", error.message);

  const results = await Promise.allSettled(data.map(async ({ url }) => {
    if (!(await isSafe(url))) throw new Error("blocked: " + url);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": isJson ? "application/json" : "text/plain" },
      body,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  }));

  const ok = results.filter((r) => r.status === "fulfilled").length;
  console.log(`${strategy}/${action}: delivered to ${ok}/${data.length}`);
  results.filter((r) => r.status === "rejected").forEach((r) => console.log("  failed:", r.reason.message));
}

module.exports = (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  if (req.query.secret !== process.env.TV_SECRET) return res.status(401).end();

  const isJson = typeof req.body !== "string";
  const body = isJson ? JSON.stringify(req.body) : req.body;
  const b = isJson && req.body ? req.body : {};
  const strategy = String(req.query.strategy || b.strategy || "").toLowerCase();
  const action = String(req.query.action || b.action || "").toLowerCase().replace(/[\s-]+/g, "_");

  if (!STRATEGIES.includes(strategy) || !ACTIONS.includes(action))
    return res.status(400).json({ error: "Unknown strategy or action", strategy, action });

  waitUntil(fanOut(strategy, action, body, isJson));
  res.status(200).json({ ok: true });
};
