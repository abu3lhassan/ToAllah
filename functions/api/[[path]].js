function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getPathParts(context) {
  const raw = context.params?.path;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") return raw.split("/").filter(Boolean);
  return [];
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function now() { return new Date().toISOString(); }
function newId(prefix = "id") { return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`; }

function getHijriPartsServer(date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  return { year: Number(parts.find(p => p.type === 'year').value), month: Number(parts.find(p => p.type === 'month').value), day: Number(parts.find(p => p.type === 'day').value) };
}
function hijriMonthEndDateServer(date) {
  const d = new Date(date instanceof Date ? date : new Date(date));
  d.setUTCHours(12, 0, 0, 0);
  const { year: y, month: m } = getHijriPartsServer(d);
  for (let i = 0; i < 35; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const n = getHijriPartsServer(d);
    if (n.year !== y || n.month !== m) {
      d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(20, 59, 59, 999); // = 23:59:59 UTC+3 (Saudi time)
      return new Date(d);
    }
  }
  d.setUTCHours(20, 59, 59, 999); // = 23:59:59 UTC+3 (Saudi time)
  return new Date(d);
}
function computeRotationPeriodEnd(rotationStartDate, rotationType) {
  if (!rotationStartDate || !rotationType || rotationType === 'none') return null;
  const now = new Date();
  if (rotationType === 'monthly') {
    // Use rotationStartDate as reference when the khatma hasn't started yet,
    // so the period end is the end of the khatma's first Hijri month, not today's.
    const start = new Date(rotationStartDate);
    const refDate = (!isNaN(start) && start > now) ? start : now;
    return hijriMonthEndDateServer(refDate);
  }
  if (rotationType === 'weekly') {
    const start = new Date(rotationStartDate);
    if (isNaN(start)) return null;
    // Math.max(0,...) prevents negative idx when khatma start date is in the future
    // Workers run in UTC so new Date("YYYY-MM-DD") = midnight UTC is correct here
    const idx = Math.max(0, Math.floor((now - start) / (7 * 86400000)));
    // end = last second of the last day of current week (start of next week − 1s)
    const end = new Date(start.getTime() + (idx + 1) * 7 * 86400000 - 1000);
    return end;
  }
  return null;
}
function adminCode() { return String(Math.floor(10000000 + Math.random() * 90000000)); }

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, username) {
  return "v2:" + await sha256Hex(`darb-alzahra:${username}:${password}`);
}
async function verifyPassword(storedHash, password, username) {
  if ((storedHash || "").startsWith("v2:")) return storedHash === await hashPassword(password, username);
  return storedHash === await sha256Hex(password);
}
async function checkRateLimit(DB, ip) {
  try {
    const window = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const row = await DB.prepare("SELECT COUNT(*) AS cnt FROM login_attempts WHERE ip = ? AND attempted_at > ?").bind(ip, window).first();
    return Number(row?.cnt || 0) < 10;
  } catch { return true; }
}
async function recordFailedLogin(DB, ip) {
  try {
    const t = now();
    await DB.batch([
      DB.prepare("INSERT INTO login_attempts (id, ip, attempted_at) VALUES (?, ?, ?)").bind(newId("atmp"), ip, t),
      DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(new Date(Date.now() - 3600000).toISOString())
    ]);
  } catch {}
}

function unitMeta(division) {
  if (division === "hizb") return { total: 60, label: "الحزب" };
  if (division === "quarter") return { total: 240, label: "الربع" };
  return { total: 30, label: "الجزء" };
}

function normalizePhone(value = "") {
  let digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("9665") && digits.length === 12) digits = "0" + digits.slice(3);
  else if (digits.startsWith("5") && digits.length === 9) digits = "0" + digits;
  return digits;
}

const KHATMA_TYPES = new Set(["weekly", "monthly", "yearly", "special", "separate", "sub", "specific"]);
function normalizeKhatmaType(value = "") {
  const raw = String(value || "").trim();
  const aliases = {
    "أسبوعية": "weekly",
    "الأسبوعية": "weekly",
    "شهرية": "monthly",
    "الشهرية": "monthly",
    "سنوية": "yearly",
    "السنوية": "yearly",
    "خاصة": "special",
    "الخاصة": "special",
    "منفصلة": "separate",
    "المنفصلة": "separate",
    "فرعية": "sub",
    "الفرعية": "sub",
    "محددة": "specific",
    "المحددة": "specific"
  };
  if (KHATMA_TYPES.has(raw)) return raw;
  return aliases[raw] || "monthly";
}

function normalizeAccessCode(value = "") {
  return String(value || "").replace(/[^0-9]/g, "");
}

function isValidAccessCode(value = "") {
  return /^[0-9]{4,10}$/.test(String(value || ""));
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    managedKhatmaCreator: Boolean(row.managedKhatmaCreator || row.managed_khatma_creator),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function publicUserWithManagedPermission(DB, row) {
  if (!row) return null;
  await ensureManagedSchema(DB);
  return { ...publicUser(row), managedKhatmaCreator: row.role === "owner" || await hasManagedPermission(DB, row) };
}

function mapKhatma(row, units = []) {
  return {
    id: row.id,
    title: row.title,
    weekNumber: row.week_number || "",
    khatmaType: row.khatma_type || "monthly",
    khatmaDate: row.khatma_date || "",
    hijriDate: row.hijri_date || "",
    gregorianDate: row.gregorian_date || "",
    expiresAt: row.expires_at || "",
    division: row.division || "juz",
    selectionMode: row.selection_mode || "all",
    ownerName: row.owner_name || "",
    ownerKey: row.owner_key || "",
    coordinatorName: row.coordinator_name || "",
    coordinatorWhatsapp: row.coordinator_whatsapp || "",
    createdByUserId: row.created_by_user_id || "",
    dedication: row.dedication || "",
    quoteBy: row.quote_by || "",
    quoteText: row.quote_text || "",
    quoteSource: row.quote_source || "",
    notes: row.notes || "",
    status: row.status || "active",
    createdAt: row.created_at || "",
    closedAt: row.closed_at || "",
    units: units.map(u => ({
      id: u.id,
      number: u.unit_number,
      label: u.label,
      status: u.status,
      participantName: u.participant_name || "",
      reservedAt: u.reserved_at || "",
      readingAt: u.reading_at || "",
      completedAt: u.completed_at || ""
    }))
  };
}

async function currentUser(request, DB) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const row = await DB.prepare(`
    SELECT users.*
    FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token = ?
      AND user_sessions.expires_at > ?
      AND users.status = 'active'
    LIMIT 1
  `).bind(token, now()).first();
  return row || null;
}

async function requireOwner(request, DB) {
  const user = await currentUser(request, DB);
  if (!user) return { ok: false, response: json({ ok: false, error: "تسجيل الدخول مطلوب" }, 401) };
  if (user.role !== "owner") return { ok: false, response: json({ ok: false, error: "هذه الصفحة مخصصة للمالك فقط" }, 403) };
  return { ok: true, user };
}


async function login(request, DB) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return json({ ok: false, error: "اسم المستخدم وكلمة المرور مطلوبة" }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!await checkRateLimit(DB, ip)) return json({ ok: false, error: "تجاوزت عدد محاولات الدخول، انتظر 15 دقيقة" }, 429);
  const user = await DB.prepare("SELECT * FROM users WHERE username = ? AND status = 'active' LIMIT 1").bind(username).first();
  if (!user || !await verifyPassword(user.password_hash, password, username)) {
    await recordFailedLogin(DB, ip);
    return json({ ok: false, error: "بيانات الدخول غير صحيحة" }, 401);
  }
  if (!(user.password_hash || "").startsWith("v2:")) {
    const upgraded = await hashPassword(password, username);
    await DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(upgraded, now(), user.id).run();
  }
  const token = newId("sess");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await DB.prepare("INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(token, user.id, createdAt, expiresAt).run();
  return json({ ok: true, token, user: await publicUserWithManagedPermission(DB, user) });
}

async function me(request, DB) {
  const user = await currentUser(request, DB);
  return json({ ok: true, user: await publicUserWithManagedPermission(DB, user) });
}

async function logout(request, DB) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token) await DB.prepare("DELETE FROM user_sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
}

async function listUsers(request, DB) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  const rows = await DB.prepare(`
    SELECT
      users.id,
      users.username,
      users.display_name,
      users.role,
      users.status,
      users.created_at,
      users.updated_at,
      CASE WHEN managed_khatma_permissions.status = 'active' THEN 1 ELSE 0 END AS managedKhatmaCreator
    FROM users
    LEFT JOIN managed_khatma_permissions ON managed_khatma_permissions.user_id = users.id
    WHERE users.status != 'deleted'
    ORDER BY users.created_at DESC
  `).all();
  return json({ ok: true, users: rows.results || [] });
}

async function createUser(request, DB) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || body.display_name || username).trim();
  const password = String(body.password || "").trim();
  const role = body.role === "owner" ? "owner" : "creator";

  if (!username || !password) return json({ ok: false, error: "اسم المستخدم وكلمة المرور مطلوبة" }, 400);

  const existing = await DB.prepare("SELECT id FROM users WHERE username = ? LIMIT 1").bind(username).first();
  if (existing) {
    return json({ ok: false, error: "اسم المستخدم موجود مسبقًا. احذف المستخدم أولًا ثم أعد المحاولة." }, 409);
  }

  const id = newId("user");
  const t = now();
  await DB.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).bind(id, username, displayName, await hashPassword(password, username), role, t, t).run();

  const user = await DB.prepare("SELECT id, username, display_name, role, status, created_at, updated_at FROM users WHERE id = ?").bind(id).first();
  return json({ ok: true, user: publicUser(user) }, 201);
}

async function resetUserPassword(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const password = String(body.password || "").trim();
  if (!password) return json({ ok: false, error: "كلمة المرور الجديدة مطلوبة" }, 400);
  const target = await DB.prepare("SELECT username FROM users WHERE id = ? LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  await DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(password, target.username), now(), id).run();
  await DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id).run();
  return json({ ok: true });
}

async function setUserStatus(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const status = body.status === "disabled" ? "disabled" : "active";
  await DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
  if (status === "disabled") await DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id).run();
  return json({ ok: true });
}

async function deleteUser(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const target = await DB.prepare("SELECT id, role, username FROM users WHERE id = ? LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  if (target.role === "owner") return json({ ok: false, error: "لا يمكن حذف حساب المالك" }, 400);
  await DB.batch([
    DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id),
    DB.prepare("UPDATE users SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now(), id)
  ]);
  return json({ ok: true, deleted: true, username: target.username });
}

async function setManagedUserPermission(request, DB, id) {
  await ensureManagedSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const enabled = body.enabled === true || body.status === "active";
  const target = await DB.prepare("SELECT id, role FROM users WHERE id = ? AND status != 'deleted' LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  if (target.role === "owner") return json({ ok: true, enabled: true, implicit: true });
  const t = now();
  const existing = await DB.prepare("SELECT user_id FROM managed_khatma_permissions WHERE user_id = ? LIMIT 1").bind(id).first();
  if (existing) {
    await DB.prepare("UPDATE managed_khatma_permissions SET status = ?, updated_at = ? WHERE user_id = ?").bind(enabled ? "active" : "disabled", t, id).run();
  } else {
    await DB.prepare(`
      INSERT INTO managed_khatma_permissions (user_id, status, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, enabled ? "active" : "disabled", check.user.id, t, t).run();
  }
  return json({ ok: true, enabled });
}

