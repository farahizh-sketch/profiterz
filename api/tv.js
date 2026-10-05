// Vercel serverless function: POST /api/tv?secret=...
// Receives the TradingView alert and forwards it to every active user webhook.
// npm i @supabase/supabase-js @vercel/functions
const { createClient } = require("@supabase/supabase-js");
const { waitUntil } = require("@vercel/functions");
const dns = require("dns").promises;
const net = require("net");

// service-role key bypasses RLS so we can read ALL users' webhooks. Server only!
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

async function fanOut(body, isJson) {
  const { data, error } = await db.from("webhooks").select("url").eq("active", true).limit(5000);
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
  console.log(`Alert delivered to ${ok}/${data.length}`);
  results.filter((r) => r.status === "rejected").forEach((r) => console.log("  failed:", r.reason.message));
}

module.exports = (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  if (req.query.secret !== process.env.TV_SECRET) return res.status(401).end();

  const isJson = typeof req.body !== "string";
  const body = isJson ? JSON.stringify(req.body) : req.body;

  waitUntil(fanOut(body, isJson)); // keeps running after we reply
  res.status(200).json({ ok: true }); // TradingView only waits ~3s
};
