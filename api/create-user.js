// POST /api/create-user  { email, password }   Header: Authorization: Bearer <admin's session token>
// Only the account whose email equals ADMIN_EMAIL can call this.
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user || user.email !== process.env.ADMIN_EMAIL) return res.status(403).json({ error: "Admin only" });

  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) return res.status(400).json({ error: "Email and a password of 8+ characters are required" });

  const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true }); // no email sent
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
};