async function ensureManagedSchema(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_khatma_permissions (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_khatmas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      week_number TEXT,
      khatma_type TEXT NOT NULL DEFAULT 'monthly',
      khatma_date TEXT,
      hijri_date TEXT,
      gregorian_date TEXT,
      expires_at TEXT,
      division TEXT NOT NULL DEFAULT 'juz',
      selection_mode TEXT NOT NULL DEFAULT 'all',
      owner_name TEXT,
      created_by_user_id TEXT NOT NULL,
      coordinator_name TEXT,
      coordinator_whatsapp TEXT,
      dedication TEXT,
      quote_by TEXT,
      quote_text TEXT,
      quote_source TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      closed_at TEXT,
      deleted_at TEXT,
      archived_at TEXT
    )
  `).run();
  try { await DB.prepare("ALTER TABLE managed_khatmas ADD COLUMN archived_at TEXT").run(); } catch {}
  try { await DB.prepare("ALTER TABLE managed_khatmas ADD COLUMN shared_creator_group_id TEXT").run(); } catch {}
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_khatma_participants (
      id TEXT PRIMARY KEY,
      khatma_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      phone TEXT,
      access_code TEXT NOT NULL,
      reader_profile_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(khatma_id, access_code)
    )
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_khatma_units (
      id TEXT PRIMARY KEY,
      khatma_id TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      participant_id TEXT,
      reading_at TEXT,
      completed_at TEXT,
      updated_at TEXT,
      UNIQUE(khatma_id, unit_number)
    )
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_reader_profiles (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      reader_name TEXT NOT NULL,
      phone TEXT,
      access_code TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(created_by_user_id, access_code)
    )
  `).run();
  await DB.batch([
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_permissions_status ON managed_khatma_permissions(status)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_khatmas_created_by ON managed_khatmas(created_by_user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_khatmas_deleted_at ON managed_khatmas(deleted_at)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_participants_khatma ON managed_khatma_participants(khatma_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_units_khatma ON managed_khatma_units(khatma_id, unit_number)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_units_status ON managed_khatma_units(status)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_readers_created_by ON managed_reader_profiles(created_by_user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_readers_status ON managed_reader_profiles(status)")
  ]);
}

async function ensureKhatmaTemplateSchema(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS khatma_templates (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_khatma_templates_created_by ON khatma_templates(created_by_user_id, updated_at)").run();
}

function sanitizeKhatmaTemplateData(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const textFields = [
    "title", "weekNumber", "khatmaType", "khatmaDate", "hijriDate", "gregorianDate", "expiresAt",
    "division", "selectionMode", "coordinatorName", "coordinatorWhatsapp", "quoteBy", "quoteSource",
    "quoteText", "dedication", "notes"
  ];
  const out = {};
  for (const field of textFields) {
    if (source[field] !== undefined && source[field] !== null) out[field] = String(source[field]).slice(0, 8000);
  }
  if (Array.isArray(source.selectedUnits)) {
    out.selectedUnits = [...new Set(source.selectedUnits.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 240))].sort((a, b) => a - b);
  }
  if (out.khatmaType) out.khatmaType = normalizeKhatmaType(out.khatmaType);
  if (out.division && !["juz", "hizb", "quarter"].includes(out.division)) out.division = "juz";
  if (out.selectionMode && out.selectionMode !== "custom") out.selectionMode = "all";
  if (out.coordinatorWhatsapp) out.coordinatorWhatsapp = normalizePhone(out.coordinatorWhatsapp);
  return out;
}

function mapKhatmaTemplate(row) {
  let data = {};
  try { data = JSON.parse(row.data || "{}"); } catch { data = {}; }
  return {
    id: row.id,
    name: row.name,
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listKhatmaTemplates(request, DB) {
  await ensureKhatmaTemplateSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const rows = (await DB.prepare("SELECT * FROM khatma_templates WHERE created_by_user_id = ? ORDER BY updated_at DESC").bind(check.user.id).all()).results || [];
  return json({ ok: true, templates: rows.map(mapKhatmaTemplate) });
}

async function createKhatmaTemplate(request, DB) {
  await ensureKhatmaTemplateSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "اسم القالب مطلوب" }, 400);
  const data = sanitizeKhatmaTemplateData(body.data || {});
  const id = newId("ktpl");
  const t = now();
  await DB.prepare(`
    INSERT INTO khatma_templates (id, created_by_user_id, name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, check.user.id, name.slice(0, 120), JSON.stringify(data), t, t).run();
  const row = await DB.prepare("SELECT * FROM khatma_templates WHERE id = ? LIMIT 1").bind(id).first();
  return json({ ok: true, template: mapKhatmaTemplate(row) }, 201);
}

async function deleteKhatmaTemplate(request, DB, id) {
  await ensureKhatmaTemplateSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT * FROM khatma_templates WHERE id = ? LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "القالب غير موجود" }, 404);
  if (row.created_by_user_id !== check.user.id) return json({ ok: false, error: "لا تملك صلاحية حذف هذا القالب" }, 403);
  await DB.prepare("DELETE FROM khatma_templates WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: true });
}

let _creatorGroupSchemaReady = false;
async function ensureCreatorGroupSchema(DB) {
  if (_creatorGroupSchemaReady) return;
  await DB.prepare(`CREATE TABLE IF NOT EXISTS managed_creator_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT,
    created_by_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS managed_creator_group_members (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, user_id TEXT NOT NULL,
    added_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(group_id, user_id))`).run();
  await DB.batch([
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_groups_owner ON managed_creator_groups(created_by_user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_group_members_group ON managed_creator_group_members(group_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_group_members_user ON managed_creator_group_members(user_id)")
  ]);
  _creatorGroupSchemaReady = true;
}
async function getCreatorGroupMemberIds(DB, userId) {
  const groups = (await DB.prepare("SELECT group_id FROM managed_creator_group_members WHERE user_id = ?").bind(userId).all()).results || [];
  if (!groups.length) return [userId];
  const gIds = groups.map(r => r.group_id);
  const members = (await DB.prepare(`SELECT DISTINCT user_id FROM managed_creator_group_members WHERE group_id IN (${gIds.map(()=>"?").join(",")})`).bind(...gIds).all()).results || [];
  return [...new Set([userId, ...members.map(r => r.user_id)])];
}
async function getUserGroupIds(DB, userId) {
  try {
    const rows = (await DB.prepare("SELECT group_id FROM managed_creator_group_members WHERE user_id = ?").bind(userId).all()).results || [];
    return rows.map(r => r.group_id);
  } catch { return []; }
}
async function listCreatorGroups(request, DB) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const groups = (await DB.prepare("SELECT * FROM managed_creator_groups WHERE status != 'deleted' ORDER BY created_at DESC").all()).results || [];
  const result = [];
  for (const g of groups) {
    const members = (await DB.prepare(`
      SELECT mcgm.user_id, u.display_name, u.username
      FROM managed_creator_group_members mcgm
      LEFT JOIN users u ON u.id = mcgm.user_id
      WHERE mcgm.group_id = ?`).bind(g.id).all()).results || [];
    result.push({ ...g, members });
  }
  return json({ ok: true, groups: result });
}
async function createCreatorGroup(request, DB) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "اسم المجموعة مطلوب" }, 400);
  const id = newId("cgroup"); const t = now();
  await DB.prepare("INSERT INTO managed_creator_groups (id, name, notes, created_by_user_id, status, created_at, updated_at) VALUES (?,?,?,?,'active',?,?)").bind(id, name, body.notes || "", check.user.id, t, t).run();
  return json({ ok: true, group: { id, name, notes: body.notes || "", members: [] } }, 201);
}
async function deleteCreatorGroup(request, DB, id) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  await DB.batch([
    DB.prepare("DELETE FROM managed_creator_group_members WHERE group_id = ?").bind(id),
    DB.prepare("UPDATE managed_creator_groups SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now(), id)
  ]);
  return json({ ok: true, deleted: true });
}
async function addCreatorGroupMember(request, DB, groupId) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const userId = String(body.userId || body.user_id || "").trim();
  if (!userId) return json({ ok: false, error: "معرف المستخدم مطلوب" }, 400);
  const user = await DB.prepare("SELECT id, display_name, username FROM users WHERE id = ? AND status = 'active' LIMIT 1").bind(userId).first();
  if (!user) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  const id = newId("cgmember"); const t = now();
  try {
    await DB.prepare("INSERT INTO managed_creator_group_members (id, group_id, user_id, added_by_user_id, created_at) VALUES (?,?,?,?,?)").bind(id, groupId, userId, check.user.id, t).run();
  } catch { return json({ ok: false, error: "المستخدم موجود مسبقًا في المجموعة" }, 409); }
  return json({ ok: true, member: { userId, displayName: user.display_name, username: user.username } }, 201);
}
async function removeCreatorGroupMember(request, DB, groupId, userId) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  await DB.prepare("DELETE FROM managed_creator_group_members WHERE group_id = ? AND user_id = ?").bind(groupId, userId).run();
  return json({ ok: true });
}
async function creatorGroupDashboard(request, DB, groupId) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const memberIds = await getCreatorGroupMemberIds(DB, check.user.id);
  const inClause = memberIds.map(() => "?").join(",");
  const [openKhatmas, closedKhatmas, completedUnits, readingUnits, topReaders] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS cnt FROM managed_khatmas WHERE deleted_at IS NULL AND status = 'active' AND created_by_user_id IN (${inClause})`).bind(...memberIds).first(),
    DB.prepare(`SELECT COUNT(*) AS cnt FROM managed_khatmas WHERE deleted_at IS NULL AND status = 'closed' AND created_by_user_id IN (${inClause})`).bind(...memberIds).first(),
    DB.prepare(`SELECT COUNT(*) AS cnt FROM managed_khatma_units mku JOIN managed_khatmas mk ON mk.id = mku.khatma_id AND mk.deleted_at IS NULL AND mk.created_by_user_id IN (${inClause}) WHERE mku.status = 'completed'`).bind(...memberIds).first(),
    DB.prepare(`SELECT COUNT(*) AS cnt FROM managed_khatma_units mku JOIN managed_khatmas mk ON mk.id = mku.khatma_id AND mk.deleted_at IS NULL AND mk.created_by_user_id IN (${inClause}) WHERE mku.status = 'reading'`).bind(...memberIds).first(),
    DB.prepare(`SELECT mcp.participant_name, COUNT(*) AS cnt FROM managed_khatma_units mku JOIN managed_khatma_participants mcp ON mcp.id = mku.participant_id JOIN managed_khatmas mk ON mk.id = mku.khatma_id AND mk.deleted_at IS NULL AND mk.created_by_user_id IN (${inClause}) WHERE mku.status = 'completed' GROUP BY mcp.participant_name ORDER BY cnt DESC LIMIT 10`).bind(...memberIds).all()
  ]);
  return json({ ok: true, stats: {
    openKhatmas: openKhatmas?.cnt || 0, closedKhatmas: closedKhatmas?.cnt || 0,
    completedUnits: completedUnits?.cnt || 0, readingUnits: readingUnits?.cnt || 0,
    topReaders: (topReaders.results || []).map(r => ({ name: r.participant_name, count: r.cnt }))
  }});
}

