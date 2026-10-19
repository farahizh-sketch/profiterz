// POST /api/reset-password  { email, password }   Header: Authorization: Bearer <admin token>
// Admin only. Sets a NEW password for a user (old passwords can never be read back).
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user || user.email !== process.env.ADMIN_EMAIL) return res.status(403).json({ error: "Admin only" });

  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) return res.status(400).json({ error: "Email and a password of 8+ characters are required" });

  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return res.status(500).json({ error: error.message });
  const target = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!target) return res.status(404).json({ error: "No user with that email" });

  const { error: e2 } = await db.auth.admin.updateUserById(target.id, { password });
  if (e2) return res.status(400).json({ error: e2.message });
  res.json({ ok: true });
};