let _groupSchemaReady = false;
async function ensureGroupSchema(DB) {
  if (_groupSchemaReady) return;
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS managed_reader_groups (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      notes TEXT,
      rotation_type TEXT NOT NULL DEFAULT 'monthly',
      rotation_start_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await DB.batch([
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_groups_created_by ON managed_reader_groups(created_by_user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_managed_groups_status ON managed_reader_groups(status)")
  ]);
  const addCols = [
    "ALTER TABLE managed_reader_profiles ADD COLUMN group_id TEXT",
    "ALTER TABLE managed_reader_profiles ADD COLUMN start_juz INTEGER",
    "ALTER TABLE managed_reader_profiles ADD COLUMN parts_count INTEGER",
    "ALTER TABLE managed_khatmas ADD COLUMN group_id TEXT",
    "ALTER TABLE managed_khatmas ADD COLUMN rotation_start_date TEXT",
    "ALTER TABLE managed_khatma_participants ADD COLUMN start_juz INTEGER",
    "ALTER TABLE managed_khatma_participants ADD COLUMN parts_count INTEGER"
  ];
  await Promise.allSettled([
    ...addCols.map(sql => DB.prepare(sql).run()),
    DB.prepare("ALTER TABLE managed_reader_groups ADD COLUMN rotation_duration_years INTEGER DEFAULT 5").run(),
    DB.prepare("ALTER TABLE managed_khatmas ADD COLUMN rotation_duration_years INTEGER DEFAULT 5").run(),
    DB.prepare("ALTER TABLE managed_reader_profiles ADD COLUMN shared_creator_group_id TEXT").run(),
    DB.prepare("ALTER TABLE managed_reader_groups ADD COLUMN shared_creator_group_id TEXT").run()
  ]);
  _groupSchemaReady = true;
}

async function listReaderGroups(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  let rows;
  if (check.user.role === "owner") {
    rows = (await DB.prepare("SELECT * FROM managed_reader_groups WHERE status != 'deleted' ORDER BY created_at DESC").all()).results || [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds2 = await getUserGroupIds(DB, check.user.id);
    let rgQuery, rgParams;
    if (userGroupIds2.length) {
      const sharedRgClause = `OR (shared_creator_group_id IS NOT NULL AND shared_creator_group_id IN (${userGroupIds2.map(()=>"?").join(",")}))`;
      rgQuery = `SELECT * FROM managed_reader_groups WHERE status != 'deleted' AND (created_by_user_id IN (${visibleIds.map(()=>"?").join(",")}) ${sharedRgClause}) ORDER BY created_at DESC`;
      rgParams = [...visibleIds, ...userGroupIds2];
    } else {
      rgQuery = `SELECT * FROM managed_reader_groups WHERE status != 'deleted' AND created_by_user_id IN (${visibleIds.map(()=>"?").join(",")}) ORDER BY created_at DESC`;
      rgParams = visibleIds;
    }
    rows = (await DB.prepare(rgQuery).bind(...rgParams).all()).results || [];
  }
  const groupIds = rows.map(r => r.id);
  let countMap = {};
  if (groupIds.length) {
    const counts = (await DB.prepare(
      `SELECT group_id, COUNT(*) AS cnt FROM managed_reader_profiles WHERE status != 'deleted' AND group_id IN (${groupIds.map(() => "?").join(",")}) GROUP BY group_id`
    ).bind(...groupIds).all()).results || [];
    countMap = Object.fromEntries(counts.map(c => [c.group_id, c.cnt]));
  }
  return json({ ok: true, groups: rows.map(r => ({ ...r, readerCount: countMap[r.id] || 0, rotationDurationYears: r.rotation_duration_years || 5 })) });
}

async function createReaderGroup(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "اسم المجموعة مطلوب" }, 400);
  const rotationType = ["weekly","monthly","yearly","special","separate","sub","specific","none"].includes(body.rotationType || body.rotation_type) ? (body.rotationType || body.rotation_type) : "monthly";
  const rotationStartDate = body.rotationStartDate || body.rotation_start_date || "";
  const rotationDurationYears = Math.min(15, Math.max(1, Number(body.rotationDurationYears || body.rotation_duration_years || 5) || 5));
  const id = newId("mgroup");
  const t = now();
  await DB.prepare(`
    INSERT INTO managed_reader_groups (id, created_by_user_id, name, notes, rotation_type, rotation_start_date, rotation_duration_years, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).bind(id, check.user.id, name, body.notes || "", rotationType, rotationStartDate || null, rotationDurationYears, t, t).run();
  const group = await DB.prepare("SELECT * FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(id).first();
  return json({ ok: true, group: { ...group, readerCount: 0 } }, 201);
}

async function updateReaderGroup(request, DB, id) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "اسم المجموعة مطلوب" }, 400);
  const row = await DB.prepare("SELECT * FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(row.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية تعديل هذه المجموعة" }, 403);
  }
  const rotationType = ["weekly","monthly","yearly","special","separate","sub","specific","none"].includes(body.rotationType || body.rotation_type) ? (body.rotationType || body.rotation_type) : row.rotation_type;
  const rotationStartDate = body.rotationStartDate || body.rotation_start_date || row.rotation_start_date || "";
  const rotationDurationYears = Math.min(15, Math.max(1, Number(body.rotationDurationYears || body.rotation_duration_years || row.rotation_duration_years || 5) || 5));
  await DB.prepare(`
    UPDATE managed_reader_groups SET name = ?, notes = ?, rotation_type = ?, rotation_start_date = ?, rotation_duration_years = ?, updated_at = ? WHERE id = ?
  `).bind(name, body.notes || "", rotationType, rotationStartDate || null, rotationDurationYears, now(), id).run();
  return json({ ok: true });
}

async function deleteReaderGroup(request, DB, id) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT * FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(row.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية حذف هذه المجموعة" }, 403);
  }
  await DB.batch([
    DB.prepare("UPDATE managed_reader_profiles SET group_id = NULL, updated_at = ? WHERE group_id = ?").bind(now(), id),
    DB.prepare("UPDATE managed_reader_groups SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now(), id)
  ]);
  return json({ ok: true, deleted: true });
}

async function hasManagedPermission(DB, user) {
  if (!user) return false;
  if (user.role === "owner") return true;
  const row = await DB.prepare("SELECT status FROM managed_khatma_permissions WHERE user_id = ? LIMIT 1").bind(user.id).first();
  return row?.status === "active";
}

async function requireManagedCreator(request, DB) {
  await ensureManagedSchema(DB);
  const user = await currentUser(request, DB);
  if (!user) return { ok: false, response: json({ ok: false, error: "تسجيل الدخول مطلوب" }, 401) };
  if (!await hasManagedPermission(DB, user)) {
    return { ok: false, response: json({ ok: false, error: "هذه الصفحة مخصصة للمالك أو منشئ الختمات المتحكم" }, 403) };
  }
  return { ok: true, user };
}

async function requireManagedControl(request, DB, id) {
  await ensureManagedSchema(DB);
  const user = await currentUser(request, DB);
  if (!user) return { ok: false, error: "تسجيل الدخول مطلوب", status: 401 };
  const row = await DB.prepare("SELECT id, created_by_user_id, shared_creator_group_id FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return { ok: false, error: "الختمة المُدارة غير موجودة", status: 404 };
  if (user.role === "owner") return { ok: true, user, row };
  if (!await hasManagedPermission(DB, user)) return { ok: false, error: "لا تملك صلاحية إدارة الختمات المُدارة", status: 403 };
  await ensureCreatorGroupSchema(DB);
  const visibleIds = await getCreatorGroupMemberIds(DB, user.id);
  if (visibleIds.includes(row.created_by_user_id)) return { ok: true, user, row };
  if (row.shared_creator_group_id) {
    const userGroupIds = await getUserGroupIds(DB, user.id);
    if (userGroupIds.includes(row.shared_creator_group_id)) return { ok: true, user, row };
  }
  return { ok: false, error: "لا تملك صلاحية إدارة هذه الختمة", status: 403 };
}

function parseManagedParticipants(items = []) {
  const list = Array.isArray(items) ? items : [];
  const seenCodes = new Set();
  const parsed = [];
  for (const item of list) {
    const name = String(item.name || item.participantName || item.participant_name || "").trim();
    const phone = normalizePhone(item.phone || item.participantPhone || "");
    const accessCode = normalizeAccessCode(item.accessCode || item.access_code || item.code || "");
    const notes = String(item.notes || "").trim();
    const id = String(item.id || "").trim();
    const readerProfileId = String(item.readerProfileId || item.reader_profile_id || item.readerId || "").trim();
    const startJuz = (item.startJuz || item.start_juz) ? Number(item.startJuz || item.start_juz) : null;
    const partsCount = (item.partsCount || item.parts_count) ? Number(item.partsCount || item.parts_count) : null;
    if (!name && !phone && !accessCode) continue;
    if (!name) return { ok: false, error: "اسم كل مشارك مطلوب" };
    if (!isValidAccessCode(accessCode)) return { ok: false, error: "كود كل مشارك يجب أن يكون من 4 إلى 10 أرقام" };
    if (seenCodes.has(accessCode)) return { ok: false, error: "لا يمكن تكرار كود المشارك داخل نفس الختمة" };
    seenCodes.add(accessCode);
    parsed.push({ id, readerProfileId, name, phone, accessCode, notes, startJuz, partsCount });
  }
  if (!parsed.length) return { ok: false, error: "أضف مشاركًا واحدًا على الأقل" };
  return { ok: true, participants: parsed };
}

function parseManagedUnits(data, division) {
  const meta = unitMeta(division);
  const selectionMode = data.selectionMode === "custom" ? "custom" : "all";
  if (selectionMode === "custom") {
    const raw = Array.isArray(data.selectedUnits) ? data.selectedUnits : [];
    const nums = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= meta.total))].sort((a, b) => a - b);
    if (!nums.length) return { ok: false, error: "يجب اختيار وحدة واحدة على الأقل" };
    return { ok: true, selectionMode, unitNumbers: nums, meta };
  }
  return { ok: true, selectionMode, unitNumbers: Array.from({ length: meta.total }, (_, i) => i + 1), meta };
}

function assignmentValueFor(assignments, unitNumber) {
  if (!assignments || typeof assignments !== "object") return "";
  return String(assignments[unitNumber] || assignments[String(unitNumber)] || "").trim();
}

function mapManagedKhatma(row, units = [], participants = [], includeSecrets = false, visibleParticipantId = "") {
  // visibleParticipantId may be a single string ID or an array of IDs (for sibling participants)
  const visibleIdSet = Array.isArray(visibleParticipantId)
    ? new Set(visibleParticipantId.map(String).filter(Boolean))
    : (visibleParticipantId ? new Set([String(visibleParticipantId)]) : new Set());
  const khatmaType = row.khatma_type || "monthly";
  const rotationStart = row.rotation_start_date || "";
  let expiresAt = row.expires_at || "";
  if (rotationStart && (khatmaType === 'monthly' || khatmaType === 'weekly')) {
    const periodEnd = computeRotationPeriodEnd(rotationStart, khatmaType);
    if (periodEnd) expiresAt = periodEnd.toISOString();
  }
  return {
    id: row.id,
    title: row.title,
    weekNumber: row.week_number || "",
    khatmaType,
    khatmaDate: row.khatma_date || "",
    hijriDate: row.hijri_date || "",
    gregorianDate: row.gregorian_date || "",
    expiresAt,
    division: row.division || "juz",
    selectionMode: row.selection_mode || "all",
    ownerName: row.owner_name || "",
    createdByUserId: row.created_by_user_id || "",
    coordinatorName: row.coordinator_name || "",
    coordinatorWhatsapp: row.coordinator_whatsapp || "",
    dedication: row.dedication || "",
    quoteBy: row.quote_by || "",
    quoteText: row.quote_text || "",
    quoteSource: row.quote_source || "",
    notes: row.notes || "",
    status: row.status || "active",
    createdAt: row.created_at || "",
    closedAt: row.closed_at || "",
    archivedAt: row.archived_at || "",
    sharedCreatorGroupId: row.shared_creator_group_id || "",
    rotationStartDate: row.rotation_start_date || "",
    groupId: row.group_id || "",
    rotationDurationYears: row.rotation_duration_years || 5,
    participants: participants.map(p => {
      const canSeeParticipant = includeSecrets || visibleIdSet.has(String(p.id || ""));
      return {
      id: includeSecrets ? p.id : "",
      readerProfileId: includeSecrets ? (p.reader_profile_id || "") : "",
      name: canSeeParticipant ? (p.participant_name || "") : "",
      phone: includeSecrets ? (p.phone || "") : "",
      accessCode: includeSecrets ? (p.access_code || "") : "",
      notes: includeSecrets ? (p.notes || "") : "",
      startJuz: (includeSecrets || canSeeParticipant) ? (p.start_juz || null) : null,
      partsCount: (includeSecrets || canSeeParticipant) ? (p.parts_count || null) : null
      };
    }),
    units: units.map(u => {
      const participantId = String(u.participant_id || "");
      const canSeeParticipant = includeSecrets || visibleIdSet.has(participantId);
      return {
      id: u.id,
      number: u.unit_number,
      label: u.label,
      status: u.status,
      participantId: includeSecrets ? participantId : "",
      participantName: canSeeParticipant ? (u.participant_name || "") : "",
      participantPhone: includeSecrets ? (u.participant_phone || u.phone || "") : "",
      readingAt: u.reading_at || "",
      completedAt: u.completed_at || "",
      updatedAt: u.updated_at || ""
      };
    })
  };
}

async function getManagedKhatma(DB, id, includeSecrets = false) {
  await ensureManagedSchema(DB);
  const row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return null;
  const participants = (await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ? ORDER BY created_at ASC").bind(id).all()).results || [];
  const units = (await DB.prepare(`
    SELECT u.*, p.participant_name, p.phone AS participant_phone
    FROM managed_khatma_units u
    LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ?
    ORDER BY u.unit_number ASC
  `).bind(id).all()).results || [];
  return mapManagedKhatma(row, units, participants, includeSecrets);
}

async function findManagedParticipantByIdentity(DB, id, identityRaw) {
  const identity = String(identityRaw || "").trim();
  if (!identity) return null;
  const accessCode = normalizeAccessCode(identity);
  if (accessCode && isValidAccessCode(accessCode)) {
    const byCode = await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ? AND access_code = ? LIMIT 1").bind(id, accessCode).first();
    if (byCode) return byCode;
  }
  const phone = normalizePhone(identity);
  if (phone && phone.length >= 9) {
    const byPhone = await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ? AND phone = ? LIMIT 1").bind(id, phone).first();
    if (byPhone) return byPhone;
  }
  if (identity.length >= 2) {
    const byName = await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ? AND participant_name = ? LIMIT 1").bind(id, identity).first();
    if (byName) return byName;
  }
  return null;
}

async function getManagedKhatmaParticipantView(DB, id, participant) {
  await ensureManagedSchema(DB);
  if (!participant) return null;
  const row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return null;

  // Collect ALL participant IDs for this reader in this khatma.
  // A single physical reader may appear under multiple participant records
  // (e.g. added from different groups or manually) linked by reader_profile_id.
  let participantIds = [participant.id];
  if (participant.reader_profile_id) {
    const siblings = (await DB.prepare(
      "SELECT id FROM managed_khatma_participants WHERE khatma_id = ? AND reader_profile_id = ?"
    ).bind(id, participant.reader_profile_id).all()).results || [];
    for (const s of siblings) {
      if (s.id !== participant.id) participantIds.push(s.id);
    }
  }

  const inClause = participantIds.map(() => "?").join(",");
  const units = (await DB.prepare(`
    SELECT u.*, p.participant_name, p.phone AS participant_phone
    FROM managed_khatma_units u
    JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ? AND u.participant_id IN (${inClause})
    ORDER BY u.unit_number ASC
  `).bind(id, ...participantIds).all()).results || [];
  // Pass all participantIds so mapManagedKhatma reveals names/status for all the
  // reader's units, including those linked via sibling participant records.
  return mapManagedKhatma(row, units, [participant], false, participantIds);
}

function mapManagedReader(row) {
  return {
    id: row.id,
    createdByUserId: row.created_by_user_id || "",
    name: row.reader_name || "",
    phone: row.phone || "",
    accessCode: row.access_code || "",
    serialCode: row.serial_code || "",
    country: row.country || "",
    groupId: row.group_id || "",
    sharedCreatorGroupId: row.shared_creator_group_id || "",
    startJuz: row.start_juz || null,
    partsCount: row.parts_count || null,
    notes: row.notes || "",
    status: row.status || "active",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function parseManagedReaderItems(items = []) {
  const list = Array.isArray(items) ? items : [items];
  const seen = new Set();
  const readers = [];
  for (const item of list) {
    const id = String(item.id || "").trim();
    const name = String(item.name || item.readerName || item.reader_name || "").trim();
    const phone = normalizePhone(item.phone || "");
    const accessCode = normalizeAccessCode(item.accessCode || item.access_code || item.code || "");
    const notes = String(item.notes || "").trim();
    const groupId = String(item.groupId || item.group_id || "").trim();
    const startJuz = (item.startJuz || item.start_juz) ? Number(item.startJuz || item.start_juz) : null;
    const partsCount = (item.partsCount || item.parts_count) ? Number(item.partsCount || item.parts_count) : null;
    if (!name && !phone && !accessCode && !notes) continue;
    if (!name) return { ok: false, error: "اسم القارئ مطلوب" };
    if (!isValidAccessCode(accessCode)) return { ok: false, error: "كود القارئ يجب أن يكون من 4 إلى 10 أرقام" };
    if (seen.has(accessCode)) return { ok: false, error: "لا يمكن تكرار كود القارئ في نفس العملية" };
    seen.add(accessCode);
    const country = String(item.country || "").trim();
    readers.push({ id, name, phone, accessCode, notes, country, groupId, startJuz, partsCount });
  }
  if (!readers.length) return { ok: false, error: "أضف قارئًا واحدًا على الأقل" };
  return { ok: true, readers };
}

async function listManagedReaders(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") || "";
  let rows;
  if (check.user.role === "owner") {
    const q = groupId
      ? `SELECT mrp.*, u.display_name AS owner_display_name, u.username AS owner_username, g.name AS group_name
         FROM managed_reader_profiles mrp
         LEFT JOIN users u ON u.id = mrp.created_by_user_id
         LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
         WHERE mrp.status != 'deleted' AND mrp.group_id = ?
         ORDER BY mrp.created_at DESC`
      : `SELECT mrp.*, u.display_name AS owner_display_name, u.username AS owner_username, g.name AS group_name
         FROM managed_reader_profiles mrp
         LEFT JOIN users u ON u.id = mrp.created_by_user_id
         LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
         WHERE mrp.status != 'deleted'
         ORDER BY mrp.created_at DESC`;
    rows = (groupId
      ? await DB.prepare(q).bind(groupId).all()
      : await DB.prepare(q).all()).results || [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const inClause = visibleIds.map(() => "?").join(",");
    const userGroupIds = await getUserGroupIds(DB, check.user.id);
    const sharedReaderClause = userGroupIds.length ? `OR (mrp.shared_creator_group_id IS NOT NULL AND mrp.shared_creator_group_id IN (${userGroupIds.map(()=>"?").join(",")}))` : "";
    const baseReaderParams = [...visibleIds, ...userGroupIds];
    const q = groupId
      ? `SELECT mrp.*, g.name AS group_name
         FROM managed_reader_profiles mrp
         LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
         WHERE mrp.status != 'deleted' AND (mrp.created_by_user_id IN (${inClause}) ${sharedReaderClause}) AND mrp.group_id = ?
         ORDER BY mrp.created_at DESC`
      : `SELECT mrp.*, g.name AS group_name
         FROM managed_reader_profiles mrp
         LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
         WHERE mrp.status != 'deleted' AND (mrp.created_by_user_id IN (${inClause}) ${sharedReaderClause})
         ORDER BY mrp.created_at DESC`;
    rows = (groupId
      ? await DB.prepare(q).bind(...baseReaderParams, groupId).all()
      : await DB.prepare(q).bind(...baseReaderParams).all()).results || [];
  }
  return json({ ok: true, readers: rows.map(r => ({ ...mapManagedReader(r), groupName: r.group_name || "", ownerName: r.owner_display_name || r.owner_username || "" })) });
}

// Generates the next available serial code in R-XXXXXX format.
// `reserved` is a Set of codes already allocated in the current operation
// but not yet committed to DB (used when inserting multiple readers in a batch).
async function generateSerialCode(DB, reserved = new Set()) {
  const row = await DB.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTR(serial_code, 3) AS INTEGER)), 0) AS maxNum
     FROM managed_reader_profiles WHERE serial_code LIKE 'R-%'`
  ).first();
  const baseNum = Number(row?.maxNum || 0);
  for (let offset = 1; offset <= 10; offset++) {
    const candidate = 'R-' + String(baseNum + offset).padStart(6, '0');
    if (!reserved.has(candidate)) return candidate;
  }
  throw new Error("تعذر توليد رقم تسلسلي فريد، حاول مجددًا");
}

async function upsertManagedReaders(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const groupId = String(body.groupId || body.group_id || "").trim() || null;
  const parsed = parseManagedReaderItems(body.readers || body.reader || body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  if (groupId) {
    const grp = await DB.prepare("SELECT id, created_by_user_id FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(groupId).first();
    if (!grp) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
    if (check.user.role !== "owner") {
      await ensureCreatorGroupSchema(DB);
      const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
      if (!visibleIds.includes(grp.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية استخدام هذه المجموعة" }, 403);
    }
  }
  const ownerId = check.user.id;
  const t = now();
  const stmts = [];
  const out = [];
  const usedSerials = new Set();
  for (const reader of parsed.readers) {
    const readerGroupId = reader.groupId || groupId;
    let existing = reader.id
      ? await DB.prepare("SELECT * FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(reader.id).first()
      : null;
    if (existing && check.user.role !== "owner") {
      await ensureCreatorGroupSchema(DB);
      const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
      if (!visibleIds.includes(existing.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية تعديل هذا القارئ" }, 403);
    }
    if (!existing) {
      existing = await DB.prepare("SELECT * FROM managed_reader_profiles WHERE created_by_user_id = ? AND access_code = ? LIMIT 1").bind(ownerId, reader.accessCode).first();
    }
    if (existing) {
      stmts.push(DB.prepare(`
        UPDATE managed_reader_profiles
        SET reader_name = ?, phone = ?, access_code = ?, notes = ?,
            country = COALESCE(NULLIF(?, ''), country),
            group_id = COALESCE(?, group_id),
            start_juz = COALESCE(?, start_juz), parts_count = COALESCE(?, parts_count),
            status = 'active', updated_at = ?
        WHERE id = ?
      `).bind(reader.name, reader.phone, reader.accessCode, reader.notes, reader.country || null,
               readerGroupId || null, reader.startJuz || null, reader.partsCount || null, t, existing.id));
      out.push({ ...reader, id: existing.id, createdByUserId: existing.created_by_user_id, groupId: readerGroupId || existing.group_id || "" });
    } else {
      const id = newId("mreader");
      const serialCode = await generateSerialCode(DB, usedSerials);
      usedSerials.add(serialCode);
      stmts.push(DB.prepare(`
        INSERT INTO managed_reader_profiles (id, created_by_user_id, reader_name, phone, access_code, notes, country, group_id, start_juz, parts_count, serial_code, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(id, ownerId, reader.name, reader.phone, reader.accessCode, reader.notes, reader.country || null,
               readerGroupId || null, reader.startJuz || null, reader.partsCount || null, serialCode, t, t));
      out.push({ ...reader, id, createdByUserId: ownerId, groupId: readerGroupId || "", serialCode });
    }
  }
  await DB.batch(stmts);
  return json({ ok: true, readers: out }, parsed.readers.length === 1 ? 200 : 201);
}

async function deleteManagedReader(request, DB, id) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT * FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "القارئ غير موجود" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(row.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية حذف هذا القارئ" }, 403);
  }
  await DB.prepare("UPDATE managed_reader_profiles SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, deleted: true });
}

async function syncManagedReadersForKhatma(DB, user, participants) {
  const synced = [];
  let visibleIds = [user.id];
  if (user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    visibleIds = await getCreatorGroupMemberIds(DB, user.id);
  }
  const inClause = visibleIds.map(() => "?").join(",");
  for (const participant of participants) {
    let reader = participant.readerProfileId
      ? await DB.prepare("SELECT * FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(participant.readerProfileId).first()
      : null;
    if (!reader) {
      if (user.role === "owner") {
        reader = await DB.prepare("SELECT * FROM managed_reader_profiles WHERE access_code = ? AND status != 'deleted' LIMIT 1").bind(participant.accessCode).first();
      } else {
        reader = await DB.prepare(`SELECT * FROM managed_reader_profiles WHERE created_by_user_id IN (${inClause}) AND access_code = ? AND status != 'deleted' LIMIT 1`).bind(...visibleIds, participant.accessCode).first();
      }
    }
    if (reader && user.role !== "owner" && !visibleIds.includes(reader.created_by_user_id)) throw new Error("لا تملك صلاحية استخدام أحد القراء");
    const ownerId = reader?.created_by_user_id || user.id;
    if (reader) {
      await DB.prepare(`
        UPDATE managed_reader_profiles
        SET reader_name = ?, phone = ?, access_code = ?, notes = ?,
            start_juz = COALESCE(?, start_juz), parts_count = COALESCE(?, parts_count),
            status = 'active', updated_at = ?
        WHERE id = ?
      `).bind(participant.name, participant.phone, participant.accessCode, participant.notes,
               participant.startJuz || null, participant.partsCount || null, now(), reader.id).run();
      synced.push({ ...participant, readerProfileId: reader.id });
    } else {
      const id = newId("mreader");
      const t = now();
      const serialCode = await generateSerialCode(DB);
      await DB.prepare(`
        INSERT INTO managed_reader_profiles (id, created_by_user_id, reader_name, phone, access_code, notes, country, start_juz, parts_count, serial_code, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(id, ownerId, participant.name, participant.phone, participant.accessCode, participant.notes,
               participant.country || null, participant.startJuz || null, participant.partsCount || null, serialCode, t, t).run();
      synced.push({ ...participant, readerProfileId: id });
    }
  }
  return synced;
}

async function getKhatmaRow(DB, id) {
  return DB.prepare("SELECT * FROM khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
}

async function getKhatma(DB, id) {
  const row = await getKhatmaRow(DB, id);
  if (!row) return null;
  const units = await DB.prepare("SELECT * FROM khatma_units WHERE khatma_id = ? ORDER BY unit_number ASC").bind(id).all();
  return mapKhatma(row, units.results || []);
}

async function requireKhatmaControl(request, DB, id, code) {
  const row = await DB.prepare("SELECT id, admin_code, created_by_user_id FROM khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return { ok: false, error: "الختمة غير موجودة", status: 404 };
  const user = await currentUser(request, DB);
  if (user && (user.role === "owner" || user.id === row.created_by_user_id)) return { ok: true };
  if (String(row.admin_code) !== String(code || "").trim()) return { ok: false, error: "رمز الإدارة غير صحيح", status: 403 };
  return { ok: true };
}


async function listKhatmas(request, DB) {
  const url = new URL(request.url);
  const ownerKey = url.searchParams.get("ownerKey") || "";
  const khatmaRows = (ownerKey
    ? await DB.prepare("SELECT * FROM khatmas WHERE deleted_at IS NULL AND owner_key = ? ORDER BY created_at DESC LIMIT 200").bind(ownerKey).all()
    : await DB.prepare("SELECT * FROM khatmas WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200").all()
  ).results || [];
  if (!khatmaRows.length) return json({ ok: true, khatmas: [] });
  const ids = khatmaRows.map(r => r.id);
  const allUnits = (await DB.prepare(`SELECT * FROM khatma_units WHERE khatma_id IN (${ids.map(() => "?").join(",")}) ORDER BY khatma_id, unit_number ASC`).bind(...ids).all()).results || [];
  const byKhatma = new Map();
  for (const u of allUnits) {
    const arr = byKhatma.get(u.khatma_id) || [];
    arr.push(u);
    byKhatma.set(u.khatma_id, arr);
  }
  return json({ ok: true, khatmas: khatmaRows.map(row => mapKhatma(row, byKhatma.get(row.id) || [])) });
}

async function createKhatma(request, DB) {
  const data = await readJson(request);
  const user = await currentUser(request, DB);
  if (!user) return json({ ok: false, error: "تسجيل الدخول مطلوب لإنشاء ختمة" }, 401);
  const id = newId("khatma");
  const code = adminCode();
  const createdAt = now();
  const division = data.division || "juz";
  const khatmaType = normalizeKhatmaType(data.khatmaType || data.khatma_type);
  const meta = unitMeta(division);
  const ownerKey = user ? user.id : (data.ownerKey || newId("owner"));
  const ownerName = user.display_name || user.username || "";

  const selectionMode = data.selectionMode === "custom" ? "custom" : "all";
  let unitsToCreate;
  if (selectionMode === "custom") {
    const raw = Array.isArray(data.selectedUnits) ? data.selectedUnits : [];
    const nums = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= meta.total))].sort((a, b) => a - b);
    if (nums.length === 0) return json({ ok: false, error: "يجب اختيار جزء واحد على الأقل في الأجزاء المخصصة" }, 400);
    unitsToCreate = nums;
  } else {
    unitsToCreate = Array.from({ length: meta.total }, (_, i) => i + 1);
  }

  await DB.prepare(`
    INSERT INTO khatmas (
      id, title, week_number, khatma_type, khatma_date, hijri_date, gregorian_date, expires_at,
      division, selection_mode, owner_name, owner_key, created_by_user_id, coordinator_name, coordinator_whatsapp,
      dedication, quote_by, quote_text, quote_source, notes, status, admin_code, created_at, closed_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL)
  `).bind(
    id,
    data.title || "ختمة جديدة",
    data.weekNumber || "",
    khatmaType,
    data.khatmaDate || "",
    data.hijriDate || "",
    data.gregorianDate || "",
    data.expiresAt || "",
    division,
    selectionMode,
    ownerName,
    ownerKey,
    user ? user.id : null,
    data.coordinatorName || "",
    data.coordinatorWhatsapp || "",
    data.dedication || "",
    data.quoteBy || "",
    data.quoteText || "",
    data.quoteSource || "",
    data.notes || "",
    code,
    createdAt
  ).run();

  const stmt = DB.prepare(`
    INSERT INTO khatma_units (
      id, khatma_id, unit_number, label, status, participant_name,
      reserved_at, reading_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, 'available', '', NULL, NULL, NULL, ?)
  `);
  const batch = [];
  for (const i of unitsToCreate) batch.push(stmt.bind(newId("unit"), id, i, `${meta.label} ${i}`, createdAt));
  await DB.batch(batch);

  const khatma = await getKhatma(DB, id);
  return json({ ok: true, khatma, adminCode: code, ownerKey }, 201);
}

async function verifyAdmin(request, DB, id) {
  const body = await readJson(request);
  const result = await requireKhatmaControl(request, DB, id, body.adminCode);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  return json({ ok: true });
}

async function toggleClose(request, DB, id) {
  const body = await readJson(request);
  const result = await requireKhatmaControl(request, DB, id, body.adminCode);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const row = await getKhatmaRow(DB, id);
  const nextStatus = row.status === "closed" ? "active" : "closed";
  const closedAt = nextStatus === "closed" ? now() : null;
  await DB.prepare("UPDATE khatmas SET status = ?, closed_at = ? WHERE id = ?").bind(nextStatus, closedAt, id).run();
  const khatma = await getKhatma(DB, id);
  return json({ ok: true, status: nextStatus, khatma });
}

async function updateKhatma(request, DB, id) {
  const data = await readJson(request);
  const result = await requireKhatmaControl(request, DB, id, data.adminCode);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  const row = await getKhatmaRow(DB, id);
  if (!row) return json({ ok: false, error: "الختمة غير موجودة" }, 404);

  const nextDivision = data.division || row.division || "juz";
  const khatmaType = normalizeKhatmaType(data.khatmaType || data.khatma_type || row.khatma_type);
  const divisionChanged = nextDivision !== row.division;
  const t = now();

  if (divisionChanged && (row.selection_mode || "all") === "custom") {
    return json({ ok: false, error: "لا يمكن تغيير نوع التقسيم في ختمة ذات أجزاء مخصصة" }, 409);
  }

  if (divisionChanged) {
    const busy = await DB.prepare(`
      SELECT COUNT(*) AS count
      FROM khatma_units
      WHERE khatma_id = ?
        AND status != 'available'
    `).bind(id).first();
    if (Number(busy?.count || 0) > 0) {
      return json({ ok: false, error: "لا يمكن تغيير نوع التقسيم بعد وجود حجوزات أو قراءات" }, 409);
    }
  }

  await DB.prepare(`
    UPDATE khatmas
    SET title = ?,
        week_number = ?,
        khatma_type = ?,
        khatma_date = ?,
        hijri_date = ?,
        gregorian_date = ?,
        expires_at = ?,
        division = ?,
        coordinator_name = ?,
        coordinator_whatsapp = ?,
        dedication = ?,
        quote_by = ?,
        quote_text = ?,
        quote_source = ?,
        notes = ?
    WHERE id = ?
  `).bind(
    data.title || "ختمة جديدة",
    data.weekNumber || "",
    khatmaType,
    data.khatmaDate || "",
    data.hijriDate || "",
    data.gregorianDate || "",
    data.expiresAt || "",
    nextDivision,
    data.coordinatorName || "",
    data.coordinatorWhatsapp || "",
    data.dedication || "",
    data.quoteBy || "",
    data.quoteText || "",
    data.quoteSource || "",
    data.notes || "",
    id
  ).run();

  if (divisionChanged) {
    const meta = unitMeta(nextDivision);
    await DB.prepare("DELETE FROM khatma_units WHERE khatma_id = ?").bind(id).run();
    const stmt = DB.prepare(`
      INSERT INTO khatma_units (
        id, khatma_id, unit_number, label, status, participant_name,
        reserved_at, reading_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, 'available', '', NULL, NULL, NULL, ?)
    `);
    const batch = [];
    for (let i = 1; i <= meta.total; i += 1) batch.push(stmt.bind(newId("unit"), id, i, `${meta.label} ${i}`, t));
    await DB.batch(batch);
  }

  if ((row.selection_mode || "all") === "custom" && Array.isArray(data.selectedUnits) && data.selectedUnits.length > 0) {
    const meta = unitMeta(nextDivision);
    const rawSelected = [...new Set(data.selectedUnits.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= meta.total))];
    if (rawSelected.length > 0) {
      const newSet = new Set(rawSelected);
      const existingRows = await DB.prepare("SELECT unit_number, status FROM khatma_units WHERE khatma_id = ?").bind(id).all();
      const existingMap = new Map((existingRows.results || []).map(u => [u.unit_number, u.status]));
      const stmts = [];
      for (const n of newSet) {
        if (!existingMap.has(n)) stmts.push(DB.prepare(`INSERT INTO khatma_units (id, khatma_id, unit_number, label, status, participant_name, reserved_at, reading_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'available', '', NULL, NULL, NULL, ?)`).bind(newId("unit"), id, n, `${meta.label} ${n}`, t));
      }
      for (const [unitNum, status] of existingMap) {
        if (!newSet.has(unitNum) && status === "available") stmts.push(DB.prepare("DELETE FROM khatma_units WHERE khatma_id = ? AND unit_number = ?").bind(id, unitNum));
      }
      if (stmts.length > 0) await DB.batch(stmts);
    }
  }

  const khatma = await getKhatma(DB, id);
  return json({ ok: true, khatma });
}

async function softDelete(request, DB, id) {
  const body = await readJson(request);
  const result = await requireKhatmaControl(request, DB, id, body.adminCode);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  await DB.prepare("UPDATE khatmas SET deleted_at = ?, status = 'closed' WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, deleted: true });
}

async function unitAction(request, DB, khatmaId, number, action) {
  const body = await readJson(request);
  const khatma = await getKhatmaRow(DB, khatmaId);
  if (!khatma) return json({ ok: false, error: "الختمة غير موجودة" }, 404);
  if (khatma.status === "closed" && action !== "available") return json({ ok: false, error: "الختمة مغلقة من قبل المنشئ" }, 409);

  const unitNumber = Number(number);
  const unit = await DB.prepare("SELECT * FROM khatma_units WHERE khatma_id = ? AND unit_number = ? LIMIT 1").bind(khatmaId, unitNumber).first();
  if (!unit) return json({ ok: false, error: "الجزء غير موجود" }, 404);
  const t = now();

  if (action === "reserve") {
    const name = String(body.participantName || "").trim();
    if (!name) return json({ ok: false, error: "اسم المشارك مطلوب" }, 400);
    if (unit.status !== "available") return json({ ok: false, error: "هذا الجزء غير متاح" }, 409);
    await DB.prepare(`UPDATE khatma_units SET status = 'reserved', participant_name = ?, reserved_at = ?, reading_at = NULL, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND unit_number = ?`).bind(name, t, t, khatmaId, unitNumber).run();
  } else if (action === "reading") {
    if (unit.status !== "reserved" && unit.status !== "reading") return json({ ok: false, error: "لا يمكن تحويل هذا الجزء إلى جاري القراءة" }, 409);
    await DB.prepare(`UPDATE khatma_units SET status = 'reading', reading_at = ?, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND unit_number = ?`).bind(t, t, khatmaId, unitNumber).run();
  } else if (action === "complete") {
    if (unit.status !== "reserved" && unit.status !== "reading") return json({ ok: false, error: "لا يمكن تسجيل هذا الجزء كمكتمل قبل حجزه" }, 409);
    await DB.prepare(`UPDATE khatma_units SET status = 'completed', completed_at = ?, updated_at = ? WHERE khatma_id = ? AND unit_number = ?`).bind(t, t, khatmaId, unitNumber).run();
  } else if (action === "available") {
    if (unit.status === "completed") {
      const result = await requireKhatmaControl(request, DB, khatmaId, body.adminCode);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
    }
    await DB.prepare(`UPDATE khatma_units SET status = 'available', participant_name = '', reserved_at = NULL, reading_at = NULL, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND unit_number = ?`).bind(t, khatmaId, unitNumber).run();
  } else {
    return json({ ok: false, error: "إجراء غير معروف" }, 400);
  }

  const fresh = await getKhatma(DB, khatmaId);
  return json({ ok: true, khatma: fresh });
}

async function listManagedKhatmas(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const statusFilter = new URL(request.url).searchParams.get("status");
  const archivedClause = statusFilter === "archived" ? "AND archived_at IS NOT NULL" : "AND archived_at IS NULL";
  let rows;
  if (check.user.role === "owner") {
    rows = (await DB.prepare(`SELECT * FROM managed_khatmas WHERE deleted_at IS NULL ${archivedClause} ORDER BY created_at DESC LIMIT 200`).all()).results || [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds = await getUserGroupIds(DB, check.user.id);
    let mkQuery, mkParams;
    if (userGroupIds.length) {
      const sharedClause = `OR (shared_creator_group_id IS NOT NULL AND shared_creator_group_id IN (${userGroupIds.map(()=>"?").join(",")}))`;
      mkQuery = `SELECT * FROM managed_khatmas WHERE deleted_at IS NULL ${archivedClause} AND (created_by_user_id IN (${visibleIds.map(()=>"?").join(",")}) ${sharedClause}) ORDER BY created_at DESC LIMIT 200`;
      mkParams = [...visibleIds, ...userGroupIds];
    } else {
      mkQuery = `SELECT * FROM managed_khatmas WHERE deleted_at IS NULL ${archivedClause} AND created_by_user_id IN (${visibleIds.map(()=>"?").join(",")}) ORDER BY created_at DESC LIMIT 200`;
      mkParams = visibleIds;
    }
    rows = (await DB.prepare(mkQuery).bind(...mkParams).all()).results || [];
  }
  if (!rows.length) return json({ ok: true, khatmas: [] });
  const ids = rows.map(r => r.id);
  const units = (await DB.prepare(`
    SELECT u.*, p.participant_name, p.phone AS participant_phone
    FROM managed_khatma_units u
    LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id IN (${ids.map(() => "?").join(",")})
    ORDER BY u.khatma_id, u.unit_number ASC
  `).bind(...ids).all()).results || [];
  const byKhatma = new Map();
  for (const unit of units) {
    const list = byKhatma.get(unit.khatma_id) || [];
    list.push(unit);
    byKhatma.set(unit.khatma_id, list);
  }
  return json({ ok: true, khatmas: rows.map(row => mapManagedKhatma(row, byKhatma.get(row.id) || [], [], false)) });
}

async function createManagedKhatma(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const data = await readJson(request);
  const division = data.division || "juz";
  const khatmaType = normalizeKhatmaType(data.khatmaType || data.khatma_type);
  const parsedParticipants = parseManagedParticipants(data.participants);
  if (!parsedParticipants.ok) return json({ ok: false, error: parsedParticipants.error }, 400);
  const parsedUnits = parseManagedUnits(data, division);
  if (!parsedUnits.ok) return json({ ok: false, error: parsedUnits.error }, 400);

  const weekNumber = String(data.weekNumber || "").trim();
  if (weekNumber) {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const existing = await DB.prepare(
      `SELECT id FROM managed_khatmas WHERE week_number = ? AND deleted_at IS NULL AND archived_at IS NULL AND created_by_user_id IN (${visibleIds.map(()=>"?").join(",")})`
    ).bind(weekNumber, ...visibleIds).first();
    if (existing) return json({ ok: false, error: `رقم الختمة "${weekNumber}" موجود مسبقاً في مجموعتك` }, 409);
  }

  const id = newId("mkhatma");
  const t = now();
  const syncedProfiles = await syncManagedReadersForKhatma(DB, check.user, parsedParticipants.participants);
  const participants = syncedProfiles.map(p => ({ ...p, id: newId("mpart") }));
  const participantLookup = new Map();
  for (const participant of participants) {
    participantLookup.set(participant.id, participant);
    if (participant.readerProfileId) participantLookup.set(participant.readerProfileId, participant);
    participantLookup.set(participant.accessCode, participant);
    if (participant.phone) participantLookup.set(participant.phone, participant);
    participantLookup.set(participant.name, participant);
  }

  const groupId = String(data.groupId || data.group_id || "").trim() || null;
  const rotationStartDate = String(data.rotationStartDate || data.rotation_start_date || "").trim() || null;
  const autoExpiresAt = rotationStartDate && (khatmaType === 'monthly' || khatmaType === 'weekly')
    ? (computeRotationPeriodEnd(rotationStartDate, khatmaType)?.toISOString() || data.expiresAt || "")
    : (data.expiresAt || "");
  await DB.prepare(`
    INSERT INTO managed_khatmas (
      id, title, week_number, khatma_type, khatma_date, hijri_date, gregorian_date, expires_at,
      division, selection_mode, owner_name, created_by_user_id, coordinator_name, coordinator_whatsapp,
      dedication, quote_by, quote_text, quote_source, notes, status, created_at, closed_at, deleted_at,
      group_id, rotation_start_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)
  `).bind(
    id,
    data.title || "ختمة مُدارة جديدة",
    data.weekNumber || "",
    khatmaType,
    data.khatmaDate || "",
    data.hijriDate || "",
    data.gregorianDate || "",
    autoExpiresAt,
    division,
    parsedUnits.selectionMode,
    check.user.display_name || check.user.username || "",
    check.user.id,
    data.coordinatorName || "",
    data.coordinatorWhatsapp || "",
    data.dedication || "",
    data.quoteBy || "",
    data.quoteText || "",
    data.quoteSource || "",
    data.notes || "",
    t,
    groupId,
    rotationStartDate
  ).run();

  const participantStmt = DB.prepare(`
    INSERT INTO managed_khatma_participants (id, khatma_id, participant_name, phone, access_code, reader_profile_id, notes, start_juz, parts_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const unitStmt = DB.prepare(`
    INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `);
  const assignments = data.unitAssignments || data.assignments || {};
  const batch = participants.map(p => participantStmt.bind(p.id, id, p.name, p.phone, p.accessCode, p.readerProfileId || null, p.notes, p.startJuz || null, p.partsCount || null, t, t));
  for (const unitNumber of parsedUnits.unitNumbers) {
    const rawAssignment = assignmentValueFor(assignments, unitNumber);
    const normalized = normalizeAccessCode(rawAssignment) || normalizePhone(rawAssignment) || rawAssignment;
    const participant = participantLookup.get(rawAssignment) || participantLookup.get(normalized);
    batch.push(unitStmt.bind(
      newId("munit"),
      id,
      unitNumber,
      `${parsedUnits.meta.label} ${unitNumber}`,
      participant ? "assigned" : "available",
      participant ? participant.id : null,
      t
    ));
  }
  await DB.batch(batch);
  const khatma = await getManagedKhatma(DB, id, true);
  return json({ ok: true, khatma }, 201);
}

async function getManagedPublic(DB, id) {
  const khatma = await getManagedKhatma(DB, id, false);
  if (!khatma) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);
  khatma.participants = [];
  khatma.units = [];
  return json({ ok: true, khatma });
}

async function verifyManagedPublic(request, DB, id) {
  await ensureManagedSchema(DB);
  const body = await readJson(request);
  const participant = await findManagedParticipantByIdentity(DB, id, body.identity || body.phone || body.accessCode || body.code);
  if (!participant) return json({ ok: false, error: "رقم الجوال أو الكود غير صحيح لهذه الختمة" }, 403);
  const khatma = await getManagedKhatmaParticipantView(DB, id, participant);
  if (!khatma) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);
  return json({ ok: true, khatma });
}

async function getManagedAdmin(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const khatma = await getManagedKhatma(DB, id, true);
  return json({ ok: true, khatma });
}

async function updateManagedKhatma(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const data = await readJson(request);
  const row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);

  const division = data.division || row.division || "juz";
  const khatmaType = normalizeKhatmaType(data.khatmaType || data.khatma_type || row.khatma_type);
  const parsedParticipants = parseManagedParticipants(data.participants);
  if (!parsedParticipants.ok) return json({ ok: false, error: parsedParticipants.error }, 400);
  const parsedUnits = parseManagedUnits(data, division);
  if (!parsedUnits.ok) return json({ ok: false, error: parsedUnits.error }, 400);

  const existingParticipants = (await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ?").bind(id).all()).results || [];
  const existingUnits = (await DB.prepare("SELECT * FROM managed_khatma_units WHERE khatma_id = ?").bind(id).all()).results || [];
  const existingParticipantIds = new Set(existingParticipants.map(p => p.id));
  const submittedIds = new Set(parsedParticipants.participants.map(p => p.id).filter(Boolean));
  const removedIds = [...existingParticipantIds].filter(pid => !submittedIds.has(pid));
  const busyUnits = existingUnits.filter(u => u.status === "reading" || u.status === "completed");
  const nextUnitSet = new Set(parsedUnits.unitNumbers);

  if (division !== row.division && busyUnits.length) {
    return json({ ok: false, error: "لا يمكن تغيير نوع التقسيم بعد وجود أجزاء قيد القراءة أو مكتملة" }, 409);
  }
  for (const unit of busyUnits) {
    if (!nextUnitSet.has(unit.unit_number)) return json({ ok: false, error: "لا يمكن إزالة جزء قيد القراءة أو مكتمل" }, 409);
    if (removedIds.includes(unit.participant_id)) return json({ ok: false, error: "لا يمكن حذف مشارك مرتبط بجزء قيد القراءة أو مكتمل" }, 409);
  }

  const t = now();
  const syncedProfiles = await syncManagedReadersForKhatma(DB, result.user, parsedParticipants.participants);
  const participants = syncedProfiles.map(p => ({
    ...p,
    id: p.id && existingParticipantIds.has(p.id) ? p.id : newId("mpart")
  }));
  const participantLookup = new Map();
  for (const participant of participants) {
    participantLookup.set(participant.id, participant);
    if (participant.readerProfileId) participantLookup.set(participant.readerProfileId, participant);
    participantLookup.set(participant.accessCode, participant);
    if (participant.phone) participantLookup.set(participant.phone, participant);
    participantLookup.set(participant.name, participant);
  }
  const participantIds = new Set(participants.map(p => p.id));
  const assignments = data.unitAssignments || data.assignments || {};
  const existingUnitMap = new Map(existingUnits.map(u => [u.unit_number, u]));
  const stmts = [];

  // Determine new rotation_start_date:
  // Use an explicitly provided value first, then sync with khatmaDate (the admin-set start date),
  // then fall back to the existing DB value. This keeps rotation_start_date aligned with
  // the khatma's declared start date when the admin edits the khatma.
  const newRotationStartDate = String(data.rotationStartDate || data.khatmaDate || "").trim() || row.rotation_start_date || null;

  stmts.push(DB.prepare(`
    UPDATE managed_khatmas
    SET title = ?,
        week_number = ?,
        khatma_type = ?,
        khatma_date = ?,
        hijri_date = ?,
        gregorian_date = ?,
        expires_at = ?,
        division = ?,
        selection_mode = ?,
        coordinator_name = ?,
        coordinator_whatsapp = ?,
        dedication = ?,
        quote_by = ?,
        quote_text = ?,
        quote_source = ?,
        notes = ?,
        rotation_start_date = ?
    WHERE id = ?
  `).bind(
    data.title || "ختمة مُدارة جديدة",
    data.weekNumber || "",
    khatmaType,
    data.khatmaDate || "",
    data.hijriDate || "",
    data.gregorianDate || "",
    (() => {
      const rs = newRotationStartDate || "";
      if (rs && (khatmaType === 'monthly' || khatmaType === 'weekly')) {
        return computeRotationPeriodEnd(rs, khatmaType)?.toISOString() || data.expiresAt || "";
      }
      return data.expiresAt || "";
    })(),
    division,
    parsedUnits.selectionMode,
    data.coordinatorName || "",
    data.coordinatorWhatsapp || "",
    data.dedication || "",
    data.quoteBy || "",
    data.quoteText || "",
    data.quoteSource || "",
    data.notes || "",
    newRotationStartDate,
    id
  ));

  for (const participant of participants) {
    if (existingParticipantIds.has(participant.id)) {
      stmts.push(DB.prepare(`
        UPDATE managed_khatma_participants
        SET participant_name = ?, phone = ?, access_code = ?, reader_profile_id = ?, notes = ?,
            start_juz = COALESCE(?, start_juz), parts_count = COALESCE(?, parts_count), updated_at = ?
        WHERE id = ? AND khatma_id = ?
      `).bind(participant.name, participant.phone, participant.accessCode, participant.readerProfileId || null, participant.notes,
               participant.startJuz || null, participant.partsCount || null, t, participant.id, id));
    } else {
      stmts.push(DB.prepare(`
        INSERT INTO managed_khatma_participants (id, khatma_id, participant_name, phone, access_code, reader_profile_id, notes, start_juz, parts_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(participant.id, id, participant.name, participant.phone, participant.accessCode, participant.readerProfileId || null, participant.notes,
               participant.startJuz || null, participant.partsCount || null, t, t));
    }
  }

  for (const removedId of removedIds) {
    stmts.push(DB.prepare("UPDATE managed_khatma_units SET participant_id = NULL, status = 'available', reading_at = NULL, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND participant_id = ? AND status IN ('available', 'assigned')").bind(t, id, removedId));
    stmts.push(DB.prepare("DELETE FROM managed_khatma_participants WHERE khatma_id = ? AND id = ?").bind(id, removedId));
  }

  for (const unitNumber of parsedUnits.unitNumbers) {
    const rawAssignment = assignmentValueFor(assignments, unitNumber);
    const normalized = normalizeAccessCode(rawAssignment) || normalizePhone(rawAssignment) || rawAssignment;
    const participant = participantLookup.get(rawAssignment) || participantLookup.get(normalized);
    const existing = existingUnitMap.get(unitNumber);
    const participantId = participant ? participant.id : null;
    if (existing && (existing.status === "reading" || existing.status === "completed") && existing.participant_id !== participantId) {
      return json({ ok: false, error: "لا يمكن تغيير قارئ جزء قيد القراءة أو مكتمل" }, 409);
    }
    if (participantId && !participantIds.has(participantId)) return json({ ok: false, error: "تعيين غير صحيح لأحد الأجزاء" }, 400);
    if (existing) {
      const nextStatus = participantId ? (existing.status === "available" ? "assigned" : existing.status) : "available";
      stmts.push(DB.prepare(`
        UPDATE managed_khatma_units
        SET label = ?, status = ?, participant_id = ?, reading_at = CASE WHEN ? = 'available' THEN NULL ELSE reading_at END, completed_at = CASE WHEN ? = 'available' THEN NULL ELSE completed_at END, updated_at = ?
        WHERE khatma_id = ? AND unit_number = ?
      `).bind(`${parsedUnits.meta.label} ${unitNumber}`, nextStatus, participantId, nextStatus, nextStatus, t, id, unitNumber));
    } else {
      stmts.push(DB.prepare(`
        INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `).bind(newId("munit"), id, unitNumber, `${parsedUnits.meta.label} ${unitNumber}`, participantId ? "assigned" : "available", participantId, t));
    }
  }

  for (const existing of existingUnits) {
    if (!nextUnitSet.has(existing.unit_number)) {
      stmts.push(DB.prepare("DELETE FROM managed_khatma_units WHERE khatma_id = ? AND unit_number = ? AND status IN ('available', 'assigned')").bind(id, existing.unit_number));
    }
  }

  await DB.batch(stmts);
  const khatma = await getManagedKhatma(DB, id, true);
  return json({ ok: true, khatma });
}

async function toggleManagedClose(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const row = await DB.prepare("SELECT status FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  const nextStatus = row?.status === "closed" ? "active" : "closed";
  const closedAt = nextStatus === "closed" ? now() : null;
  await DB.prepare("UPDATE managed_khatmas SET status = ?, closed_at = ? WHERE id = ?").bind(nextStatus, closedAt, id).run();
  const khatma = await getManagedKhatma(DB, id, true);
  return json({ ok: true, status: nextStatus, khatma });
}

async function deleteManagedKhatma(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  await DB.prepare("UPDATE managed_khatmas SET deleted_at = ?, status = 'closed' WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, deleted: true });
}

async function archiveManagedKhatma(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const row = await DB.prepare("SELECT archived_at FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);
  if (row.archived_at) return json({ ok: false, error: "الختمة مؤرشفة بالفعل" }, 409);
  await DB.prepare("UPDATE managed_khatmas SET archived_at = ? WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, archived: true });
}

async function unarchiveManagedKhatma(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  await DB.prepare("UPDATE managed_khatmas SET archived_at = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true, unarchived: true });
}

async function duplicateManagedKhatma(request, DB, id) {
  const result = await requireManagedControl(request, DB, id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const body = await readJson(request);
  const withParticipants = body.withParticipants === true;
  const row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);
  const nid = newId("mkhatma");
  const t = now();
  await DB.prepare(`
    INSERT INTO managed_khatmas (
      id, title, week_number, khatma_type, khatma_date, hijri_date, gregorian_date, expires_at,
      division, selection_mode, owner_name, created_by_user_id, coordinator_name, coordinator_whatsapp,
      dedication, quote_by, quote_text, quote_source, notes, status, created_at, closed_at, deleted_at,
      group_id, rotation_start_date, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, NULL)
  `).bind(
    nid, (row.title || "") + " - نسخة", row.week_number || "",
    row.khatma_type || "monthly", row.khatma_date || "", row.hijri_date || "",
    row.gregorian_date || "", row.expires_at || "", row.division || "juz",
    row.selection_mode || "all", row.owner_name || "", result.user.id,
    row.coordinator_name || "", row.coordinator_whatsapp || "",
    row.dedication || "", row.quote_by || "", row.quote_text || "",
    row.quote_source || "", row.notes || "",
    t, row.group_id || null, row.rotation_start_date || null
  ).run();
  const units = (await DB.prepare("SELECT * FROM managed_khatma_units WHERE khatma_id = ? ORDER BY unit_number ASC").bind(id).all()).results || [];
  if (units.length) {
    const stmts = [];
    if (withParticipants) {
      const participants = (await DB.prepare("SELECT * FROM managed_khatma_participants WHERE khatma_id = ?").bind(id).all()).results || [];
      const pidMap = new Map();
      const pStmt = DB.prepare("INSERT INTO managed_khatma_participants (id, khatma_id, participant_name, phone, access_code, reader_profile_id, notes, start_juz, parts_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const p of participants) {
        const np = newId("mpart");
        pidMap.set(p.id, np);
        stmts.push(pStmt.bind(np, nid, p.participant_name, p.phone, p.access_code, p.reader_profile_id || null, p.notes || "", p.start_juz || null, p.parts_count || null, t, t));
      }
      const uStmt = DB.prepare("INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'available', ?, NULL, NULL, ?)");
      for (const u of units) stmts.push(uStmt.bind(newId("munit"), nid, u.unit_number, u.label, u.participant_id ? (pidMap.get(u.participant_id) || null) : null, t));
    } else {
      const uStmt = DB.prepare("INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'available', NULL, NULL, NULL, ?)");
      for (const u of units) stmts.push(uStmt.bind(newId("munit"), nid, u.unit_number, u.label, t));
    }
    await DB.batch(stmts);
  }
  const khatma = await getManagedKhatma(DB, nid, true);
  return json({ ok: true, khatma, newId: nid }, 201);
}

async function managedUnitAction(request, DB, khatmaId, number, action) {
  await ensureManagedSchema(DB);
  const body = await readJson(request);
  const khatma = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(khatmaId).first();
  if (!khatma) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);
  const unitNumber = Number(number);
  const unit = await DB.prepare(`
    SELECT u.*, p.participant_name, p.phone, p.access_code
    FROM managed_khatma_units u
    LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ? AND u.unit_number = ?
    LIMIT 1
  `).bind(khatmaId, unitNumber).first();
  if (!unit) return json({ ok: false, error: "الجزء غير موجود" }, 404);

  const user = await currentUser(request, DB);
  const manager = user && (user.role === "owner" || (user.id === khatma.created_by_user_id && await hasManagedPermission(DB, user)));
  if (khatma.status === "closed" && !manager) return json({ ok: false, error: "الختمة مغلقة من قبل المنشئ" }, 409);

  if (action === "available") {
    if (!manager) return json({ ok: false, error: "إعادة الإتاحة مخصصة لصاحب الختمة" }, 403);
    await DB.prepare("UPDATE managed_khatma_units SET status = 'available', participant_id = NULL, reading_at = NULL, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND unit_number = ?").bind(now(), khatmaId, unitNumber).run();
    return json({ ok: true, khatma: await getManagedKhatma(DB, khatmaId, manager) });
  }

  if (!unit.participant_id) return json({ ok: false, error: "لم يتم تعيين قارئ لهذا الجزء" }, 409);
  let viewerParticipant = null;
  if (!manager) {
    const identityRaw = String(body.identity || body.phone || body.accessCode || body.code || "").trim();
    const identityCode = normalizeAccessCode(identityRaw);
    const identityPhone = normalizePhone(identityRaw);
    const validCode = identityCode && identityCode === String(unit.access_code || "");
    const validPhone = identityPhone && identityPhone.length >= 9 && identityPhone === normalizePhone(unit.phone || "");
    const validName = identityRaw && identityRaw.trim() === String(unit.participant_name || "").trim();

    if (!validCode && !validPhone && !validName) {
      // Fallback: check if the incoming identity matches any sibling participant
      // in this khatma that shares reader_profile_id with the unit's participant.
      // This covers readers who have multiple participant records in the same khatma.
      let allowedViaSiblingProfile = false;
      const unitParticipantRow = await DB.prepare(
        "SELECT reader_profile_id FROM managed_khatma_participants WHERE id = ? LIMIT 1"
      ).bind(unit.participant_id).first();
      if (unitParticipantRow?.reader_profile_id) {
        const conditions = [];
        const params = [khatmaId, unitParticipantRow.reader_profile_id];
        if (identityCode && isValidAccessCode(identityCode)) { conditions.push("access_code = ?"); params.push(identityCode); }
        if (identityPhone && identityPhone.length >= 9) { conditions.push("phone = ?"); params.push(identityPhone); }
        if (identityRaw.length >= 2) { conditions.push("participant_name = ?"); params.push(identityRaw); }
        if (conditions.length) {
          const sibling = await DB.prepare(
            `SELECT id FROM managed_khatma_participants WHERE khatma_id = ? AND reader_profile_id = ? AND (${conditions.join(" OR ")}) LIMIT 1`
          ).bind(...params).first();
          allowedViaSiblingProfile = !!sibling;
        }
      }
      if (!allowedViaSiblingProfile) return json({ ok: false, error: "الكود أو رقم الجوال أو الاسم غير صحيح" }, 403);
    }

    viewerParticipant = await DB.prepare("SELECT * FROM managed_khatma_participants WHERE id = ? LIMIT 1").bind(unit.participant_id).first();
  }

  const t = now();
  if (action === "reading") {
    if (unit.status !== "assigned" && unit.status !== "reading") return json({ ok: false, error: "لا يمكن تحويل هذا الجزء إلى جاري القراءة" }, 409);
    await DB.prepare("UPDATE managed_khatma_units SET status = 'reading', reading_at = ?, completed_at = NULL, updated_at = ? WHERE khatma_id = ? AND unit_number = ?").bind(t, t, khatmaId, unitNumber).run();
  } else if (action === "complete") {
    if (unit.status !== "assigned" && unit.status !== "reading" && unit.status !== "completed") return json({ ok: false, error: "لا يمكن إغلاق هذا الجزء قبل تعيين قارئه" }, 409);
    await DB.prepare("UPDATE managed_khatma_units SET status = 'completed', completed_at = ?, updated_at = ? WHERE khatma_id = ? AND unit_number = ?").bind(t, t, khatmaId, unitNumber).run();
  } else {
    return json({ ok: false, error: "إجراء غير معروف" }, 400);
  }

  return json({ ok: true, khatma: manager ? await getManagedKhatma(DB, khatmaId, true) : await getManagedKhatmaParticipantView(DB, khatmaId, viewerParticipant) });
}

async function readerPortal(request, DB) {
  await ensureManagedSchema(DB);
  const body = await readJson(request);
  const identityRaw = String(body.identity || "").trim();
  if (!identityRaw) return json({ ok: false, error: "أدخل الكود أو رقم الجوال أو الاسم" }, 400);
  const accessCode = normalizeAccessCode(identityRaw);
  const phone = normalizePhone(identityRaw);
  const base = `SELECT mcp.* FROM managed_khatma_participants mcp
    JOIN managed_khatmas mk ON mk.id = mcp.khatma_id AND mk.deleted_at IS NULL`;
  let participants = [];
  // Serial code lookup (R-XXXXXX) — view-only; does not grant mark-as-complete rights
  if (/^R-\d{1,6}$/i.test(identityRaw.trim())) {
    const normalizedSerial = identityRaw.trim().toUpperCase();
    const profileRow = await DB.prepare(
      "SELECT id FROM managed_reader_profiles WHERE serial_code = ? AND status != 'deleted' LIMIT 1"
    ).bind(normalizedSerial).first();
    if (profileRow) {
      participants = (await DB.prepare(base + " WHERE mcp.reader_profile_id = ?").bind(profileRow.id).all()).results || [];
    }
  }
  if (!participants.length && accessCode && isValidAccessCode(accessCode)) {
    participants = (await DB.prepare(base + " WHERE mcp.access_code = ?").bind(accessCode).all()).results || [];
  }
  if (!participants.length && phone && phone.length >= 9) {
    participants = (await DB.prepare(base + " WHERE mcp.phone = ?").bind(phone).all()).results || [];
  }
  if (!participants.length && identityRaw.length >= 2) {
    participants = (await DB.prepare(base + " WHERE mcp.participant_name = ?").bind(identityRaw).all()).results || [];
  }
  if (!participants.length) return json({ ok: false, error: "لم يتم العثور على بياناتك في أي ختمة مُدارة" }, 404);
  const khatmas = [];
  for (const p of participants) {
    const view = await getManagedKhatmaParticipantView(DB, p.khatma_id, p);
    if (view) khatmas.push(view);
  }
  // Fetch reader profile data for display in portal welcome card
  const profileId = participants.find(p => p.reader_profile_id)?.reader_profile_id;
  let readerProfile = null;
  if (profileId) {
    const profileRow = await DB.prepare(
      "SELECT serial_code, country, reader_name FROM managed_reader_profiles WHERE id = ? LIMIT 1"
    ).bind(profileId).first();
    if (profileRow) readerProfile = {
      serialCode: profileRow.serial_code || "",
      country:    profileRow.country || "",
      name:       profileRow.reader_name || ""
    };
  }
  return json({ ok: true, identity: identityRaw, khatmas, readerProfile });
}

async function systemBackup(request, DB) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const safeAll = async (stmt) => { try { return (await stmt.all()).results || []; } catch { return []; } };
  const [
    users,
    khatmas, khatmaUnits,
    managedKhatmas, managedParticipants, managedUnits,
    readers, readerGroups,
    permissions,
    creatorGroups, creatorGroupMembers,
    khatmaTemplates
  ] = await Promise.all([
    safeAll(DB.prepare("SELECT id, username, display_name, role, status, created_at, updated_at FROM users WHERE status != 'deleted'")),
    safeAll(DB.prepare("SELECT * FROM khatmas WHERE deleted_at IS NULL")),
    safeAll(DB.prepare("SELECT * FROM khatma_units")),
    safeAll(DB.prepare("SELECT * FROM managed_khatmas WHERE deleted_at IS NULL")),
    safeAll(DB.prepare("SELECT * FROM managed_khatma_participants")),
    safeAll(DB.prepare("SELECT * FROM managed_khatma_units")),
    safeAll(DB.prepare("SELECT * FROM managed_reader_profiles WHERE status != 'deleted'")),
    safeAll(DB.prepare("SELECT * FROM managed_reader_groups WHERE status != 'deleted'")),
    safeAll(DB.prepare("SELECT * FROM managed_khatma_permissions")),
    safeAll(DB.prepare("SELECT * FROM managed_creator_groups")),
    safeAll(DB.prepare("SELECT * FROM managed_creator_group_members")),
    safeAll(DB.prepare("SELECT * FROM khatma_templates"))
  ]);
  const ts = now();
  return json({
    ok: true, version: "v5", timestamp: ts, exportedAt: new Date().toISOString(),
    summary: {
      users: users.length, khatmas: khatmas.length, managedKhatmas: managedKhatmas.length,
      readers: readers.length, readerGroups: readerGroups.length,
      permissions: permissions.length, creatorGroups: creatorGroups.length,
      khatmaTemplates: khatmaTemplates.length
    },
    data: {
      users,
      khatmas, khatmaUnits,
      managedKhatmas, managedParticipants, managedUnits,
      readers, readerGroups,
      permissions, creatorGroups, creatorGroupMembers,
      khatmaTemplates
    }
  });
}

async function ensureBackupLogsSchema(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
}

async function systemRestore(request, DB) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;

  const body = await readJson(request);
  const data = body.data;

  // --- Validate ---
  if (!body.version || body.version !== "v5") {
    return json({ ok: false, error: "ملف النسخة الاحتياطية غير متوافق. يجب أن يكون الإصدار v5." }, 400);
  }
  if (!data || typeof data !== "object") {
    return json({ ok: false, error: "الملف لا يحتوي على بيانات صالحة." }, 400);
  }
  if (!Array.isArray(data.users)) {
    return json({ ok: false, error: "الملف لا يحتوي على قائمة المستخدمين." }, 400);
  }

  const currentUserId = check.user.id;
  const authHeader = request.headers.get("authorization") || "";
  const currentToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);
  await ensureCreatorGroupSchema(DB);
  await ensureBackupLogsSchema(DB);
  await ensureKhatmaTemplateSchema(DB);

  // Helper: safe batch insert (ignores unknown columns gracefully via INSERT OR IGNORE)
  const safeInsert = async (table, rows, columns) => {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let count = 0;
    for (const row of rows) {
      try {
        const vals = columns.map(c => row[c] !== undefined ? row[c] : null);
        const placeholders = columns.map(() => "?").join(", ");
        await DB.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...vals).run();
        count++;
      } catch { /* skip bad row */ }
    }
    return count;
  };

  // --- DELETE (ordered: children first, parents last) ---
  const deletes = [
    "DELETE FROM managed_khatma_units",
    "DELETE FROM managed_khatma_participants",
    "DELETE FROM managed_khatma_permissions",
    "DELETE FROM managed_creator_group_members",
    "DELETE FROM managed_creator_groups",
    "DELETE FROM managed_khatmas",
    "DELETE FROM managed_reader_profiles",
    "DELETE FROM managed_reader_groups",
    "DELETE FROM khatma_units",
    "DELETE FROM khatmas",
    "DELETE FROM khatma_templates",
    `DELETE FROM user_sessions WHERE token != '${currentToken.replace(/'/g,"''")}'`,
    `DELETE FROM users WHERE id != '${currentUserId.replace(/'/g,"''")}'`,
  ];
  for (const stmt of deletes) {
    try { await DB.prepare(stmt).run(); } catch { /* table may not exist */ }
  }

  // --- INSERT (ordered: parents first, children last) ---
  const t = now();

  // users — skip the current owner (already exists)
  const usersToInsert = (data.users || []).filter(u => u.id !== currentUserId);
  const uCount = await safeInsert("users", usersToInsert, ["id","username","display_name","password_hash","role","status","created_at","updated_at"]);

  const kCount   = await safeInsert("khatmas",                    data.khatmas || [],                ["id","title","week_number","khatma_type","khatma_date","hijri_date","gregorian_date","expires_at","division","selection_mode","owner_name","owner_key","coordinator_name","coordinator_whatsapp","created_by_user_id","dedication","quote_by","quote_text","quote_source","notes","status","deleted_at","created_at","updated_at"]);
  const kuCount  = await safeInsert("khatma_units",               data.khatmaUnits || [],            ["id","khatma_id","number","label","status","participant_name","phone","reading_at","completed_at","created_at","updated_at"]);
  const rgCount  = await safeInsert("managed_reader_groups",      data.readerGroups || [],           ["id","name","rotation_type","rotation_start_date","rotation_duration_years","status","created_by_user_id","created_at","updated_at"]);
  const rCount   = await safeInsert("managed_reader_profiles",    data.readers || [],                ["id","reader_name","phone","access_code","group_id","start_juz","parts_count","notes","status","created_by_user_id","created_at","updated_at"]);
  const mkCount  = await safeInsert("managed_khatmas",            data.managedKhatmas || [],         ["id","title","week_number","khatma_type","hijri_date","gregorian_date","expires_at","rotation_start_date","division","selection_mode","coordinator_name","coordinator_whatsapp","dedication","quote_by","quote_text","quote_source","notes","status","archived_at","current_period_index","created_by_user_id","deleted_at","created_at","updated_at"]);
  const permCount= await safeInsert("managed_khatma_permissions", data.permissions || [],            ["id","user_id","status","created_at","updated_at"]);
  const cgCount  = await safeInsert("managed_creator_groups",     data.creatorGroups || [],          ["id","name","created_by_user_id","created_at","updated_at"]);
  const cgmCount = await safeInsert("managed_creator_group_members", data.creatorGroupMembers || [], ["id","group_id","user_id","created_at"]);
  const mpCount  = await safeInsert("managed_khatma_participants", data.managedParticipants || [],   ["id","khatma_id","participant_name","phone","access_code","reader_profile_id","start_juz","parts_count","notes","created_at","updated_at"]);
  const muCount  = await safeInsert("managed_khatma_units",       data.managedUnits || [],          ["id","khatma_id","number","label","status","participant_id","participant_name","phone","reading_at","completed_at","created_at","updated_at"]);
  const tplCount = await safeInsert("khatma_templates",           data.khatmaTemplates || [],        ["id","created_by_user_id","name","data","created_at","updated_at"]);

  // Log the restore
  const summary = JSON.stringify({ users: uCount, khatmas: kCount, managedKhatmas: mkCount, readers: rCount, readerGroups: rgCount, permissions: permCount, creatorGroups: cgCount, khatmaTemplates: tplCount });
  try {
    await DB.prepare("INSERT INTO backup_logs (id, action, performed_by, summary, created_at) VALUES (?, 'restore', ?, ?, ?)")
      .bind(newId("bklog"), currentUserId, summary, t).run();
  } catch { /* log failure is non-fatal */ }

  return json({
    ok: true,
    message: "تمت الاستعادة بنجاح",
    restored: { users: uCount, khatmas: kCount, khatmaUnits: kuCount, managedKhatmas: mkCount, managedParticipants: mpCount, managedUnits: muCount, readers: rCount, readerGroups: rgCount, permissions: permCount, creatorGroups: cgCount, creatorGroupMembers: cgmCount, khatmaTemplates: tplCount }
  });
}

async function dashboardStats(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);

  const isOwner = check.user.role === "owner";
  const memberIds    = isOwner ? [] : await getCreatorGroupMemberIds(DB, check.user.id);
  const userGroupIds = isOwner ? [] : await getUserGroupIds(DB, check.user.id);

  const safeFirst = async (stmt) => { try { return (await stmt.first()) || {}; } catch { return {}; } };
  const safeAll   = async (stmt) => { try { return (await stmt.all()).results || []; } catch { return []; } };

  // Build khatma WHERE clause — mirrors /managed-khatmas logic:
  // include khatmas created by group members OR shared with any of the user's creator groups
  let khatmaClause, kp;
  if (isOwner) {
    khatmaClause = "";
    kp = [];
  } else if (userGroupIds.length) {
    const sharedClause = `OR (mk.shared_creator_group_id IS NOT NULL AND mk.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")}))`;
    khatmaClause = `AND (mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")}) ${sharedClause})`;
    kp = [...memberIds, ...userGroupIds];
  } else {
    khatmaClause = `AND mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
    kp = memberIds;
  }

  // Reader/group clause stays scoped to creator-group membership (not shared records)
  const readerClause = isOwner ? "" : `AND created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
  const rp = isOwner ? [] : memberIds; // separate params — readerClause has no shared sub-clause

  const [khatmaStats, unitStats, topReadersRows, byMonthRows, readerCount, groupCount] = await Promise.all([
    safeFirst(DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) as archived,
        SUM(CASE WHEN khatma_type = 'weekly' THEN 1 ELSE 0 END) as weekly,
        SUM(CASE WHEN khatma_type = 'monthly' THEN 1 ELSE 0 END) as monthly,
        SUM(CASE WHEN khatma_type = 'yearly' THEN 1 ELSE 0 END) as yearly
      FROM managed_khatmas mk WHERE deleted_at IS NULL ${khatmaClause}
    `).bind(...kp)),

    safeFirst(DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN u.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN u.status = 'reading'   THEN 1 ELSE 0 END) as reading,
        SUM(CASE WHEN u.status = 'assigned'  THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN u.status = 'available' THEN 1 ELSE 0 END) as available
      FROM managed_khatma_units u
      JOIN managed_khatmas mk ON mk.id = u.khatma_id AND mk.deleted_at IS NULL
      WHERE 1=1 ${khatmaClause}
    `).bind(...kp)),

    safeAll(DB.prepare(`
      SELECT u.participant_name as name, COUNT(*) as cnt
      FROM managed_khatma_units u
      JOIN managed_khatmas mk ON mk.id = u.khatma_id AND mk.deleted_at IS NULL
      WHERE u.status = 'completed'
        AND u.participant_name IS NOT NULL AND u.participant_name != ''
        ${khatmaClause}
      GROUP BY u.participant_name ORDER BY cnt DESC LIMIT 10
    `).bind(...kp)),

    safeAll(DB.prepare(`
      SELECT strftime('%Y-%m', u.completed_at) as ym, COUNT(*) as cnt
      FROM managed_khatma_units u
      JOIN managed_khatmas mk ON mk.id = u.khatma_id AND mk.deleted_at IS NULL
      WHERE u.status = 'completed' AND u.completed_at IS NOT NULL
        AND u.completed_at >= date('now', '-6 months')
        ${khatmaClause}
      GROUP BY ym ORDER BY ym ASC
    `).bind(...kp)),

    safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM managed_reader_profiles
      WHERE status != 'deleted' ${readerClause}
    `).bind(...rp)),

    safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM managed_reader_groups
      WHERE status != 'deleted' ${readerClause}
    `).bind(...rp)),
  ]);

  return json({
    ok: true,
    khatmas: {
      total:   Number(khatmaStats.total   || 0),
      active:  Number(khatmaStats.active  || 0),
      archived:Number(khatmaStats.archived|| 0),
      weekly:  Number(khatmaStats.weekly  || 0),
      monthly: Number(khatmaStats.monthly || 0),
      yearly:  Number(khatmaStats.yearly  || 0),
    },
    units: {
      total:    Number(unitStats.total    || 0),
      completed:Number(unitStats.completed|| 0),
      reading:  Number(unitStats.reading  || 0),
      assigned: Number(unitStats.assigned || 0),
      available:Number(unitStats.available|| 0),
    },
    readers: { total: Number(readerCount.total || 0) },
    groups:  { total: Number(groupCount.total  || 0) },
    topReaders: topReadersRows.map(r => ({ name: r.name, count: Number(r.cnt) })),
    byMonth:    byMonthRows.map(r => ({ month: r.ym, count: Number(r.cnt) })),
  });
}

async function readerGlobalSearch(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q || q.length < 2) return json({ ok: true, readers: [], participants: [] });

  await ensureManagedSchema(DB);

  const isOwner = check.user.role === "owner";
  const memberIds = isOwner ? [] : await getCreatorGroupMemberIds(DB, check.user.id);

  const like = `%${q}%`;
  const kp   = isOwner ? [] : memberIds;
  const kClause = isOwner ? "" : `AND mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
  const rClause = isOwner ? "" : `AND mrp.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;

  const safeAll = async (stmt) => { try { return (await stmt.all()).results || []; } catch { return []; } };

  const [readerRows, participantRows] = await Promise.all([
    safeAll(DB.prepare(`
      SELECT mrp.id, mrp.reader_name AS name, mrp.phone, mrp.access_code, mrp.serial_code,
             mrp.start_juz, mrp.parts_count, mrp.notes,
             mrg.name AS group_name, mrg.id AS group_id
      FROM managed_reader_profiles mrp
      LEFT JOIN managed_reader_groups mrg ON mrg.id = mrp.group_id
      WHERE mrp.status != 'deleted'
        AND (mrp.reader_name LIKE ? OR mrp.phone LIKE ? OR mrp.access_code LIKE ? OR mrp.serial_code LIKE ?)
        ${rClause}
      LIMIT 15
    `).bind(like, like, like, like, ...kp)),

    safeAll(DB.prepare(`
      SELECT mcp.id, mcp.participant_name AS name, mcp.phone, mcp.access_code,
             mcp.start_juz, mcp.parts_count, mcp.notes,
             mk.title AS khatma_title, mk.week_number, mk.khatma_type, mk.id AS khatma_id
      FROM managed_khatma_participants mcp
      JOIN managed_khatmas mk ON mk.id = mcp.khatma_id AND mk.deleted_at IS NULL
      WHERE (mcp.participant_name LIKE ? OR mcp.phone LIKE ? OR mcp.access_code LIKE ?)
        ${kClause}
      LIMIT 15
    `).bind(like, like, like, ...kp)),
  ]);

  return json({
    ok: true,
    query: q,
    readers: readerRows.map(r => ({
      type: "reader", id: r.id, name: r.name || "",
      phone: r.phone || "", accessCode: r.access_code || "",
      serialCode: r.serial_code || "",
      startJuz: r.start_juz || "", partsCount: r.parts_count || "",
      notes: r.notes || "", groupName: r.group_name || "", groupId: r.group_id || "",
    })),
    participants: participantRows.map(p => ({
      type: "participant", id: p.id, name: p.name || "",
      phone: p.phone || "", accessCode: p.access_code || "",
      startJuz: p.start_juz || "", partsCount: p.parts_count || "",
      notes: p.notes || "", khatmaTitle: p.khatma_title || "",
      weekNumber: p.week_number || "", khatmaType: p.khatma_type || "",
      khatmaId: p.khatma_id || "",
    })),
  });
}

async function shareManagedKhatma(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT id FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "الختمة غير موجودة" }, 404);
  const body = await readJson(request);
  const groupId = String(body.groupId || "").trim() || null;
  if (groupId) {
    await ensureCreatorGroupSchema(DB);
    const group = await DB.prepare("SELECT id FROM managed_creator_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(groupId).first();
    if (!group) return json({ ok: false, error: "مجموعة المنشئين غير موجودة" }, 404);
  }
  await DB.prepare("UPDATE managed_khatmas SET shared_creator_group_id = ? WHERE id = ?").bind(groupId, id).run();
  return json({ ok: true, sharedCreatorGroupId: groupId });
}
async function shareManagedReader(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT id FROM managed_reader_profiles WHERE id = ? AND status != 'deleted' LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "القارئ غير موجود" }, 404);
  const body = await readJson(request);
  const groupId = String(body.groupId || "").trim() || null;
  if (groupId) {
    await ensureCreatorGroupSchema(DB);
    const group = await DB.prepare("SELECT id FROM managed_creator_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(groupId).first();
    if (!group) return json({ ok: false, error: "مجموعة المنشئين غير موجودة" }, 404);
  }
  await DB.prepare("UPDATE managed_reader_profiles SET shared_creator_group_id = ? WHERE id = ?").bind(groupId, id).run();
  return json({ ok: true, sharedCreatorGroupId: groupId });
}
async function shareManagedReaderGroup(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const row = await DB.prepare("SELECT id FROM managed_reader_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(id).first();
  if (!row) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  const body = await readJson(request);
  const groupId = String(body.groupId || "").trim() || null;
  if (groupId) {
    await ensureCreatorGroupSchema(DB);
    const group = await DB.prepare("SELECT id FROM managed_creator_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(groupId).first();
    if (!group) return json({ ok: false, error: "مجموعة المنشئين غير موجودة" }, 404);
  }
  await DB.prepare("UPDATE managed_reader_groups SET shared_creator_group_id = ? WHERE id = ?").bind(groupId, id).run();
  return json({ ok: true, sharedCreatorGroupId: groupId });
}

async function readerLookup(request, DB) {
  await ensureManagedSchema(DB);
  const body = await readJson(request);
  const identityRaw = String(body.identity || "").trim();
  if (!identityRaw) return json({ ok: false, error: "أدخل الكود أو رقم الجوال أو الاسم" }, 400);
  const accessCode = normalizeAccessCode(identityRaw);
  const phone = normalizePhone(identityRaw);
  const base = `
    SELECT mcp.id, mcp.khatma_id, mcp.participant_name, mcp.access_code, mcp.phone,
           mk.title, mk.hijri_date, mk.gregorian_date, mk.status AS khatma_status,
           mk.khatma_type, mk.week_number, mk.coordinator_name
    FROM managed_khatma_participants mcp
    JOIN managed_khatmas mk ON mk.id = mcp.khatma_id AND mk.deleted_at IS NULL
  `;
  let rows = [];
  if (accessCode && isValidAccessCode(accessCode)) {
    rows = (await DB.prepare(base + " WHERE mcp.access_code = ?").bind(accessCode).all()).results || [];
  }
  if (!rows.length && phone && phone.length >= 9) {
    rows = (await DB.prepare(base + " WHERE mcp.phone = ?").bind(phone).all()).results || [];
  }
  if (!rows.length && identityRaw.length >= 2) {
    rows = (await DB.prepare(base + " WHERE mcp.participant_name = ?").bind(identityRaw).all()).results || [];
  }
  if (!rows.length) return json({ ok: false, error: "لم يتم العثور على بياناتك في أي ختمة مُدارة" }, 404);
  return json({ ok: true, identity: identityRaw, khatmas: rows.map(p => ({
    khatmaId: p.khatma_id, participantId: p.id,
    participantName: p.participant_name, accessCode: p.access_code,
    title: p.title || "", weekNumber: p.week_number || "",
    khatmaType: p.khatma_type || "monthly", hijriDate: p.hijri_date || "",
    gregorianDate: p.gregorian_date || "", khatmaStatus: p.khatma_status || "active",
    coordinatorName: p.coordinator_name || ""
  })) });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const parts = getPathParts(context);
  try {
    if (!env.DB) return json({ ok: false, error: "تعذر الاتصال بقاعدة البيانات: DB binding missing" }, 500);
    if (method === "OPTIONS") return json({ ok: true });
    if (method === "GET" && parts.length === 1 && parts[0] === "health") {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, db: true });
    }
    if (parts.length === 2 && parts[0] === "auth" && parts[1] === "login" && method === "POST") return login(request, env.DB);
    if (parts.length === 2 && parts[0] === "auth" && parts[1] === "me" && method === "GET") return me(request, env.DB);
    if (parts.length === 2 && parts[0] === "auth" && parts[1] === "logout" && method === "POST") return logout(request, env.DB);
    if (parts.length === 1 && parts[0] === "users") {
      if (method === "GET") return listUsers(request, env.DB);
      if (method === "POST") return createUser(request, env.DB);
    }
    if (parts.length === 3 && parts[0] === "users" && parts[2] === "reset-password" && method === "POST") return resetUserPassword(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "users" && parts[2] === "status" && method === "POST") return setUserStatus(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "users" && parts[2] === "managed-permission" && method === "POST") return setManagedUserPermission(request, env.DB, parts[1]);
    if (parts.length === 2 && parts[0] === "users" && method === "DELETE") return deleteUser(request, env.DB, parts[1]);
    if (parts.length === 1 && parts[0] === "managed-creator-groups") {
      if (method === "GET") return listCreatorGroups(request, env.DB);
      if (method === "POST") return createCreatorGroup(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "managed-creator-groups" && method === "DELETE") return deleteCreatorGroup(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-creator-groups" && parts[2] === "members" && method === "POST") return addCreatorGroupMember(request, env.DB, parts[1]);
    if (parts.length === 4 && parts[0] === "managed-creator-groups" && parts[2] === "members" && method === "DELETE") return removeCreatorGroupMember(request, env.DB, parts[1], parts[3]);
    if (parts.length === 3 && parts[0] === "managed-creator-groups" && parts[2] === "dashboard" && method === "GET") return creatorGroupDashboard(request, env.DB, parts[1]);
    if (parts.length === 1 && parts[0] === "khatma-templates") {
      if (method === "GET") return listKhatmaTemplates(request, env.DB);
      if (method === "POST") return createKhatmaTemplate(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "khatma-templates" && method === "DELETE") return deleteKhatmaTemplate(request, env.DB, parts[1]);
    if (parts.length === 4 && parts[0] === "managed-khatmas" && parts[2] === "admin" && parts[3] === "share" && method === "POST") return shareManagedKhatma(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-readers" && parts[2] === "share" && method === "POST") return shareManagedReader(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-reader-groups" && parts[2] === "share" && method === "POST") return shareManagedReaderGroup(request, env.DB, parts[1]);
    if (parts.length === 1 && parts[0] === "reader-lookup" && method === "POST") return readerLookup(request, env.DB);
    if (parts.length === 1 && parts[0] === "reader-portal" && method === "POST") return readerPortal(request, env.DB);
    if (parts.length === 1 && parts[0] === "system-backup" && method === "GET") return systemBackup(request, env.DB);
    if (parts.length === 1 && parts[0] === "system-restore" && method === "POST") return systemRestore(request, env.DB);
    if (parts.length === 1 && parts[0] === "dashboard-stats" && method === "GET") return dashboardStats(request, env.DB);
    if (parts.length === 1 && parts[0] === "reader-global-search" && method === "GET") return readerGlobalSearch(request, env.DB);
    if (parts.length === 1 && parts[0] === "managed-reader-groups") {
      if (method === "GET") return listReaderGroups(request, env.DB);
      if (method === "POST") return createReaderGroup(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "managed-reader-groups") {
      if (method === "PUT" || method === "POST") return updateReaderGroup(request, env.DB, parts[1]);
      if (method === "DELETE") return deleteReaderGroup(request, env.DB, parts[1]);
    }
    if (parts.length === 1 && parts[0] === "managed-readers") {
      if (method === "GET") return listManagedReaders(request, env.DB);
      if (method === "POST") return upsertManagedReaders(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "managed-readers" && method === "DELETE") return deleteManagedReader(request, env.DB, parts[1]);
    if (parts.length === 1 && parts[0] === "managed-khatmas") {
      if (method === "GET") return listManagedKhatmas(request, env.DB);
      if (method === "POST") return createManagedKhatma(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "managed-khatmas" && method === "GET") return getManagedPublic(env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-khatmas" && parts[2] === "verify" && method === "POST") return verifyManagedPublic(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-khatmas" && parts[2] === "admin" && method === "GET") return getManagedAdmin(request, env.DB, parts[1]);
    if (parts.length === 4 && parts[0] === "managed-khatmas" && parts[2] === "admin") {
      if (method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (parts[3] === "update") return updateManagedKhatma(request, env.DB, parts[1]);
      if (parts[3] === "toggle-close") return toggleManagedClose(request, env.DB, parts[1]);
      if (parts[3] === "delete") return deleteManagedKhatma(request, env.DB, parts[1]);
      if (parts[3] === "archive") return archiveManagedKhatma(request, env.DB, parts[1]);
      if (parts[3] === "unarchive") return unarchiveManagedKhatma(request, env.DB, parts[1]);
      if (parts[3] === "duplicate") return duplicateManagedKhatma(request, env.DB, parts[1]);
    }
    if (parts.length === 5 && parts[0] === "managed-khatmas" && parts[2] === "units") {
      if (method !== "POST" && method !== "PATCH") return json({ ok: false, error: "Method not allowed" }, 405);
      return managedUnitAction(request, env.DB, parts[1], parts[3], parts[4]);
    }
    if (parts.length === 1 && parts[0] === "khatmas") {
      const chk = await requireOwner(request, env.DB); if (!chk.ok) return chk.response;
      if (method === "GET") return listKhatmas(request, env.DB);
      if (method === "POST") return createKhatma(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "khatmas" && method === "GET") {
      const chk = await requireOwner(request, env.DB); if (!chk.ok) return chk.response;
      const khatma = await getKhatma(env.DB, parts[1]);
      if (!khatma) return json({ ok: false, error: "الختمة غير موجودة" }, 404);
      return json({ ok: true, khatma });
    }
    if (parts.length === 4 && parts[0] === "khatmas" && parts[2] === "admin") {
      const chk = await requireOwner(request, env.DB); if (!chk.ok) return chk.response;
      if (method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (parts[3] === "verify") return verifyAdmin(request, env.DB, parts[1]);
      if (parts[3] === "toggle-close") return toggleClose(request, env.DB, parts[1]);
      if (parts[3] === "update") return updateKhatma(request, env.DB, parts[1]);
      if (parts[3] === "delete") return softDelete(request, env.DB, parts[1]);
    }
    if (parts.length === 5 && parts[0] === "khatmas" && parts[2] === "units") {
      const chk = await requireOwner(request, env.DB); if (!chk.ok) return chk.response;
      if (method !== "POST" && method !== "PATCH") return json({ ok: false, error: "Method not allowed" }, 405);
      return unitAction(request, env.DB, parts[1], parts[3], parts[4]);
    }
    return json({ ok: false, error: "Not found", path: parts }, 404);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Unexpected error" }, 500);
  }
}
