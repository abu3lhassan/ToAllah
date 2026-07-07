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
function isWithinRolloverClosingWindow(date, windowDays) {
  const today = getHijriPartsServer(date);
  const monthEnd = hijriMonthEndDateServer(date);
  const daysInMonth = getHijriPartsServer(monthEnd).day;
  const daysRemaining = daysInMonth - today.day;
  return daysRemaining <= (windowDays - 1);
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
    // Math.max(0,...) handles future khatmas: idx=0 when start hasn't arrived yet
    const idx = Math.max(0, Math.floor((now - start) / (7 * 86400000)));
    // Use calendar date arithmetic (not ms) so the end-of-day lands at
    // 20:59:59 UTC = 23:59:59 Saudi (UTC+3), matching the monthly convention.
    // end date = start + (idx+1)*7 - 1 calendar days
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + (idx + 1) * 7 - 1);
    end.setUTCHours(20, 59, 59, 999);
    return end;
  }
  if (rotationType === 'yearly') {
    const start = new Date(rotationStartDate);
    if (isNaN(start)) return null;
    // Count complete years elapsed since start (handles leap years via setUTCFullYear)
    let idx = 0;
    const ref = new Date(start);
    while (true) {
      ref.setUTCFullYear(ref.getUTCFullYear() + 1);
      if (ref <= now) idx++;
      else break;
    }
    // End = start + (idx+1) years, minus 1 day, at 20:59:59 UTC (= 23:59:59 Saudi/UTC+3)
    const end = new Date(start);
    end.setUTCFullYear(start.getUTCFullYear() + idx + 1);
    end.setUTCDate(end.getUTCDate() - 1);
    end.setUTCHours(20, 59, 59, 999);
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
// Returns a set of candidate phone strings to match against in DB (exact IN query).
// Covers: local format, international with/without +, core digits without leading zero.
function phoneSearchVariants(raw) {
  const original = String(raw || "").trim();
  const digits   = original.replace(/[^0-9]/g, "");
  const local    = normalizePhone(original);
  const core     = local.startsWith("0") ? local.slice(1) : local;
  const s = new Set([original, digits, "+" + digits, local, "+" + local, core, "+" + core]);
  return [...s].filter(v => v.replace(/[^0-9]/g, "").length >= 7);
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

// P0 patch: converts Arabic-Indic and Extended Arabic-Indic digits to Western
// ASCII digits only (no padding, no prefix construction). Deliberately narrower
// than trial's normalizeReaderIdentityInput to avoid corrupting short (4-6 digit)
// access codes that would otherwise get zero-padded into a false serial-code shape.
function arabicDigitsToWestern(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

// Rollover: converts a dynamic Hijri "YYYY-MM" key to an Arabic month label.
// The year is read directly from the key — no hard-coded year or range limit,
// any 4-digit Hijri year works (e.g. 1448-02, 1449-01, 1455-12, ...).
function hijriYearMonthLabelFromKey(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = match[1];
  const month = Number(match[2]);
  const names = {
    1: "محرم", 2: "صفر", 3: "ربيع الأول", 4: "ربيع الآخر",
    5: "جمادى الأولى", 6: "جمادى الآخرة", 7: "رجب", 8: "شعبان",
    9: "رمضان", 10: "شوال", 11: "ذو القعدة", 12: "ذو الحجة"
  };
  return names[month] ? `${names[month]} ${year} هـ` : null;
}

function normalizePositiveInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function normalizeUnitNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  await ensureSupervisorSchema(DB);
  const isManagedCreator = row.role === "owner" || await hasManagedPermission(DB, row);
  const isSupervisor = await hasSupervisorPermission(DB, row);
  return { ...publicUser(row), managedKhatmaCreator: isManagedCreator, isSupervisor };
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
  await ensureSupervisorSchema(DB);
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const roleFilter = (url.searchParams.get("role") || "").trim();
  const likeQ = q ? `%${q}%` : null;

  let conditions = ["users.status != 'deleted'"];
  const bindParams = [];
  if (likeQ) {
    conditions.push("(users.username LIKE ? OR users.display_name LIKE ?)");
    bindParams.push(likeQ, likeQ);
  }
  if (roleFilter === "owner") { conditions.push("users.role = 'owner'"); }
  else if (roleFilter === "creator") { conditions.push("users.role = 'creator' AND (mcp.status IS NULL OR mcp.status != 'active') AND (sp.status IS NULL OR sp.status != 'active')"); }
  else if (roleFilter === "managed") { conditions.push("mcp.status = 'active'"); }
  else if (roleFilter === "supervisor") { conditions.push("sp.status = 'active'"); }

  const whereClause = "WHERE " + conditions.join(" AND ");

  const countBase = `SELECT COUNT(*) AS total FROM users LEFT JOIN managed_khatma_permissions mcp ON mcp.user_id = users.id LEFT JOIN supervisor_permissions sp ON sp.user_id = users.id ${whereClause}`;
  const countRow = await DB.prepare(countBase).bind(...bindParams).first();
  const total = countRow?.total || 0;
  const rows = await DB.prepare(`
    SELECT
      users.id, users.username, users.display_name, users.role, users.status,
      users.created_at, users.updated_at,
      CASE WHEN mcp.status = 'active' THEN 1 ELSE 0 END AS managedKhatmaCreator,
      CASE WHEN sp.status = 'active' THEN 1 ELSE 0 END AS isSupervisor
    FROM users
    LEFT JOIN managed_khatma_permissions mcp ON mcp.user_id = users.id
    LEFT JOIN supervisor_permissions sp ON sp.user_id = users.id
    ${whereClause}
    ORDER BY users.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindParams, limit, offset).all();
  return json({ ok: true, users: rows.results || [], total, page, limit, pages: Math.ceil(total / limit) || 1 });
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

async function editUser(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const username = body.username !== undefined ? String(body.username || "").trim() : undefined;
  const displayName = body.display_name !== undefined ? String(body.display_name || "").trim() : undefined;
  if (username === undefined && displayName === undefined) return json({ ok: false, error: "لا توجد بيانات للتحديث" }, 400);
  const target = await DB.prepare("SELECT id, role, username FROM users WHERE id = ? AND status != 'deleted' LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  if (username !== undefined) {
    if (!username) return json({ ok: false, error: "اسم المستخدم لا يمكن أن يكون فارغًا" }, 400);
    const conflict = await DB.prepare("SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1").bind(username, id).first();
    if (conflict) return json({ ok: false, error: "اسم المستخدم مستخدم مسبقًا" }, 409);
  }
  const updates = [];
  const params = [];
  if (username !== undefined) { updates.push("username = ?"); params.push(username); }
  if (displayName !== undefined) { updates.push("display_name = ?"); params.push(displayName); }
  updates.push("updated_at = ?"); params.push(now());
  params.push(id);
  await DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const updated = await DB.prepare("SELECT id, username, display_name, role, status, created_at, updated_at FROM users WHERE id = ?").bind(id).first();
  return json({ ok: true, user: publicUser(updated) });
}

async function changePassword(request, DB) {
  const user = await currentUser(request, DB);
  if (!user) return json({ ok: false, error: "تسجيل الدخول مطلوب" }, 401);
  const body = await readJson(request);
  const currentPw = String(body.currentPassword || "");
  const newPw = String(body.newPassword || "").trim();
  const confirmPw = String(body.confirmPassword || "").trim();
  if (!currentPw || !newPw || !confirmPw) return json({ ok: false, error: "جميع الحقول مطلوبة" }, 400);
  if (newPw !== confirmPw) return json({ ok: false, error: "كلمة المرور الجديدة وتأكيدها غير متطابقتين" }, 400);
  if (newPw.length < 4) return json({ ok: false, error: "كلمة المرور الجديدة قصيرة جدًا" }, 400);
  if (!await verifyPassword(user.password_hash, currentPw, user.username)) return json({ ok: false, error: "كلمة المرور الحالية غير صحيحة" }, 400);
  await DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(newPw, user.username), now(), user.id).run();
  return json({ ok: true });
}

async function deleteUser(request, DB, id) {
  const check = await requireOwner(request, DB);
  if (!check.ok) return check.response;
  const target = await DB.prepare("SELECT id, role, username FROM users WHERE id = ? LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  if (target.role === "owner") return json({ ok: false, error: "لا يمكن حذف حساب المالك" }, 400);
  await ensureCreatorGroupSchema(DB);
  await ensureSupervisorSchema(DB);
  await DB.batch([
    DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id),
    DB.prepare("DELETE FROM managed_creator_group_members WHERE user_id = ?").bind(id),
    DB.prepare("DELETE FROM supervisor_permissions WHERE user_id = ?").bind(id),
    DB.prepare("DELETE FROM supervisor_assignments WHERE supervisor_id = ?").bind(id),
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

async function setSupervisorPermission(request, DB, id) {
  await ensureSupervisorSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const enabled = body.enabled === true || body.status === "active";
  const target = await DB.prepare("SELECT id, role FROM users WHERE id = ? AND status != 'deleted' LIMIT 1").bind(id).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  if (target.role === "owner") return json({ ok: true, enabled: true, implicit: true });
  if (id === check.user.id) return json({ ok: false, error: "لا يمكنك تعيين نفسك مشرفاً" }, 400);
  if (!enabled && check.user.role !== "owner") {
    return json({ ok: false, error: "إلغاء صلاحية المشرف متاح للمالك فقط" }, 403);
  }
  const t = now();
  const existing = await DB.prepare("SELECT user_id FROM supervisor_permissions WHERE user_id = ? LIMIT 1").bind(id).first();
  if (existing) {
    await DB.prepare("UPDATE supervisor_permissions SET status = ?, updated_at = ? WHERE user_id = ?").bind(enabled ? "active" : "revoked", t, id).run();
  } else {
    await DB.prepare("INSERT INTO supervisor_permissions (user_id, granted_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, check.user.id, "active", t, t).run();
  }
  return json({ ok: true, enabled });
}

async function searchUsersForSupervisor(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ ok: true, users: [] });
  const rows = (await DB.prepare(
    "SELECT id, username, display_name FROM users WHERE status != 'deleted' AND role = 'creator' AND (username LIKE ? OR display_name LIKE ?) LIMIT 10"
  ).bind(`%${q}%`, `%${q}%`).all()).results || [];
  return json({ ok: true, users: rows });
}

async function listSupervisors(request, DB) {
  await ensureSupervisorSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  let assignerGroupIds = [];
  if (check.user.role !== "owner") {
    assignerGroupIds = await getUserGroupIds(DB, check.user.id);
  }
  let rows;
  if (check.user.role === "owner") {
    rows = (await DB.prepare(`
      SELECT sp.user_id, u.display_name, u.username, sp.status, sp.created_at
      FROM supervisor_permissions sp
      JOIN users u ON u.id = sp.user_id AND u.status != 'deleted'
      WHERE sp.status = 'active'
      ORDER BY sp.created_at DESC
    `).all()).results || [];
  } else {
    if (!assignerGroupIds.length) return json({ ok: true, supervisors: [] });
    rows = (await DB.prepare(`
      SELECT DISTINCT sp.user_id, u.display_name, u.username, sp.status, sp.created_at
      FROM supervisor_permissions sp
      JOIN users u ON u.id = sp.user_id AND u.status != 'deleted'
      JOIN supervisor_assignments sa ON sa.supervisor_id = sp.user_id
      WHERE sp.status = 'active'
        AND sa.entity_type = 'creator_group'
        AND sa.entity_id IN (${assignerGroupIds.map(() => "?").join(",")})
      ORDER BY sp.created_at DESC
    `).bind(...assignerGroupIds).all()).results || [];
  }
  const result = [];
  for (const r of rows) {
    const assignments = (await DB.prepare(
      "SELECT sa.entity_id, mcg.name FROM supervisor_assignments sa LEFT JOIN managed_creator_groups mcg ON mcg.id = sa.entity_id WHERE sa.supervisor_id = ? AND sa.entity_type = 'creator_group'"
    ).bind(r.user_id).all()).results || [];
    result.push({ ...r, assignments });
  }
  return json({ ok: true, supervisors: result });
}

async function getSupervisorAssignments(request, DB, supervisorId) {
  await ensureSupervisorSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const rows = (await DB.prepare(`
    SELECT sa.entity_id, mcg.name
    FROM supervisor_assignments sa
    LEFT JOIN managed_creator_groups mcg ON mcg.id = sa.entity_id
    WHERE sa.supervisor_id = ? AND sa.entity_type = 'creator_group'
  `).bind(supervisorId).all()).results || [];
  return json({ ok: true, assignments: rows });
}

async function saveSupervisorAssignments(request, DB, supervisorId) {
  await ensureSupervisorSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const body = await readJson(request);
  const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String).filter(Boolean) : [];
  const target = await DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'deleted' LIMIT 1").bind(supervisorId).first();
  if (!target) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
  const permRow = await DB.prepare("SELECT status FROM supervisor_permissions WHERE user_id = ? LIMIT 1").bind(supervisorId).first();
  if (!permRow || permRow.status !== "active") return json({ ok: false, error: "المستخدم ليس مشرفاً نشطاً" }, 400);

  let allowedGroupIds;
  if (check.user.role === "owner") {
    allowedGroupIds = null;
  } else {
    allowedGroupIds = await getUserGroupIds(DB, check.user.id);
    for (const gid of groupIds) {
      if (!allowedGroupIds.includes(gid)) {
        return json({ ok: false, error: "لا تملك صلاحية ربط مشرف بهذه المجموعة" }, 403);
      }
    }
  }

  const t = now();
  const stmts = [];
  if (allowedGroupIds === null) {
    stmts.push(DB.prepare("DELETE FROM supervisor_assignments WHERE supervisor_id = ? AND entity_type = 'creator_group'").bind(supervisorId));
  } else {
    if (allowedGroupIds.length) {
      stmts.push(DB.prepare(
        `DELETE FROM supervisor_assignments WHERE supervisor_id = ? AND entity_type = 'creator_group' AND entity_id IN (${allowedGroupIds.map(() => "?").join(",")})`
      ).bind(supervisorId, ...allowedGroupIds));
    }
  }
  for (const gid of groupIds) {
    stmts.push(DB.prepare(
      "INSERT OR IGNORE INTO supervisor_assignments (id, supervisor_id, entity_type, entity_id, assigned_by, created_at) VALUES (?, ?, 'creator_group', ?, ?, ?)"
    ).bind(newId("supas"), supervisorId, gid, check.user.id, t));
  }
  if (stmts.length) await DB.batch(stmts);
  return json({ ok: true, groupIds });
}

async function pickerCreatorGroups(request, DB) {
  await ensureCreatorGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const cursorRaw = url.searchParams.get("cursor") || "";
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
  let cursorDate = null, cursorId = null;
  if (cursorRaw) {
    try {
      const decoded = JSON.parse(atob(cursorRaw));
      cursorDate = decoded.created_at || null;
      cursorId = decoded.id || null;
    } catch {}
  }

  let rows;
  if (check.user.role === "owner") {
    let whereParts = ["status != 'deleted'"];
    const params = [];
    if (q) { whereParts.push("name LIKE ?"); params.push(`%${q}%`); }
    if (cursorDate && cursorId) {
      whereParts.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(cursorDate, cursorDate, cursorId);
    }
    const where = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";
    rows = (await DB.prepare(`SELECT id, name, created_at FROM managed_creator_groups ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...params, limit + 1).all()).results || [];
  } else {
    const myGroupIds = await getUserGroupIds(DB, check.user.id);
    if (!myGroupIds.length) return json({ ok: true, items: [], hasMore: false, nextCursor: null });
    let whereParts = [`id IN (${myGroupIds.map(() => "?").join(",")})`, "status != 'deleted'"];
    const params = [...myGroupIds];
    if (q) { whereParts.push("name LIKE ?"); params.push(`%${q}%`); }
    const where = "WHERE " + whereParts.join(" AND ");
    rows = (await DB.prepare(`SELECT id, name, created_at FROM managed_creator_groups ${where} ORDER BY created_at DESC, id DESC`).bind(...params).all()).results || [];
    return json({ ok: true, items: rows.map(r => ({ id: r.id, name: r.name })), hasMore: false, nextCursor: null });
  }
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && items.length) {
    const last = items[items.length - 1];
    nextCursor = btoa(JSON.stringify({ id: last.id, created_at: last.created_at }));
  }
  return json({ ok: true, items: items.map(r => ({ id: r.id, name: r.name })), hasMore, nextCursor });
}

async function supervisorStats(request, DB) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);
  await ensureCreatorGroupSchema(DB);
  if (check.user.role === "owner") {
    const [k, r, g] = await Promise.all([
      DB.prepare("SELECT COUNT(*) AS c FROM managed_khatmas WHERE deleted_at IS NULL").first(),
      DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_profiles WHERE status != 'deleted'").first(),
      DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_groups WHERE status = 'active'").first()
    ]);
    return json({ ok: true, khatmasCount: k?.c || 0, readersCount: r?.c || 0, readerGroupsCount: g?.c || 0 });
  }
  const groupIds = await getSupervisorCreatorGroupIds(DB, check.user.id);
  if (!groupIds.length) return json({ ok: true, khatmasCount: 0, readersCount: 0, readerGroupsCount: 0 });
  const memberIds = await getSupervisorMemberIds(DB, check.user.id);
  if (!memberIds.length) return json({ ok: true, khatmasCount: 0, readersCount: 0, readerGroupsCount: 0 });
  const idIn = memberIds.map(() => "?").join(",");
  const gIn = groupIds.map(() => "?").join(",");
  const [k, r, g] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS c FROM managed_khatmas WHERE deleted_at IS NULL AND (created_by_user_id IN (${idIn}) OR shared_creator_group_id IN (${gIn}))`).bind(...memberIds, ...groupIds).first(),
    DB.prepare(`SELECT COUNT(*) AS c FROM managed_reader_profiles WHERE status != 'deleted' AND (created_by_user_id IN (${idIn}) OR shared_creator_group_id IN (${gIn}))`).bind(...memberIds, ...groupIds).first(),
    DB.prepare(`SELECT COUNT(*) AS c FROM managed_reader_groups WHERE status = 'active' AND (created_by_user_id IN (${idIn}) OR shared_creator_group_id IN (${gIn}))`).bind(...memberIds, ...groupIds).first()
  ]);
  return json({ ok: true, khatmasCount: k?.c || 0, readersCount: r?.c || 0, readerGroupsCount: g?.c || 0 });
}

async function supervisorListKhatmas(request, DB) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const statusFilter = url.searchParams.get("status") || "";

  let baseWhere = "WHERE mk.deleted_at IS NULL";
  if (statusFilter === "archived") baseWhere += " AND mk.archived_at IS NOT NULL";
  else if (statusFilter === "active") baseWhere += " AND mk.archived_at IS NULL AND mk.status = 'active'";
  else if (statusFilter === "closed") baseWhere += " AND mk.archived_at IS NULL AND mk.status = 'closed'";
  else baseWhere += " AND mk.archived_at IS NULL";

  let params = [];
  if (check.user.role !== "owner") {
    const groupIds = await getSupervisorCreatorGroupIds(DB, check.user.id);
    if (!groupIds.length) return json({ ok: true, khatmas: [], total: 0, page, limit, pages: 1 });
    const memberIds = await getSupervisorMemberIds(DB, check.user.id);
    if (!memberIds.length) return json({ ok: true, khatmas: [], total: 0, page, limit, pages: 1 });
    const idIn = memberIds.map(() => "?").join(",");
    const gIn = groupIds.map(() => "?").join(",");
    baseWhere += ` AND (mk.created_by_user_id IN (${idIn}) OR (mk.shared_creator_group_id IS NOT NULL AND mk.shared_creator_group_id IN (${gIn})))`;
    params = [...memberIds, ...groupIds];
  }
  if (q) { baseWhere += " AND (mk.title LIKE ? OR mk.week_number LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_khatmas mk ${baseWhere}`).bind(...params).first();
  const total = countRow?.total || 0;
  const rows = (await DB.prepare(
    `SELECT mk.id, mk.title, mk.week_number, mk.khatma_type, mk.division, mk.status, mk.created_at, mk.archived_at, mk.created_by_user_id, mk.khatma_serial_number
     FROM managed_khatmas mk ${baseWhere} ORDER BY mk.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  if (!rows.length) return json({ ok: true, khatmas: [], total, page, limit, pages: Math.ceil(total / limit) || 1 });

  const ids = rows.map(r => r.id);
  const unitRows = (await DB.prepare(
    `SELECT khatma_id, COUNT(*) AS total_units,
     SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_units,
     SUM(CASE WHEN status IN ('assigned','reading') THEN 1 ELSE 0 END) AS active_units,
     SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) AS available_units
     FROM managed_khatma_units WHERE khatma_id IN (${ids.map(() => "?").join(",")}) GROUP BY khatma_id`
  ).bind(...ids).all()).results || [];
  const unitMap = new Map(unitRows.map(u => [u.khatma_id, u]));

  return json({
    ok: true, total, page, limit, pages: Math.ceil(total / limit) || 1,
    khatmas: rows.map(row => {
      const u = unitMap.get(row.id) || { total_units: 0, completed_units: 0, active_units: 0, available_units: 0 };
      return { id: row.id, title: row.title, weekNumber: row.week_number || "", khatmaType: row.khatma_type, division: row.division, status: row.status, createdAt: row.created_at, archivedAt: row.archived_at || null, serialNumber: row.khatma_serial_number || "", totalUnits: u.total_units, completedUnits: u.completed_units, activeUnits: u.active_units, availableUnits: u.available_units };
    })
  });
}

async function supervisorGetKhatma(request, DB, khatmaId) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  if (check.user.role !== "owner" && !await supervisorCanAccessKhatma(DB, check.user.id, khatmaId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذه الختمة" }, 403);
  }
  const khatma = await getManagedKhatma(DB, khatmaId, true);
  if (!khatma) return json({ ok: false, error: "الختمة غير موجودة" }, 404);
  return json({ ok: true, khatma });
}

async function supervisorListReaders(request, DB) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();

  let whereClause = "WHERE mrp.status != 'deleted'";
  let params = [];
  if (check.user.role !== "owner") {
    const groupIds = await getSupervisorCreatorGroupIds(DB, check.user.id);
    if (!groupIds.length) return json({ ok: true, readers: [], total: 0, page, limit, pages: 1 });
    const memberIds = await getSupervisorMemberIds(DB, check.user.id);
    if (!memberIds.length) return json({ ok: true, readers: [], total: 0, page, limit, pages: 1 });
    const idIn = memberIds.map(() => "?").join(",");
    const gIn = groupIds.map(() => "?").join(",");
    whereClause += ` AND (mrp.created_by_user_id IN (${idIn}) OR (mrp.shared_creator_group_id IS NOT NULL AND mrp.shared_creator_group_id IN (${gIn})))`;
    params = [...memberIds, ...groupIds];
  }
  if (q) { whereClause += " AND (mrp.reader_name LIKE ? OR mrp.access_code LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_reader_profiles mrp ${whereClause}`).bind(...params).first();
  const total = countRow?.total || 0;
  const rows = (await DB.prepare(
    `SELECT mrp.id, mrp.reader_name, mrp.access_code, mrp.phone, mrp.notes, mrp.group_id, mrp.serial_code, mrg.name AS group_name
     FROM managed_reader_profiles mrp
     LEFT JOIN managed_reader_groups mrg ON mrg.id = mrp.group_id
     ${whereClause} ORDER BY mrp.reader_name ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  return json({ ok: true, readers: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}

async function supervisorListReaderGroups(request, DB) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  await ensureGroupSchema(DB);
  await ensureCreatorGroupSchema(DB);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();

  let whereClause = "WHERE mrg.status = 'active'";
  let params = [];
  if (check.user.role !== "owner") {
    const groupIds = await getSupervisorCreatorGroupIds(DB, check.user.id);
    if (!groupIds.length) return json({ ok: true, groups: [], total: 0, page, limit, pages: 1 });
    const memberIds = await getSupervisorMemberIds(DB, check.user.id);
    if (!memberIds.length) return json({ ok: true, groups: [], total: 0, page, limit, pages: 1 });
    const idIn = memberIds.map(() => "?").join(",");
    const gIn = groupIds.map(() => "?").join(",");
    whereClause += ` AND (mrg.created_by_user_id IN (${idIn}) OR (mrg.shared_creator_group_id IS NOT NULL AND mrg.shared_creator_group_id IN (${gIn})))`;
    params = [...memberIds, ...groupIds];
  }
  if (q) { whereClause += " AND mrg.name LIKE ?"; params.push(`%${q}%`); }

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_reader_groups mrg ${whereClause}`).bind(...params).first();
  const total = countRow?.total || 0;
  const rows = (await DB.prepare(
    `SELECT mrg.id, mrg.name, mrg.notes, mrg.group_serial_number, mrg.rotation_type, mrg.created_at,
     (SELECT COUNT(*) FROM managed_reader_profiles mrp2 WHERE mrp2.group_id = mrg.id AND mrp2.status != 'deleted') AS reader_count
     FROM managed_reader_groups mrg ${whereClause} ORDER BY mrg.name ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];
  return json({ ok: true, groups: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}

async function supervisorChangeUnitStatus(request, DB, khatmaId, unitNum) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  if (check.user.role !== "owner" && !await supervisorCanAccessKhatma(DB, check.user.id, khatmaId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذه الختمة" }, 403);
  }
  const body = await readJson(request);
  const newStatus = String(body.status || "").trim();
  if (!["available", "reading", "complete"].includes(newStatus)) {
    return json({ ok: false, error: "حالة غير صحيحة — المسموح: available, reading, complete" }, 400);
  }
  const unit = await DB.prepare(
    "SELECT id, status, participant_id FROM managed_khatma_units WHERE khatma_id = ? AND unit_number = ? LIMIT 1"
  ).bind(khatmaId, Number(unitNum)).first();
  if (!unit) return json({ ok: false, error: "الوحدة غير موجودة" }, 404);
  const t = now();
  let stmt;
  if (newStatus === "available") {
    stmt = DB.prepare("UPDATE managed_khatma_units SET status = 'available', participant_id = NULL, reading_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?").bind(t, unit.id);
  } else if (newStatus === "reading") {
    stmt = DB.prepare("UPDATE managed_khatma_units SET status = 'reading', reading_at = ?, completed_at = NULL, updated_at = ? WHERE id = ?").bind(t, t, unit.id);
  } else {
    stmt = DB.prepare("UPDATE managed_khatma_units SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").bind(t, t, unit.id);
  }
  await stmt.run();
  return json({ ok: true, unitNumber: Number(unitNum), status: newStatus });
}

async function supervisorReassignUnit(request, DB, khatmaId, unitNum) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  if (check.user.role !== "owner" && !await supervisorCanAccessKhatma(DB, check.user.id, khatmaId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذه الختمة" }, 403);
  }
  const body = await readJson(request);
  const participantId = String(body.participantId || "").trim();
  if (!participantId) return json({ ok: false, error: "معرف المشارك مطلوب" }, 400);
  const participant = await DB.prepare(
    "SELECT id, participant_name FROM managed_khatma_participants WHERE id = ? AND khatma_id = ? LIMIT 1"
  ).bind(participantId, khatmaId).first();
  if (!participant) return json({ ok: false, error: "المشارك لا ينتمي لهذه الختمة" }, 403);
  const unit = await DB.prepare(
    "SELECT id FROM managed_khatma_units WHERE khatma_id = ? AND unit_number = ? LIMIT 1"
  ).bind(khatmaId, Number(unitNum)).first();
  if (!unit) return json({ ok: false, error: "الوحدة غير موجودة" }, 404);
  await DB.prepare(
    "UPDATE managed_khatma_units SET participant_id = ?, updated_at = ? WHERE id = ?"
  ).bind(participantId, now(), unit.id).run();
  return json({ ok: true, unitNumber: Number(unitNum), participantId, participantName: participant.participant_name });
}

async function supervisorMoveReader(request, DB, readerId) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  if (check.user.role !== "owner" && !await supervisorCanAccessReader(DB, check.user.id, readerId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذا القارئ" }, 403);
  }
  const body = await readJson(request);
  const targetGroupId = String(body.targetGroupId || "").trim();
  if (!targetGroupId) return json({ ok: false, error: "معرف المجموعة الهدف مطلوب" }, 400);
  if (check.user.role !== "owner" && !await supervisorCanAccessReaderGroup(DB, check.user.id, targetGroupId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذه المجموعة" }, 403);
  }
  const groupExists = await DB.prepare("SELECT id FROM managed_reader_groups WHERE id = ? AND status = 'active' LIMIT 1").bind(targetGroupId).first();
  if (!groupExists) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  await DB.prepare("UPDATE managed_reader_profiles SET group_id = ?, updated_at = ? WHERE id = ?").bind(targetGroupId, now(), readerId).run();
  return json({ ok: true, readerId, targetGroupId });
}

async function supervisorUpdateReaderNotes(request, DB, readerId) {
  const check = await requireSupervisor(request, DB);
  if (!check.ok) return check.response;
  if (check.user.role !== "owner" && !await supervisorCanAccessReader(DB, check.user.id, readerId)) {
    return json({ ok: false, error: "لا تملك صلاحية الوصول لهذا القارئ" }, 403);
  }
  const body = await readJson(request);
  const notes = String(body.notes || "").trim().slice(0, 2000);
  await DB.prepare("UPDATE managed_reader_profiles SET notes = ?, updated_at = ? WHERE id = ? AND status != 'deleted'").bind(notes, now(), readerId).run();
  return json({ ok: true, readerId, notes });
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

let _supervisorSchemaReady = false;
async function ensureSupervisorSchema(DB) {
  if (_supervisorSchemaReady) return;
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS supervisor_permissions (
      user_id    TEXT PRIMARY KEY,
      granted_by TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS supervisor_assignments (
      id            TEXT PRIMARY KEY,
      supervisor_id TEXT NOT NULL,
      entity_type   TEXT NOT NULL DEFAULT 'creator_group',
      entity_id     TEXT NOT NULL,
      assigned_by   TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      UNIQUE(supervisor_id, entity_type, entity_id)
    )
  `).run();
  await DB.batch([
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_sup_perm_status ON supervisor_permissions(status)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_sup_assign_supervisor ON supervisor_assignments(supervisor_id, entity_type)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_sup_assign_entity ON supervisor_assignments(entity_type, entity_id)")
  ]);
  _supervisorSchemaReady = true;
}

async function hasSupervisorPermission(DB, user) {
  if (!user) return false;
  if (user.role === "owner") return true;
  const row = await DB.prepare("SELECT status FROM supervisor_permissions WHERE user_id = ? LIMIT 1").bind(user.id).first();
  return row?.status === "active";
}

async function requireSupervisor(request, DB) {
  await ensureSupervisorSchema(DB);
  const user = await currentUser(request, DB);
  if (!user) return { ok: false, response: json({ ok: false, error: "تسجيل الدخول مطلوب" }, 401) };
  if (!await hasSupervisorPermission(DB, user)) {
    return { ok: false, response: json({ ok: false, error: "هذه الصفحة مخصصة للمشرفين فقط" }, 403) };
  }
  return { ok: true, user };
}

async function getSupervisorCreatorGroupIds(DB, userId) {
  const rows = (await DB.prepare(
    "SELECT entity_id FROM supervisor_assignments WHERE supervisor_id = ? AND entity_type = 'creator_group'"
  ).bind(userId).all()).results || [];
  return rows.map(r => r.entity_id);
}

async function getSupervisorMemberIds(DB, userId) {
  const groupIds = await getSupervisorCreatorGroupIds(DB, userId);
  if (!groupIds.length) return [];
  const members = (await DB.prepare(
    `SELECT DISTINCT user_id FROM managed_creator_group_members WHERE group_id IN (${groupIds.map(() => "?").join(",")})`
  ).bind(...groupIds).all()).results || [];
  return [...new Set(members.map(r => r.user_id))];
}

async function supervisorCanAccessKhatma(DB, userId, khatmaId) {
  const groupIds = await getSupervisorCreatorGroupIds(DB, userId);
  if (!groupIds.length) return false;
  const memberIds = await getSupervisorMemberIds(DB, userId);
  const khatma = await DB.prepare(
    "SELECT created_by_user_id, shared_creator_group_id FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1"
  ).bind(khatmaId).first();
  if (!khatma) return false;
  if (memberIds.includes(khatma.created_by_user_id)) return true;
  if (khatma.shared_creator_group_id && groupIds.includes(khatma.shared_creator_group_id)) return true;
  return false;
}

async function supervisorCanAccessReader(DB, userId, readerId) {
  const groupIds = await getSupervisorCreatorGroupIds(DB, userId);
  if (!groupIds.length) return false;
  const memberIds = await getSupervisorMemberIds(DB, userId);
  const reader = await DB.prepare(
    "SELECT created_by_user_id, shared_creator_group_id FROM managed_reader_profiles WHERE id = ? AND status != 'deleted' LIMIT 1"
  ).bind(readerId).first();
  if (!reader) return false;
  if (memberIds.includes(reader.created_by_user_id)) return true;
  if (reader.shared_creator_group_id && groupIds.includes(reader.shared_creator_group_id)) return true;
  return false;
}

async function supervisorCanAccessReaderGroup(DB, userId, readerGroupId) {
  const groupIds = await getSupervisorCreatorGroupIds(DB, userId);
  if (!groupIds.length) return false;
  const memberIds = await getSupervisorMemberIds(DB, userId);
  const rg = await DB.prepare(
    "SELECT created_by_user_id, shared_creator_group_id FROM managed_reader_groups WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(readerGroupId).first();
  if (!rg) return false;
  if (memberIds.includes(rg.created_by_user_id)) return true;
  if (rg.shared_creator_group_id && groupIds.includes(rg.shared_creator_group_id)) return true;
  return false;
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
      JOIN users u ON u.id = mcgm.user_id AND u.status != 'deleted'
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
    DB.prepare("ALTER TABLE managed_reader_groups ADD COLUMN shared_creator_group_id TEXT").run(),
    DB.prepare("ALTER TABLE managed_reader_profiles ADD COLUMN serial_code TEXT").run(),
    DB.prepare("ALTER TABLE managed_reader_profiles ADD COLUMN country TEXT").run(),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_mrp_serial_code ON managed_reader_profiles(serial_code) WHERE serial_code IS NOT NULL").run()
  ]);
  _groupSchemaReady = true;
}

let _serialSchemaReady = false;
async function ensureSerialSchema(DB) {
  if (_serialSchemaReady) return;
  await Promise.allSettled([
    DB.prepare("ALTER TABLE managed_khatmas ADD COLUMN khatma_serial_number TEXT").run(),
    DB.prepare("ALTER TABLE managed_reader_groups ADD COLUMN group_serial_number TEXT").run(),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_mk_serial_number ON managed_khatmas(khatma_serial_number) WHERE khatma_serial_number IS NOT NULL").run(),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_mrg_serial_number ON managed_reader_groups(group_serial_number) WHERE group_serial_number IS NOT NULL").run(),
  ]);
  _serialSchemaReady = true;
}

async function nextGroupSerial(DB) {
  const row = await DB.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTR(group_serial_number, 3) AS INTEGER)), 0) AS maxNum FROM managed_reader_groups WHERE group_serial_number IS NOT NULL`
  ).first();
  return "G-" + String((row?.maxNum || 0) + 1).padStart(6, "0");
}

async function nextKhatmaSerial(DB) {
  const row = await DB.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTR(khatma_serial_number, 3) AS INTEGER)), 0) AS maxNum FROM managed_khatmas WHERE khatma_serial_number IS NOT NULL`
  ).first();
  return "K-" + String((row?.maxNum || 0) + 1).padStart(6, "0");
}

async function listReaderGroups(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  // Pagination is always enforced for this listing endpoint.
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;

  // Smart numeric search: when q is a pure number, also match padded id suffix
  // and rank exact matches (by id suffix or name trailing number) before partial matches.
  const isNumericQ = q !== "" && /^\d+$/.test(q);
  const pad3 = isNumericQ ? q.padStart(3, "0") : "";

  // Filter: numeric q also searches id suffix (e.g. q=1 matches id ending _001)
  const qFilter = q
    ? (isNumericQ ? " AND (g.name LIKE ? OR g.id LIKE ?)" : " AND g.name LIKE ?")
    : "";
  const qParam = q
    ? (isNumericQ ? [`%${q}%`, `%_${pad3}`] : [`%${q}%`])
    : [];

  // Order: numeric q → exact id/name match first, then by id ASC; otherwise newest first
  const orderBy = isNumericQ
    ? `ORDER BY CASE WHEN g.id LIKE ? THEN 0 ELSE 1 END ASC, CASE WHEN g.name LIKE ? THEN 0 ELSE 1 END ASC, g.id ASC`
    : `ORDER BY g.created_at DESC`;
  const orderParams = isNumericQ ? [`%_${pad3}`, `% ${q}`] : [];

  let rows, total;

  if (check.user.role === "owner") {
    const countRow = await DB.prepare(
      `SELECT COUNT(*) AS total FROM managed_reader_groups g WHERE g.status != 'deleted'${qFilter}`
    ).bind(...qParam).first();
    total = countRow?.total || 0;
    const mainSql = `
      SELECT g.*, COUNT(p.id) AS readers_count
      FROM managed_reader_groups g
      LEFT JOIN managed_reader_profiles p ON p.status != 'deleted' AND (p.group_id = g.id OR p.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = g.id AND status = 'active'))
      WHERE g.status != 'deleted'${qFilter}
      GROUP BY g.id
      ${orderBy} LIMIT ? OFFSET ?`;
    const mainParams = [...qParam, ...orderParams, limit, offset];
    rows = (await DB.prepare(mainSql).bind(...mainParams).all()).results || [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds2 = await getUserGroupIds(DB, check.user.id);
    let roleWhere, roleParams;
    if (userGroupIds2.length) {
      const sharedRgClause = `OR (g.shared_creator_group_id IS NOT NULL AND g.shared_creator_group_id IN (${userGroupIds2.map(() => "?").join(",")}))`;
      roleWhere = `WHERE g.status != 'deleted' AND (g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")}) ${sharedRgClause})${qFilter}`;
      roleParams = [...visibleIds, ...userGroupIds2, ...qParam];
    } else {
      roleWhere = `WHERE g.status != 'deleted' AND g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")})${qFilter}`;
      roleParams = [...visibleIds, ...qParam];
    }
    const countRow = await DB.prepare(
      `SELECT COUNT(*) AS total FROM managed_reader_groups g ${roleWhere}`
    ).bind(...roleParams).first();
    total = countRow?.total || 0;
    const mainSql = `
      SELECT g.*, COUNT(p.id) AS readers_count
      FROM managed_reader_groups g
      LEFT JOIN managed_reader_profiles p ON p.status != 'deleted' AND (p.group_id = g.id OR p.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = g.id AND status = 'active'))
      ${roleWhere}
      GROUP BY g.id
      ${orderBy} LIMIT ? OFFSET ?`;
    const mainParams = [...roleParams, ...orderParams, limit, offset];
    rows = (await DB.prepare(mainSql).bind(...mainParams).all()).results || [];
  }

  const result = {
    ok: true,
    groups: rows.map(r => ({ ...r, readerCount: Number(r.readers_count) || 0, rotationDurationYears: r.rotation_duration_years || 5 })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1
  };
  return json(result);
}

async function getReaderGroupsRange(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const fromRaw = parseInt(url.searchParams.get("from") || "", 10);
  const toRaw = parseInt(url.searchParams.get("to") || "", 10);
  if (!Number.isFinite(fromRaw) || !Number.isFinite(toRaw)) {
    return json({ ok: false, error: "invalid_range", message: "from/to يجب أن يكونا أرقامًا صحيحة" }, 400);
  }
  const lo = Math.min(fromRaw, toRaw);
  const hi = Math.max(fromRaw, toRaw);
  if ((hi - lo + 1) > 500) {
    return json({ ok: false, error: "range_too_large", message: "النطاق كبير جدًا (أكثر من 500 مجموعة) — يرجى تضييق النطاق" }, 400);
  }

  const serialExpr = "CAST(SUBSTR(g.group_serial_number, 3) AS INTEGER)";
  let roleWhere, roleParams;
  if (check.user.role === "owner") {
    roleWhere = "WHERE g.status != 'deleted'";
    roleParams = [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds2 = await getUserGroupIds(DB, check.user.id);
    if (userGroupIds2.length) {
      const sharedRgClause = `OR (g.shared_creator_group_id IS NOT NULL AND g.shared_creator_group_id IN (${userGroupIds2.map(() => "?").join(",")}))`;
      roleWhere = `WHERE g.status != 'deleted' AND (g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")}) ${sharedRgClause})`;
      roleParams = [...visibleIds, ...userGroupIds2];
    } else {
      roleWhere = `WHERE g.status != 'deleted' AND g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")})`;
      roleParams = [...visibleIds];
    }
  }

  const rows = (await DB.prepare(
    `SELECT g.id, g.name, g.group_serial_number, ${serialExpr} AS serial_number_int
     FROM managed_reader_groups g
     ${roleWhere}
       AND g.group_serial_number IS NOT NULL
       AND ${serialExpr} BETWEEN ? AND ?
     ORDER BY serial_number_int ASC`
  ).bind(...roleParams, lo, hi).all()).results || [];

  return json({
    ok: true,
    groups: rows.map(r => ({ id: r.id, name: r.name || "", group_serial_number: r.group_serial_number || "", serial_number_int: Number(r.serial_number_int) })),
    count: rows.length,
    from_serial: lo,
    to_serial: hi
  });
}

async function getReaderGroupById(request, DB, groupId) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;

  let row;
  if (check.user.role === "owner") {
    row = await DB.prepare(
      `SELECT g.*, COUNT(p.id) AS readers_count
       FROM managed_reader_groups g
       LEFT JOIN managed_reader_profiles p ON p.status != 'deleted' AND (p.group_id = g.id OR p.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = g.id AND status = 'active'))
       WHERE g.id = ? AND g.status != 'deleted'
       GROUP BY g.id`
    ).bind(groupId).first();
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds2 = await getUserGroupIds(DB, check.user.id);
    let whereClause, whereParams;
    if (userGroupIds2.length) {
      const sharedRgClause = `OR (g.shared_creator_group_id IS NOT NULL AND g.shared_creator_group_id IN (${userGroupIds2.map(() => "?").join(",")}))`;
      whereClause = `WHERE g.id = ? AND g.status != 'deleted' AND (g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")}) ${sharedRgClause})`;
      whereParams = [groupId, ...visibleIds, ...userGroupIds2];
    } else {
      whereClause = `WHERE g.id = ? AND g.status != 'deleted' AND g.created_by_user_id IN (${visibleIds.map(() => "?").join(",")})`;
      whereParams = [groupId, ...visibleIds];
    }
    row = await DB.prepare(
      `SELECT g.*, COUNT(p.id) AS readers_count
       FROM managed_reader_groups g
       LEFT JOIN managed_reader_profiles p ON p.status != 'deleted' AND (p.group_id = g.id OR p.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = g.id AND status = 'active'))
       ${whereClause}
       GROUP BY g.id`
    ).bind(...whereParams).first();
  }

  if (!row) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, group: { ...row, readerCount: Number(row.readers_count) || 0, rotationDurationYears: row.rotation_duration_years || 5 } });
}

async function createReaderGroup(request, DB) {
  await ensureGroupSchema(DB);
  await ensureSerialSchema(DB);
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
  const groupSerial = await nextGroupSerial(DB);
  await DB.prepare(`
    INSERT INTO managed_reader_groups (id, created_by_user_id, name, notes, rotation_type, rotation_start_date, rotation_duration_years, group_serial_number, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).bind(id, check.user.id, name, body.notes || "", rotationType, rotationStartDate || null, rotationDurationYears, groupSerial, t, t).run();
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
  return assignmentValuesFor(assignments, unitNumber)[0] || "";
}

function assignmentValuesFor(assignments, unitNumber) {
  if (!assignments || typeof assignments !== "object") return [];
  const raw = assignments[unitNumber] ?? assignments[String(unitNumber)];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(list.map(v => String(v || "").trim()).filter(Boolean))];
}

function assignmentParticipantsForUnit(assignments, unitNumber, participantLookup) {
  const seen = new Set();
  const out = [];
  for (const rawAssignment of assignmentValuesFor(assignments, unitNumber)) {
    const normalized = normalizeAccessCode(rawAssignment) || normalizePhone(rawAssignment) || rawAssignment;
    const participant = participantLookup.get(rawAssignment) || participantLookup.get(normalized);
    if (participant && !seen.has(participant.id)) {
      seen.add(participant.id);
      out.push(participant);
    }
  }
  return out;
}

// Rollover: enriches a khatma row with the current Hijri rollover period, read
// from the latest managed_batch_rollover_events row for this khatma (if any).
// Purely additive — safe to call on a khatma that has never been rolled (both
// fields come back null and mapManagedKhatma below falls back to defaults).
async function withManagedKhatmaAppliedHijriPeriod(DB, row) {
  if (!row?.id) return row;
  let periodKey = null;
  try {
    const latest = await DB.prepare(`
      SELECT target_year_month
      FROM managed_batch_rollover_events
      WHERE khatma_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(row.id).first();
    periodKey = latest?.target_year_month || null;
  } catch {
    periodKey = null;
  }
  return {
    ...row,
    current_hijri_period_key: periodKey,
    current_hijri_period_label: hijriYearMonthLabelFromKey(periodKey)
  };
}

function mapManagedKhatma(row, units = [], participants = [], includeSecrets = false, visibleParticipantId = "") {
  // visibleParticipantId may be a single string ID or an array of IDs (for sibling participants)
  const visibleIdSet = Array.isArray(visibleParticipantId)
    ? new Set(visibleParticipantId.map(String).filter(Boolean))
    : (visibleParticipantId ? new Set([String(visibleParticipantId)]) : new Set());
  const khatmaType = row.khatma_type || "monthly";
  const rotationStart = row.rotation_start_date || "";
  let expiresAt = row.expires_at || "";
  if (rotationStart && (khatmaType === 'monthly' || khatmaType === 'weekly' || khatmaType === 'yearly')) {
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
    periodNumber: Number(row.period_number) || 1,
    currentHijriPeriodKey: row.current_hijri_period_key || null,
    currentHijriPeriodLabel: row.current_hijri_period_label || null,
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
    khatmaSerialNumber: row.khatma_serial_number || "",
    participants: participants.map(p => {
      const canSeeParticipant = includeSecrets || visibleIdSet.has(String(p.id || ""));
      return {
      id: includeSecrets ? p.id : "",
      readerProfileId: includeSecrets ? (p.reader_profile_id || "") : "",
      name: canSeeParticipant ? (p.participant_name || "") : "",
      phone: includeSecrets ? (p.phone || "") : "",
      accessCode: includeSecrets ? (p.access_code || "") : "",
      notes: includeSecrets ? (p.notes || "") : "",
      startJuz: (includeSecrets || canSeeParticipant) ? (p.start_juz || p.profile_start_juz || null) : null,
      partsCount: (includeSecrets || canSeeParticipant) ? (p.parts_count || p.profile_parts_count || null) : null
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
  let row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return null;
  row = await withManagedKhatmaAppliedHijriPeriod(DB, row);
  const participants = (await DB.prepare(`
    SELECT mcp.*, mrp.start_juz AS profile_start_juz, mrp.parts_count AS profile_parts_count
    FROM managed_khatma_participants mcp
    LEFT JOIN managed_reader_profiles mrp ON mrp.id = mcp.reader_profile_id
    WHERE mcp.khatma_id = ?
    ORDER BY mcp.created_at ASC
  `).bind(id).all()).results || [];
  const units = (await DB.prepare(`
    SELECT u.*, p.participant_name, p.phone AS participant_phone
    FROM managed_khatma_units u
    LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ?
    ORDER BY u.unit_number ASC, u.id ASC
  `).bind(id).all()).results || [];
  return mapManagedKhatma(row, units, participants, includeSecrets);
}

async function findManagedParticipantByIdentity(DB, id, identityRaw) {
  // P0 patch: Arabic-digit input normalized to Western digits here so all
  // downstream matching (serial/access-code/phone/name) works transparently.
  // Bare 1-6 digit input is treated as an abbreviated serial code ONLY for the
  // serial lookup below; the original `identity` string is left untouched for
  // the access-code/phone/name branches so short access codes are never corrupted.
  const identity = arabicDigitsToWestern(String(identityRaw || "").trim());
  if (!identity) return null;
  const serialCandidate = /^R-\d{1,6}$/i.test(identity)
    ? identity.toUpperCase()
    : /^\d{1,6}$/.test(identity)
      ? "R-" + identity.padStart(6, "0")
      : "";
  if (serialCandidate) {
    const bySerial = await DB.prepare(`
      SELECT mcp.*
      FROM managed_khatma_participants mcp
      JOIN managed_reader_profiles mrp ON mrp.id = mcp.reader_profile_id
      WHERE mcp.khatma_id = ? AND mrp.serial_code = ? AND mrp.status != 'deleted'
      LIMIT 1
    `).bind(id, serialCandidate).first();
    if (bySerial) return bySerial;
  }
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
  let row = await DB.prepare("SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!row) return null;
  row = await withManagedKhatmaAppliedHijriPeriod(DB, row);

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
    ORDER BY u.unit_number ASC, u.id ASC
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
    // accessCode is optional: when empty it is auto-generated in upsertManagedReaders
    if (accessCode) {
      if (!isValidAccessCode(accessCode)) return { ok: false, error: "كود القارئ يجب أن يكون من 4 إلى 10 أرقام" };
      if (seen.has(accessCode)) return { ok: false, error: "لا يمكن تكرار كود القارئ في نفس العملية" };
      seen.add(accessCode);
    }
    const country = String(item.country || "").trim();
    readers.push({ id, name, phone, accessCode, notes, country, groupId, startJuz, partsCount });
  }
  if (!readers.length) return { ok: false, error: "أضف قارئًا واحدًا على الأقل" };
  return { ok: true, readers };
}

// ── P0: Multi-Group Reader membership (managed_reader_group_memberships) ──
// Adds a many-to-many reader<->group relationship on top of the existing
// single-value managed_reader_profiles.group_id column (kept untouched as a
// fallback). Requires migrations 027_reader_group_memberships.sql and
// 028_backfill_reader_group_memberships.sql to have been applied first.

async function getGroupReaderProfileIds(DB, groupId) {
  const memberRows = (await DB.prepare(
    "SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = ? AND status = 'active'"
  ).bind(groupId).all()).results || [];
  const ids = new Set(memberRows.map(r => r.reader_profile_id));
  // Fallback: readers whose primary group_id matches but have no membership row yet
  // (covers any reader created/edited by a code path that hasn't been migrated).
  const fallbackRows = (await DB.prepare(
    "SELECT id FROM managed_reader_profiles WHERE group_id = ? AND status != 'deleted'"
  ).bind(groupId).all()).results || [];
  for (const r of fallbackRows) ids.add(r.id);
  return [...ids];
}

async function addReaderToGroup(request, DB, groupId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const group = await DB.prepare("SELECT id, created_by_user_id FROM managed_reader_groups WHERE id = ? AND status = 'active' LIMIT 1").bind(groupId).first();
  if (!group) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(group.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية استخدام هذه المجموعة" }, 403);
  }
  const body = await readJson(request);
  const readerProfileId = String(body.readerProfileId || body.reader_profile_id || "").trim();
  if (!readerProfileId) return json({ ok: false, error: "معرّف القارئ مطلوب" }, 400);
  const reader = await DB.prepare("SELECT id, created_by_user_id FROM managed_reader_profiles WHERE id = ? AND status != 'deleted' LIMIT 1").bind(readerProfileId).first();
  if (!reader) return json({ ok: false, error: "القارئ غير موجود" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(reader.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية استخدام هذا القارئ" }, 403);
  }
  const existing = await DB.prepare("SELECT id FROM managed_reader_group_memberships WHERE reader_profile_id = ? AND group_id = ?").bind(readerProfileId, groupId).first();
  if (existing) {
    if (existing.status !== "active") {
      await DB.prepare("UPDATE managed_reader_group_memberships SET status = 'active' WHERE id = ?").bind(existing.id).run();
    }
    return json({ ok: true, alreadyMember: true, membershipId: existing.id });
  }
  const id = newId("rgm");
  await DB.prepare(`
    INSERT INTO managed_reader_group_memberships (id, reader_profile_id, group_id, status, role, created_at, created_by)
    VALUES (?, ?, ?, 'active', 'member', ?, ?)
  `).bind(id, readerProfileId, groupId, now(), check.user.id).run();
  // If the reader had no primary group yet, set this as it (keeps single-group
  // code paths — exports, legacy queries — working without extra changes).
  if (!reader.group_id) {
    await DB.prepare("UPDATE managed_reader_profiles SET group_id = ?, updated_at = ? WHERE id = ? AND group_id IS NULL").bind(groupId, now(), readerProfileId).run();
  }
  return json({ ok: true, membershipId: id }, 201);
}

async function removeReaderFromGroup(request, DB, groupId, readerProfileId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const group = await DB.prepare("SELECT id, created_by_user_id FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(groupId).first();
  if (!group) return json({ ok: false, error: "المجموعة غير موجودة" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(group.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية استخدام هذه المجموعة" }, 403);
  }
  await DB.prepare("DELETE FROM managed_reader_group_memberships WHERE reader_profile_id = ? AND group_id = ?").bind(readerProfileId, groupId).run();
  // If this group was the reader's primary group_id, clear it so the reader
  // isn't shown as belonging to a group they no longer have a membership in.
  // The profile itself is never deleted by this action.
  await DB.prepare("UPDATE managed_reader_profiles SET group_id = NULL, updated_at = ? WHERE id = ? AND group_id = ?").bind(now(), readerProfileId, groupId).run();
  return json({ ok: true, removed: true });
}

async function listReaderGroupMemberships(request, DB, readerProfileId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const reader = await DB.prepare("SELECT id, created_by_user_id FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(readerProfileId).first();
  if (!reader) return json({ ok: false, error: "القارئ غير موجود" }, 404);
  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    if (!visibleIds.includes(reader.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية عرض هذا القارئ" }, 403);
  }
  const rows = (await DB.prepare(`
    SELECT rgm.group_id, g.name AS group_name, rgm.status, rgm.created_at
    FROM managed_reader_group_memberships rgm
    JOIN managed_reader_groups g ON g.id = rgm.group_id
    WHERE rgm.reader_profile_id = ? AND rgm.status = 'active'
    ORDER BY g.name ASC
  `).bind(readerProfileId).all()).results || [];
  return json({ ok: true, groups: rows.map(r => ({ groupId: r.group_id, groupName: r.group_name, createdAt: r.created_at })) });
}


// ══════════════════════════════════════════════════════════════════════════════
// ROLLOVER — Hijri Monthly Rollover Phase 2 (Batch Monthly + Rollover Plan systems)
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ROLLOVER PLAN SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

let _rolloverPlanSchemaReady = false;
const ROLLOVER_PLAN_TABLES = [
  "managed_rollover_plans",
  "managed_rollover_plan_readers",
  "managed_rollover_plan_assignments",
  "managed_rollover_plan_events"
];
async function ensureRolloverPlanSchema(DB) {
  if (_rolloverPlanSchemaReady) return { ok: true };
  const rows = (await DB.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (${ROLLOVER_PLAN_TABLES.map(() => "?").join(",")})
  `).bind(...ROLLOVER_PLAN_TABLES).all()).results || [];
  const found = new Set(rows.map(r => r.name));
  const missingTables = ROLLOVER_PLAN_TABLES.filter(name => !found.has(name));
  if (missingTables.length) return { ok: false, error: "rollover_plan_schema_missing", missingTables };
  _rolloverPlanSchemaReady = true;
  return { ok: true };
}

async function requireRolloverPlanSchema(DB) {
  const schema = await ensureRolloverPlanSchema(DB);
  if (schema.ok) return null;
  return json({
    ok: false,
    error: "rollover_plan_schema_missing",
    missingTables: schema.missingTables || ROLLOVER_PLAN_TABLES
  }, 503);
}


function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
async function hashObject(value) { return sha256Hex(canonicalJson(value)); }

function normalizePlanPayload(body = {}) {
  const raw = body.plan && typeof body.plan === "object" ? body.plan : body;
  const currentKhatmaId = String(raw.current_khatma_id || raw.currentKhatmaId || "").trim();
  return {
    id: String(raw.id || "").trim(),
    group_id: String(raw.group_id || raw.groupId || "").trim(),
    root_khatma_id: String(raw.root_khatma_id || raw.rootKhatmaId || "").trim(),
    current_khatma_id: currentKhatmaId || null,
    khatma_type: normalizeKhatmaType(raw.khatma_type || raw.khatmaType || "monthly"),
    total_cycles: normalizePositiveInt(raw.total_cycles || raw.totalCycles, 30),
    total_parts: normalizePositiveInt(raw.total_parts || raw.totalParts, 30),
    algorithm: String(raw.algorithm || "external_milp").trim() || "external_milp",
    algorithm_version: String(raw.algorithm_version || raw.algorithmVersion || "1").trim() || "1",
    input_hash: String(raw.input_hash || raw.inputHash || "").trim(),
    readers_hash: String(raw.readers_hash || raw.readersHash || "").trim(),
    history_hash: String(raw.history_hash || raw.historyHash || "").trim(),
    readers: asArray(raw.readers || raw.plan_readers || raw.planReaders),
    assignments: asArray(raw.assignments || raw.plan_assignments || raw.planAssignments)
  };
}

function normalizePlanReaderRow(row = {}) {
  const historyParts = parseJsonArray(row.history_parts_json || row.historyPartsJson || row.history_parts || row.historyParts, []);
  const uniqueHistory = [...new Set(historyParts.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 30))].sort((a, b) => a - b);
  return {
    reader_profile_id: String(row.reader_profile_id || row.readerProfileId || "").trim(),
    reader_name_snapshot: String(row.reader_name_snapshot || row.readerNameSnapshot || row.reader_name || row.readerName || "").trim(),
    phone_snapshot: normalizePhone(row.phone_snapshot || row.phoneSnapshot || row.phone || ""),
    access_code_snapshot: normalizeAccessCode(row.access_code_snapshot || row.accessCodeSnapshot || row.access_code || row.accessCode || ""),
    group_id_snapshot: String(row.group_id_snapshot || row.groupIdSnapshot || row.group_id || row.groupId || "").trim(),
    start_juz_snapshot: normalizePositiveInt(row.start_juz_snapshot || row.startJuzSnapshot || row.start_juz || row.startJuz, null),
    parts_count_snapshot: normalizePositiveInt(row.parts_count_snapshot || row.partsCountSnapshot || row.parts_count || row.partsCount, null),
    status_snapshot: String(row.status_snapshot || row.statusSnapshot || row.status || "active").trim() || "active",
    history_parts: uniqueHistory,
    history_unique_count: uniqueHistory.length,
    reader_hash: String(row.reader_hash || row.readerHash || "").trim()
  };
}

function normalizePlanAssignmentRow(row = {}) {
  return {
    id: String(row.id || "").trim(),
    cycle_number: normalizePositiveInt(row.cycle_number || row.cycleNumber, null),
    planned_period_number: normalizePositiveInt(row.planned_period_number || row.plannedPeriodNumber, null),
    reader_profile_id: String(row.reader_profile_id || row.readerProfileId || "").trim(),
    unit_number: normalizeUnitNumber(row.unit_number || row.unitNumber),
    slot_index: normalizePositiveInt(row.slot_index || row.slotIndex, null),
    status: String(row.status || "planned").trim() || "planned"
  };
}

async function userCanManageRolloverGroup(DB, user, groupId) {
  if (!groupId) return { ok: false, error: "group_id is required", status: 400 };
  const group = await DB.prepare("SELECT * FROM managed_reader_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(groupId).first();
  if (!group) return { ok: false, error: "managed reader group not found", status: 404 };
  if (user.role === "owner" || group.created_by_user_id === user.id) return { ok: true, group };
  await ensureCreatorGroupSchema(DB);
  const visibleIds = await getCreatorGroupMemberIds(DB, user.id);
  if (visibleIds.includes(group.created_by_user_id)) return { ok: true, group };
  if (group.shared_creator_group_id) {
    const userGroupIds = await getUserGroupIds(DB, user.id);
    if (userGroupIds.includes(group.shared_creator_group_id)) return { ok: true, group };
  }
  return { ok: false, error: "no permission for this reader group", status: 403 };
}

async function loadActivePlanReaders(DB, groupId) {
  const rows = (await DB.prepare(`
    SELECT id, reader_name, phone, access_code, group_id, start_juz, parts_count, status
    FROM managed_reader_profiles
    WHERE status = 'active' AND (
      group_id = ?
      OR id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = ? AND status = 'active')
    )
    ORDER BY id ASC
  `).bind(groupId, groupId).all()).results || [];
  const active = [];
  const inactive = [];
  for (const row of rows) {
    const startJuz = normalizePositiveInt(row.start_juz, null);
    const partsCount = normalizePositiveInt(row.parts_count, null);
    const mapped = {
      reader_profile_id: row.id,
      reader_name: row.reader_name || "",
      phone: row.phone || "",
      access_code: row.access_code || "",
      group_id: row.group_id || "",
      start_juz: startJuz,
      parts_count: partsCount || 0,
      status: row.status || "active"
    };
    if (startJuz && partsCount) active.push(mapped);
    else inactive.push(mapped);
  }
  return { active, inactive };
}

async function loadPlanHistoryFromCurrentKhatma(DB, currentKhatmaId) {
  if (!currentKhatmaId) return { chain: [], byReader: new Map(), rows: [] };
  const rows = (await DB.prepare(`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT mk.parent_khatma_id, chain.depth + 1
      FROM managed_khatmas mk
      JOIN chain ON mk.id = chain.id
      WHERE mk.deleted_at IS NULL
        AND mk.parent_khatma_id IS NOT NULL AND mk.parent_khatma_id != ''
    ), chain_ordered AS (
      SELECT c.id, c.depth, mk.parent_khatma_id, mk.period_number
      FROM chain c
      JOIN managed_khatmas mk ON mk.id = c.id AND mk.deleted_at IS NULL
    )
    SELECT co.id AS khatma_id, co.depth, co.parent_khatma_id, co.period_number,
           p.reader_profile_id, u.unit_number, u.status, u.completed_at
    FROM chain_ordered co
    JOIN managed_khatma_units u ON u.khatma_id = co.id
    LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE p.reader_profile_id IS NOT NULL
      AND p.reader_profile_id != ''
      AND u.status IN ('assigned','reading','completed')
    ORDER BY co.depth DESC, co.period_number ASC, u.unit_number ASC
  `).bind(currentKhatmaId).all()).results || [];
  const chainMap = new Map();
  const byReader = new Map();
  for (const row of rows) {
    chainMap.set(row.khatma_id, {
      id: row.khatma_id,
      depth: Number(row.depth) || 0,
      parent_khatma_id: row.parent_khatma_id || null,
      period_number: Number(row.period_number) || null
    });
    const rid = String(row.reader_profile_id || "");
    if (!byReader.has(rid)) byReader.set(rid, []);
    byReader.get(rid).push(Number(row.unit_number));
  }
  for (const [rid, parts] of byReader) byReader.set(rid, [...new Set(parts)].sort((a, b) => a - b));
  return { chain: [...chainMap.values()].sort((a, b) => b.depth - a.depth), byReader, rows };
}

async function computeReaderHash(reader) {
  return hashObject({
    reader_profile_id: reader.reader_profile_id,
    status: reader.status_snapshot || reader.status || "active",
    group_id: reader.group_id_snapshot || reader.group_id || "",
    start_juz: Number(reader.start_juz_snapshot ?? reader.start_juz ?? 0),
    parts_count: Number(reader.parts_count_snapshot ?? reader.parts_count ?? 0)
  });
}

async function computePlanValidationHashes(plan, activeReaders, history) {
  const readersHash = await hashObject(activeReaders.map(r => ({
    reader_profile_id: r.reader_profile_id,
    status: r.status,
    group_id: r.group_id,
    start_juz: Number(r.start_juz),
    parts_count: Number(r.parts_count)
  })));
  const historyPayload = {
    chain: history.chain || [],
    readers: [...(history.byReader || new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reader_profile_id, parts]) => ({ reader_profile_id, parts: [...parts].sort((a, b) => a - b) }))
  };
  const historyHash = await hashObject(historyPayload);
  const inputHash = await hashObject({
    group_id: plan.group_id,
    root_khatma_id: plan.root_khatma_id,
    current_khatma_id: plan.current_khatma_id || "",
    khatma_type: plan.khatma_type,
    total_cycles: plan.total_cycles,
    total_parts: plan.total_parts,
    algorithm: plan.algorithm,
    algorithm_version: plan.algorithm_version,
    readers_hash: readersHash,
    history_hash: historyHash
  });
  return { readers_hash: readersHash, history_hash: historyHash, input_hash: inputHash };
}

function groupAssignmentsByCycle(assignments) {
  const byCycle = new Map();
  for (const a of assignments) {
    if (!byCycle.has(a.cycle_number)) byCycle.set(a.cycle_number, []);
    byCycle.get(a.cycle_number).push(a);
  }
  return byCycle;
}

async function validateRolloverPlan(DB, inputPlan, options = {}) {
  const errors = [];
  const warnings = [];
  const plan = normalizePlanPayload(inputPlan);
  if (!plan.group_id) errors.push({ code: "group_id_required", message: "group_id is required" });
  if (!plan.root_khatma_id) errors.push({ code: "root_khatma_id_required", message: "root_khatma_id is required" });
  if (!plan.total_cycles || plan.total_cycles < 1) errors.push({ code: "invalid_total_cycles", message: "total_cycles must be positive" });
  if (plan.total_parts !== 30) warnings.push({ code: "total_parts_not_30", message: "totalParts is not 30 (multi-reader model)", detail: { totalParts: plan.total_parts } });
  if (!plan.assignments.length) errors.push({ code: "assignments_required", message: "assignments are required" });
  if (errors.length) return { ok: false, valid: false, errors, warnings, plan };

  const group = await DB.prepare("SELECT * FROM managed_reader_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(plan.group_id).first();
  if (!group) errors.push({ code: "group_not_found", message: "managed reader group not found" });

  if (plan.current_khatma_id) {
    const currentKhatma = await DB.prepare("SELECT id, group_id, khatma_type, parent_khatma_id, period_number, archived_at, deleted_at FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(plan.current_khatma_id).first();
    if (!currentKhatma) errors.push({ code: "current_khatma_not_found", message: "current khatma not found" });
    else {
      if (String(currentKhatma.group_id || "") !== plan.group_id) errors.push({ code: "group_mismatch", message: "current khatma group does not match plan group" });
      if (String(currentKhatma.khatma_type || "monthly") !== plan.khatma_type) errors.push({ code: "khatma_type_mismatch", message: "current khatma type does not match plan type" });
    }
  } else {
    warnings.push({ code: "current_khatma_id_missing", message: "current_khatma_id missing; actual history hash will rely on imported reader history" });
  }

  const activeReaderData = await loadActivePlanReaders(DB, plan.group_id);
  const activeReaders = activeReaderData.active;
  const inactiveReaders = activeReaderData.inactive;
  const activeReaderIds = new Set(activeReaders.map(r => r.reader_profile_id));
  const activeReaderById = new Map(activeReaders.map(r => [r.reader_profile_id, r]));
  const totalParts = activeReaders.reduce((sum, r) => sum + Number(r.parts_count || 0), 0);
  if (totalParts !== 30) warnings.push({ code: "total_parts_not_30", message: "active reader parts total is not 30 (multi-reader model)", detail: { totalParts } });
  for (const r of inactiveReaders) warnings.push({ code: "inactive_reader_excluded", message: "reader has no start_juz/parts_count and is excluded", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name });

  const importedReaders = plan.readers.map(normalizePlanReaderRow).filter(r => r.reader_profile_id);
  const readerRows = importedReaders.length ? importedReaders : activeReaders.map(r => ({
    reader_profile_id: r.reader_profile_id,
    reader_name_snapshot: r.reader_name,
    phone_snapshot: r.phone,
    access_code_snapshot: r.access_code,
    group_id_snapshot: r.group_id,
    start_juz_snapshot: r.start_juz,
    parts_count_snapshot: r.parts_count,
    status_snapshot: r.status,
    history_parts: [],
    history_unique_count: 0,
    reader_hash: ""
  }));
  const planReaderIds = new Set(readerRows.map(r => r.reader_profile_id));
  const seenPlanReaderIds = new Set();
  for (const rid of activeReaderIds) if (!planReaderIds.has(rid)) errors.push({ code: "active_reader_missing_from_plan", message: "active reader missing from plan", reader_profile_id: rid });
  for (const r of readerRows) {
    if (seenPlanReaderIds.has(r.reader_profile_id)) errors.push({ code: "duplicate_reader_in_plan", message: "reader appears more than once in plan readers", reader_profile_id: r.reader_profile_id });
    seenPlanReaderIds.add(r.reader_profile_id);
    if (!activeReaderIds.has(r.reader_profile_id)) errors.push({ code: "inactive_reader_in_plan", message: "plan includes inactive/non-group reader", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name_snapshot });
    const active = activeReaderById.get(r.reader_profile_id);
    if (active) {
      if (Number(r.parts_count_snapshot || 0) !== Number(active.parts_count || 0)) errors.push({ code: "parts_count_mismatch", message: "reader parts_count does not match profile", reader_profile_id: r.reader_profile_id });
      if (Number(r.start_juz_snapshot || 0) !== Number(active.start_juz || 0)) errors.push({ code: "start_juz_mismatch", message: "reader start_juz does not match profile", reader_profile_id: r.reader_profile_id });
    }
  }

  const existingPlan = await DB.prepare(`
    SELECT id, status FROM managed_rollover_plans
    WHERE group_id = ? AND khatma_type = ? AND status IN ('approved','active')
      AND id != ?
    LIMIT 1
  `).bind(plan.group_id, plan.khatma_type, options.excludePlanId || "").first();
  if (existingPlan) errors.push({ code: "active_plan_exists", message: "approved/active plan already exists for this group/type", plan_id: existingPlan.id });

  const actualHistory = await loadPlanHistoryFromCurrentKhatma(DB, plan.current_khatma_id);
  const importedHistoryByReader = new Map(readerRows.map(r => [r.reader_profile_id, r.history_parts || []]));
  const historyByReader = actualHistory.byReader.size ? actualHistory.byReader : importedHistoryByReader;
  const historyForHash = actualHistory.byReader.size ? actualHistory : { chain: [], byReader: importedHistoryByReader, rows: [] };
  const hashes = await computePlanValidationHashes(plan, activeReaders, historyForHash);
  if (plan.readers_hash && plan.readers_hash !== hashes.readers_hash) errors.push({ code: "readers_hash_mismatch", message: "readers_hash does not match active profiles" });
  if (plan.history_hash && plan.history_hash !== hashes.history_hash) errors.push({ code: "history_hash_mismatch", message: "history_hash does not match current/imported history" });
  if (plan.input_hash && plan.input_hash !== hashes.input_hash) errors.push({ code: "input_hash_mismatch", message: "input_hash does not match computed input" });
  plan.readers_hash = hashes.readers_hash;
  plan.history_hash = hashes.history_hash;
  plan.input_hash = hashes.input_hash;

  const assignments = plan.assignments.map(normalizePlanAssignmentRow);
  const byCycle = groupAssignmentsByCycle(assignments);
  for (const a of assignments) {
    if (!a.cycle_number || a.cycle_number < 1 || a.cycle_number > plan.total_cycles) errors.push({ code: "invalid_cycle_number", message: "cycle_number out of range", assignment: a });
    if (!a.unit_number) errors.push({ code: "invalid_unit_number", message: "unit_number must be 1..30", assignment: a });
    if (!a.slot_index || a.slot_index < 1) errors.push({ code: "invalid_slot_index", message: "slot_index must start at 1", assignment: a });
    if (!activeReaderIds.has(a.reader_profile_id)) errors.push({ code: "inactive_reader_in_assignment", message: "assignment references inactive/non-group reader", reader_profile_id: a.reader_profile_id });
  }

  const currentCycleHistory = new Map();
  for (const r of activeReaders) {
    const parts = historyByReader.get(r.reader_profile_id) || [];
    currentCycleHistory.set(r.reader_profile_id, new Set(parts.map(Number).filter(n => n >= 1 && n <= 30)));
  }

  const previewCycles = [];
  for (let cycle = 1; cycle <= plan.total_cycles; cycle++) {
    const cycleRows = (byCycle.get(cycle) || []).slice().sort((a, b) => a.unit_number - b.unit_number || a.reader_profile_id.localeCompare(b.reader_profile_id));
    const unitSeen = new Set();
    const duplicateUnits = [];
    for (const row of cycleRows) {
      if (unitSeen.has(row.unit_number)) duplicateUnits.push(row.unit_number);
      unitSeen.add(row.unit_number);
    }
    if (cycleRows.length === 0) errors.push({ code: "cycle_no_assignments", message: "cycle has no assignments", cycle_number: cycle });
    for (let unit = 1; unit <= 30; unit++) {
      if (!unitSeen.has(unit)) warnings.push({ code: "cycle_missing_unit", message: "cycle missing unit (incomplete coverage)", cycle_number: cycle, unit_number: unit });
    }
    if (duplicateUnits.length) warnings.push({ code: "multi_reader_unit", message: "unit assigned to multiple readers (intentional overlap)", cycle_number: cycle, units: duplicateUnits });

    const byReader = new Map();
    const slotByReader = new Map();
    for (const row of cycleRows) {
      if (!byReader.has(row.reader_profile_id)) byReader.set(row.reader_profile_id, []);
      byReader.get(row.reader_profile_id).push(row.unit_number);
      if (!slotByReader.has(row.reader_profile_id)) slotByReader.set(row.reader_profile_id, new Set());
      const slots = slotByReader.get(row.reader_profile_id);
      if (slots.has(row.slot_index)) errors.push({ code: "duplicate_slot_index", message: "slot_index duplicated for reader/cycle", cycle_number: cycle, reader_profile_id: row.reader_profile_id, slot_index: row.slot_index });
      slots.add(row.slot_index);
    }
    for (const reader of activeReaders) {
      const readerParts = byReader.get(reader.reader_profile_id) || [];
      const expected = Number(reader.parts_count || 0);
      if (readerParts.length !== expected) errors.push({ code: "reader_parts_count_mismatch", message: "reader assignment count must match parts_count", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, expected, actual: readerParts.length });
      const slots = slotByReader.get(reader.reader_profile_id) || new Set();
      for (let i = 1; i <= expected; i++) {
        if (!slots.has(i)) errors.push({ code: "missing_slot_index", message: "slot_index sequence must be 1..parts_count", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, slot_index: i });
      }
      if (expected > 1) {
        const ordered = cycleRows
          .filter(r => r.reader_profile_id === reader.reader_profile_id)
          .sort((a, b) => (a.slot_index || 0) - (b.slot_index || 0));
        if (ordered.length === expected) {
          for (let i = 1; i < ordered.length; i++) {
            const prev = Number(ordered[i - 1].unit_number);
            const curr = Number(ordered[i].unit_number);
            const nextExpected = (prev % 30) + 1;
            if (curr !== nextExpected) {
              warnings.push({ code: "non_contiguous_block", message: "multi-part reader assignments are not contiguous (may be intentional manual edit)", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, slot_index: ordered[i].slot_index, expected: nextExpected, actual: curr });
              break;
            }
          }
        }
      }
      let history = currentCycleHistory.get(reader.reader_profile_id) || new Set();
      if (history.size >= 30) history = new Set();
      const repeats = readerParts.filter(p => history.has(p));
      if (repeats.length) {
        const isBlockShift = plan.algorithm === 'block_shift_v1';
        const expectedParts = Number(reader.parts_count || 0);
        if (isBlockShift && expectedParts > 1) {
          const orderedBySlot = cycleRows
            .filter(r => r.reader_profile_id === reader.reader_profile_id)
            .sort((a, b) => (a.slot_index || 0) - (b.slot_index || 0));
          const lastUnit = orderedBySlot.length ? Number(orderedBySlot[orderedBySlot.length - 1].unit_number) : null;
          const unexpectedRepeats = repeats.filter(p => p === lastUnit);
          if (unexpectedRepeats.length) {
            errors.push({ code: "early_repeat", message: "block_shift_v1 newest block unit repeats history — scheduling error", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, units: unexpectedRepeats });
          } else {
            warnings.push({ code: "early_repeat_block_overlap", message: "block_shift_v1 expected trailing-unit overlap — not an error", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, units: repeats });
          }
        } else if (isBlockShift) {
          warnings.push({ code: "early_repeat_circular", message: "block_shift_v1 single-part reader revisits unit in circular rotation", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, units: repeats });
        } else {
          warnings.push({ code: "early_repeat", message: "reader repeats a unit before completing 30 unique parts (expected for period_shift_v1 boundary overlap)", cycle_number: cycle, reader_profile_id: reader.reader_profile_id, units: repeats });
        }
      }
      for (const p of readerParts) history.add(p);
      currentCycleHistory.set(reader.reader_profile_id, history);
    }
    previewCycles.push({
      cycle_number: cycle,
      assignments_count: cycleRows.length,
      duplicate_count: duplicateUnits.length,
      available_count: Math.max(0, 30 - unitSeen.size),
      assignments: cycleRows
    });
  }

  const readerRowsWithHashes = [];
  for (const r of readerRows) {
    const active = activeReaderById.get(r.reader_profile_id);
    const row = {
      ...r,
      reader_name_snapshot: r.reader_name_snapshot || active?.reader_name || "",
      phone_snapshot: r.phone_snapshot || active?.phone || "",
      access_code_snapshot: r.access_code_snapshot || active?.access_code || "",
      group_id_snapshot: r.group_id_snapshot || active?.group_id || plan.group_id,
      start_juz_snapshot: r.start_juz_snapshot || active?.start_juz || null,
      parts_count_snapshot: r.parts_count_snapshot || active?.parts_count || 0,
      status_snapshot: r.status_snapshot || active?.status || "active",
      history_parts: (historyByReader.get(r.reader_profile_id) || r.history_parts || []).slice().sort((a, b) => a - b)
    };
    row.history_unique_count = new Set(row.history_parts).size;
    row.reader_hash = r.reader_hash || await computeReaderHash(row);
    readerRowsWithHashes.push(row);
  }

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    errors,
    warnings,
    plan,
    hashes,
    readers: readerRowsWithHashes,
    assignments,
    previewCycles,
    expectedNextCycle: 1
  };
}

async function loadRolloverPlan(DB, id) {
  const plan = await DB.prepare("SELECT * FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(id).first();
  if (!plan) return null;
  const readers = (await DB.prepare("SELECT * FROM managed_rollover_plan_readers WHERE plan_id = ? ORDER BY reader_name_snapshot ASC").bind(id).all()).results || [];
  const assignments = (await DB.prepare("SELECT * FROM managed_rollover_plan_assignments WHERE plan_id = ? ORDER BY cycle_number ASC, unit_number ASC").bind(id).all()).results || [];
  const events = (await DB.prepare(`
    SELECT id, event_type, event_payload_json, created_by_user_id, created_at
    FROM managed_rollover_plan_events
    WHERE plan_id = ?
    ORDER BY created_at ASC
  `).bind(id).all()).results || [];
  return {
    ...plan,
    readers: readers.map(r => ({ ...r, history_parts: parseJsonArray(r.history_parts_json, []) })),
    assignments,
    events: events.map(e => {
      const payload = parseJsonObject(e.event_payload_json, {});
      return {
        id: e.id || "",
        event_type: e.event_type || "",
        event_payload_json: e.event_payload_json || "{}",
        event_data: payload,
        payload,
        created_by_user_id: e.created_by_user_id || "",
        created_at: e.created_at || ""
      };
    })
  };
}

function mapPlanPreview(plan, validation) {
  return {
    plan: {
      id: plan.id || "",
      group_id: plan.group_id,
      root_khatma_id: plan.root_khatma_id,
      current_khatma_id: plan.current_khatma_id || "",
      khatma_type: plan.khatma_type,
      total_cycles: Number(plan.total_cycles) || 30,
      total_parts: Number(plan.total_parts) || 30,
      status: plan.status || "draft",
      algorithm: plan.algorithm || "",
      algorithm_version: plan.algorithm_version || "",
      hashes: {
        input_hash: validation.hashes?.input_hash || plan.input_hash || "",
        readers_hash: validation.hashes?.readers_hash || plan.readers_hash || "",
        history_hash: validation.hashes?.history_hash || plan.history_hash || ""
      },
      created_at: plan.created_at || "",
      updated_at: plan.updated_at || "",
      approved_at: plan.approved_at || "",
      invalidated_at: plan.invalidated_at || "",
      invalidation_reason: plan.invalidation_reason || ""
    },
    readers: validation.readers || [],
    cycles: validation.previewCycles || [],
    events: Array.isArray(plan.events) ? plan.events : [],
    validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    expectedNextCycle: validation.expectedNextCycle || 1
  };
}

async function cleanupFailedRolloverPlanImport(DB, planId) {
  try {
    await DB.batch([
      DB.prepare("DELETE FROM managed_rollover_plan_events WHERE plan_id = ?").bind(planId),
      DB.prepare("DELETE FROM managed_rollover_plan_assignments WHERE plan_id = ?").bind(planId),
      DB.prepare("DELETE FROM managed_rollover_plan_readers WHERE plan_id = ?").bind(planId),
      DB.prepare("DELETE FROM managed_rollover_plans WHERE id = ?").bind(planId)
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "cleanup_failed" };
  }
}

async function exportRolloverPlanTemplate(request, DB) {
  const url = new URL(request.url);
  const khatmaId = String(url.searchParams.get("khatma_id") || "").trim();
  if (!khatmaId) return json({ ok: false, error: "khatma_id مطلوب" }, 400);

  const control = await requireManagedControl(request, DB, khatmaId);
  if (!control.ok) return json({ ok: false, error: control.error }, control.status || 403);

  const khatma = await DB.prepare(
    "SELECT id, group_id, khatma_type, period_number, parent_khatma_id, division FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1"
  ).bind(khatmaId).first();
  if (!khatma) return json({ ok: false, error: "الختمة المُدارة غير موجودة" }, 404);

  const rootRow = await DB.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_khatma_id FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT mk.id, mk.parent_khatma_id
      FROM managed_khatmas mk
      JOIN ancestors ON mk.id = ancestors.parent_khatma_id
      WHERE mk.deleted_at IS NULL
        AND ancestors.parent_khatma_id IS NOT NULL AND ancestors.parent_khatma_id != ''
    )
    SELECT id FROM ancestors WHERE parent_khatma_id IS NULL OR parent_khatma_id = '' LIMIT 1
  `).bind(khatmaId).first();
  const rootKhatmaId = rootRow?.id || khatmaId;

  const groupId = khatma.group_id || "";
  const khatmaType = khatma.khatma_type || "monthly";
  const totalCycles = 30;
  const totalParts = 30;
  const algorithm = "external_milp";
  const algorithmVersion = "1";

  const readerData = await loadActivePlanReaders(DB, groupId);
  const activeReaders = readerData.active;
  const warnings = [];
  for (const r of readerData.inactive) {
    warnings.push({ code: "inactive_reader_excluded", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name });
  }

  const activeParts = activeReaders.reduce((s, r) => s + Number(r.parts_count || 0), 0);
  if (activeReaders.length && activeParts !== 30) {
    warnings.push({ code: "total_parts_not_30", detail: { total: activeParts } });
  }

  const history = await loadPlanHistoryFromCurrentKhatma(DB, khatmaId);

  const currentUnitRows = (await DB.prepare(`
    SELECT p.reader_profile_id, u.unit_number
    FROM managed_khatma_units u
    JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ?
      AND p.reader_profile_id IS NOT NULL AND p.reader_profile_id != ''
      AND u.status IN ('assigned','reading','completed')
    ORDER BY u.unit_number ASC
  `).bind(khatmaId).all()).results || [];

  const currentUnitsByReader = new Map();
  for (const row of currentUnitRows) {
    const rid = String(row.reader_profile_id);
    if (!currentUnitsByReader.has(rid)) currentUnitsByReader.set(rid, []);
    currentUnitsByReader.get(rid).push(Number(row.unit_number));
  }

  const planForHash = {
    group_id: groupId,
    root_khatma_id: rootKhatmaId,
    current_khatma_id: khatmaId,
    khatma_type: khatmaType,
    total_cycles: totalCycles,
    total_parts: totalParts,
    algorithm,
    algorithm_version: algorithmVersion
  };
  const hashes = await computePlanValidationHashes(planForHash, activeReaders, history);

  const readers = activeReaders.map(r => {
    const historyParts = [...(history.byReader.get(r.reader_profile_id) || [])].sort((a, b) => a - b);
    const historySet = new Set(historyParts);
    const currentUnits = (currentUnitsByReader.get(r.reader_profile_id) || []).sort((a, b) => a - b);
    const remainingParts = [];
    for (let i = 1; i <= 30; i++) {
      if (!historySet.has(i)) remainingParts.push(i);
    }
    return {
      reader_profile_id: r.reader_profile_id,
      reader_name: r.reader_name,
      parts_count: r.parts_count,
      start_juz: r.start_juz,
      current_units: currentUnits,
      history_parts: historyParts,
      history_unique_count: historySet.size,
      remaining_parts: remainingParts
    };
  });

  const assignmentsTemplate = [];
  for (let cycle = 1; cycle <= totalCycles; cycle++) {
    for (let unit = 1; unit <= 30; unit++) {
      assignmentsTemplate.push({ cycle_number: cycle, unit_number: unit, reader_profile_id: null, slot_index: null });
    }
  }

  return json({
    ok: true,
    exported_at: new Date().toISOString(),
    template_version: 1,
    metadata: {
      group_id: groupId,
      khatma_id: khatmaId,
      root_khatma_id: rootKhatmaId,
      khatma_type: khatmaType,
      period_number: Number(khatma.period_number) || 1,
      total_cycles: totalCycles,
      total_parts: totalParts,
      algorithm,
      algorithm_version: algorithmVersion
    },
    hashes,
    readers,
    assignments_template: assignmentsTemplate,
    warnings
  });
}

async function listManagedRolloverPlans(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const url = new URL(request.url);
  const groupId = String(url.searchParams.get("group_id") || "").trim();
  const status = String(url.searchParams.get("status") || "").trim();
  const where = [];
  const params = [];
  if (groupId) {
    const access = await userCanManageRolloverGroup(DB, check.user, groupId);
    if (!access.ok) return json({ ok: false, error: access.error }, access.status);
    where.push("p.group_id = ?");
    params.push(groupId);
  } else if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    visibleIds.push(check.user.id);
    const placeholders = visibleIds.map(() => "?").join(",");
    where.push(`g.created_by_user_id IN (${placeholders})`);
    params.push(...visibleIds);
  }
  if (status) {
    where.push("p.status = ?");
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = (await DB.prepare(`
    SELECT p.*, g.name AS group_name,
           (SELECT COUNT(*) FROM managed_rollover_plan_readers r WHERE r.plan_id = p.id) AS readers_count,
           (SELECT COUNT(*) FROM managed_rollover_plan_assignments a WHERE a.plan_id = p.id) AS assignments_count
    FROM managed_rollover_plans p
    LEFT JOIN managed_reader_groups g ON g.id = p.group_id
    ${clause}
    ORDER BY p.created_at DESC
  `).bind(...params).all()).results || [];
  return json({ ok: true, plans: rows });
}

async function importManagedRolloverPlan(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const body = await readJson(request);
  const normalized = normalizePlanPayload(body);
  const access = await userCanManageRolloverGroup(DB, check.user, normalized.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const validation = await validateRolloverPlan(DB, normalized);
  if (!validation.valid) return json({ ok: false, error: "plan_invalid", validation }, 400);

  const t = now();
  const planId = newId("rplan");
  const p = validation.plan;
  const stmts = [
    DB.prepare(`INSERT INTO managed_rollover_plans (
      id, group_id, root_khatma_id, current_khatma_id, khatma_type, total_cycles, total_parts,
      status, algorithm, algorithm_version, input_hash, readers_hash, history_hash,
      created_by_user_id, generated_by_user_id, generated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      planId, p.group_id, p.root_khatma_id, p.current_khatma_id || null, p.khatma_type,
      p.total_cycles, p.total_parts, p.algorithm, p.algorithm_version,
      p.input_hash, p.readers_hash, p.history_hash,
      check.user.id, check.user.id, t, t, t
    )
  ];
  const rStmt = DB.prepare(`INSERT INTO managed_rollover_plan_readers (
    id, plan_id, reader_profile_id, reader_name_snapshot, phone_snapshot, access_code_snapshot,
    group_id_snapshot, start_juz_snapshot, parts_count_snapshot, status_snapshot,
    history_parts_json, history_unique_count, reader_hash, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of validation.readers) {
    stmts.push(rStmt.bind(newId("rpr"), planId, r.reader_profile_id, r.reader_name_snapshot,
      r.phone_snapshot || null, r.access_code_snapshot || null, r.group_id_snapshot,
      r.start_juz_snapshot || null, r.parts_count_snapshot, r.status_snapshot || "active",
      JSON.stringify(r.history_parts || []), r.history_unique_count || 0, r.reader_hash, t, t));
  }
  const aStmt = DB.prepare(`INSERT INTO managed_rollover_plan_assignments (
    id, plan_id, cycle_number, planned_period_number, reader_profile_id, unit_number,
    slot_index, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`);
  for (const a of validation.assignments) {
    stmts.push(aStmt.bind(newId("rpa"), planId, a.cycle_number, a.planned_period_number || null,
      a.reader_profile_id, a.unit_number, a.slot_index, t, t));
  }
  stmts.push(DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'imported', ?, ?, ?)")
    .bind(newId("rpe"), planId, JSON.stringify({ validation: { warnings: validation.warnings.length } }), check.user.id, t));
  try {
    await DB.batch(stmts);
  } catch (err) {
    const cleanup = await cleanupFailedRolloverPlanImport(DB, planId);
    return json({ ok: false, error: "plan_import_failed", message: "Failed to store rollover plan; cleanup was attempted for the new plan_id", planId, cleanup }, 500);
  }
  const stored = await loadRolloverPlan(DB, planId);
  return json({ ok: true, plan: mapPlanPreview(stored, validation) }, 201);
}

async function validateManagedRolloverPlanOnly(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: "invalid_json", message: "Request body could not be parsed as JSON" }, 400);
  }
  const normalized = normalizePlanPayload(body);
  const access = await userCanManageRolloverGroup(DB, check.user, normalized.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const validation = await validateRolloverPlan(DB, normalized);
  return json({
    ok: true,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    summary: {
      group_id: normalized.group_id,
      khatma_type: normalized.khatma_type,
      current_khatma_id: normalized.current_khatma_id || null,
      total_cycles: normalized.total_cycles,
      total_parts: normalized.total_parts,
      readers_count: (normalized.readers || []).length,
      assignments_count: (normalized.assignments || []).length,
      algorithm: normalized.algorithm
    }
  });
}

function blockShiftReadingOrder(units) {
  const sorted = [...units].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted;
  let maxGap = -1;
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    const gap = (sorted[(i + 1) % n] - sorted[i] + 30) % 30;
    if (gap > maxGap) { maxGap = gap; startIdx = (i + 1) % n; }
  }
  const result = [];
  for (let i = 0; i < n; i++) result.push(sorted[(startIdx + i) % n]);
  return result;
}

function computeRotationJuzServer(startJuz, partsCount, periodIndex) {
  const total = 30;
  const start = Number(startJuz);
  const count = Number(partsCount || 0);
  const period = Number(periodIndex || 0);
  if (!Number.isInteger(start) || start < 1 || start > 30 || !Number.isInteger(count) || count < 1) return [];
  const offset = period * count;
  return Array.from({ length: count }, (_, i) => ((start - 1 + offset + i) % total) + 1);
}

async function generatePreviewManagedRolloverPlan(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: "invalid_json", message: "Request body could not be parsed as JSON" }, 400);
  }

  const groupId = String(body.group_id || "").trim();
  const rawKhatmaType = String(body.khatma_type || "").trim();
  const currentKhatmaId = String(body.current_khatma_id || "").trim();
  const algorithm = String(body.algorithm || "block_shift_v1").trim() || "block_shift_v1";

  if (!groupId) return json({ ok: false, error: "group_id_required" }, 400);
  if (!["weekly", "monthly", "yearly"].includes(rawKhatmaType))
    return json({ ok: false, error: "khatma_type_required", message: "khatma_type must be weekly, monthly, or yearly", given: rawKhatmaType || null }, 400);
  if (!currentKhatmaId) return json({ ok: false, error: "current_khatma_id_required" }, 400);
  if (algorithm !== "block_shift_v1" && algorithm !== "period_shift_v1")
    return json({ ok: false, error: "unsupported_algorithm", supported: ["block_shift_v1", "period_shift_v1"], given: algorithm }, 400);

  const khatmaType = rawKhatmaType;
  const access = await userCanManageRolloverGroup(DB, check.user, groupId);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const group = access.group;

  const currentKhatma = await DB.prepare(
    "SELECT id, group_id, khatma_type, parent_khatma_id, period_number, khatma_serial_number, khatma_date, rotation_start_date, deleted_at FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1"
  ).bind(currentKhatmaId).first();
  if (!currentKhatma) return json({ ok: false, error: "current_khatma_not_found" }, 404);
  if (String(currentKhatma.group_id || "") !== groupId)
    return json({ ok: false, error: "group_mismatch", message: "current khatma group_id does not match input group_id" }, 400);
  if (String(currentKhatma.khatma_type || "monthly") !== khatmaType)
    return json({ ok: false, error: "khatma_type_mismatch", message: "current khatma khatma_type does not match input khatma_type" }, 400);

  const preWarnings = [];
  if (group.rotation_type && ["weekly", "monthly", "yearly"].includes(group.rotation_type) && group.rotation_type !== khatmaType) {
    preWarnings.push({ code: "rotation_type_mismatch", message: "group rotation_type does not match requested khatma_type", group_rotation_type: group.rotation_type, khatma_type: khatmaType });
  }

  const readerData = await loadActivePlanReaders(DB, groupId);
  const activeReaders = readerData.active;
  const inactiveReaders = readerData.inactive;

  for (const r of inactiveReaders) {
    preWarnings.push({ code: "inactive_reader_excluded", message: "reader has no start_juz/parts_count and is excluded from generation", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name });
  }

  if (!activeReaders.length)
    return json({ ok: false, error: "no_eligible_readers", message: "no active readers with start_juz and parts_count set" }, 400);

  const totalParts = activeReaders.reduce((sum, r) => sum + Number(r.parts_count || 0), 0);
  if (totalParts < 1)
    return json({ ok: false, error: "no_eligible_parts", message: "active readers have no parts_count set", detail: { totalParts, readers_count: activeReaders.length } }, 400);

  const currentAssignRows = (await DB.prepare(`
    SELECT p.reader_profile_id, u.unit_number
    FROM managed_khatma_units u
    JOIN managed_khatma_participants p ON p.id = u.participant_id
    WHERE u.khatma_id = ?
      AND p.reader_profile_id IS NOT NULL AND p.reader_profile_id != ''
      AND u.status IN ('assigned', 'reading', 'completed')
    ORDER BY u.unit_number ASC
  `).bind(currentKhatmaId).all()).results || [];

  const unitsByReader = new Map();
  for (const row of currentAssignRows) {
    const rid = String(row.reader_profile_id);
    if (!unitsByReader.has(rid)) unitsByReader.set(rid, []);
    unitsByReader.get(rid).push(Number(row.unit_number));
  }

  const genErrors = [];
  for (const r of activeReaders) {
    const units = unitsByReader.get(r.reader_profile_id);
    if (!units || units.length === 0) {
      genErrors.push({ code: "reader_missing_from_current_khatma", message: "active reader has no assignments in current khatma", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name });
    } else if (units.length !== Number(r.parts_count)) {
      genErrors.push({ code: "reader_unit_count_mismatch", message: "unit count in current khatma does not match reader parts_count", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name, expected: Number(r.parts_count), actual: units.length });
    }
  }

  const baseSummary = () => ({
    group_id: groupId, group_name: group.name || "", khatma_type: khatmaType,
    current_khatma_id: currentKhatmaId, current_khatma_serial: currentKhatma.khatma_serial_number || "",
    total_cycles: 1, total_parts: totalParts, readers_count: activeReaders.length, assignments_count: 0, algorithm
  });

  let nextAssignments = [];

  if (algorithm === "period_shift_v1") {
    let nextPeriodIndex;
    const _groupStart = String(group.rotation_start_date || "").trim();
    const _khatmaDate = String(currentKhatma.khatma_date || currentKhatma.rotation_start_date || "").trim();
    if (_groupStart && _khatmaDate) {
      const _startMs = Date.parse(_groupStart);
      const _khatmaMs = Date.parse(_khatmaDate);
      if (!isNaN(_startMs) && !isNaN(_khatmaMs) && _khatmaMs >= _startMs) {
        const _days = Math.floor((_khatmaMs - _startMs) / 86400000);
        const _periodDays = khatmaType === "weekly" ? 7 : khatmaType === "monthly" ? 30 : 365;
        const _currentIdx = Math.floor(_days / _periodDays);
        nextPeriodIndex = _currentIdx + 1;
        preWarnings.push({ code: "period_index_calculated", severity: "info", message: "nextPeriodIndex computed from group.rotation_start_date and khatma_date", group_rotation_start: _groupStart, khatma_date: _khatmaDate, days_elapsed: _days, current_period_index: _currentIdx, next_period_index: nextPeriodIndex });
      }
    }
    if (nextPeriodIndex === undefined) {
      nextPeriodIndex = Number(currentKhatma.period_number || 1);
      preWarnings.push({ code: "period_index_fallback", severity: "warning", message: "date-based nextPeriodIndex unavailable; falling back to period_number", period_number: currentKhatma.period_number, next_period_index: nextPeriodIndex });
    }

    for (const e of genErrors) preWarnings.push({ ...e, severity: "warning" });

    const occupied = new Set();
    const psvErrors = [];

    for (const r of activeReaders) {
      const startJuz = Number(r.start_juz);
      const partsCount = Number(r.parts_count);
      if (!Number.isInteger(startJuz) || startJuz < 1 || startJuz > 30 || !Number.isInteger(partsCount) || partsCount < 1) {
        psvErrors.push({ code: "reader_missing_juz_config", message: "reader missing valid start_juz or parts_count", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || "" });
        continue;
      }
      const units = computeRotationJuzServer(startJuz, partsCount, nextPeriodIndex);
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        if (occupied.has(unit)) {
          preWarnings.push({ code: "multi_reader_unit", severity: "info", message: "unit assigned to multiple readers — multi-reader unit is allowed", unit_number: unit, reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || "" });
        }
        occupied.add(unit);
        nextAssignments.push({ cycle_number: 1, unit_number: unit, reader_profile_id: r.reader_profile_id, slot_index: i + 1 });
      }
    }

    if (psvErrors.length)
      return json({ ok: false, valid: false, errors: psvErrors, warnings: preWarnings, summary: { ...baseSummary(), assignments_count: nextAssignments.length } }, 400);

    const allCoveredUnits = new Set(nextAssignments.map(a => a.unit_number));
    const missingUnits = Array.from({ length: 30 }, (_, i) => i + 1).filter(u => !allCoveredUnits.has(u));
    if (missingUnits.length) {
      preWarnings.push({ code: "incomplete_coverage", severity: "warning", message: "some units have no assigned reader — fill them manually before approving", missing_units: missingUnits });
    }

    for (const r of activeReaders) {
      const actualUnits = unitsByReader.get(r.reader_profile_id) || [];
      if (!actualUnits.length) continue;
      const expectedCurrentUnits = computeRotationJuzServer(Number(r.start_juz), Number(r.parts_count), nextPeriodIndex - 1);
      if (!expectedCurrentUnits.length) continue;
      const expectedCurrentSet = new Set(expectedCurrentUnits);
      const drifted = actualUnits.filter(u => !expectedCurrentSet.has(u));
      if (drifted.length) {
        preWarnings.push({ code: "current_units_drift", message: "reader actual assignments in current khatma differ from period formula — manual edit or profile config change since last rollover", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || "", expected_current: expectedCurrentUnits.slice().sort((a, b) => a - b), actual_current: actualUnits.slice().sort((a, b) => a - b) });
      }
    }
  } else {
    if (genErrors.length)
      return json({ ok: false, valid: false, errors: genErrors, warnings: preWarnings, summary: baseSummary() }, 400);

    const occupied = new Set();
    for (const r of activeReaders.filter(r => Number(r.parts_count) > 1)) {
      const ordered = blockShiftReadingOrder(unitsByReader.get(r.reader_profile_id));
      for (let i = 0; i < ordered.length; i++) {
        const nextUnit = (ordered[i] % 30) + 1;
        occupied.add(nextUnit);
        nextAssignments.push({ cycle_number: 1, unit_number: nextUnit, reader_profile_id: r.reader_profile_id, slot_index: i + 1 });
      }
    }
    for (const r of activeReaders.filter(r => Number(r.parts_count) === 1)) {
      const currentUnit = unitsByReader.get(r.reader_profile_id)[0];
      const target = (currentUnit % 30) + 1;
      let placed = false;
      for (let offset = 0; offset < 30; offset++) {
        const candidate = ((target - 1 + offset) % 30) + 1;
        if (!occupied.has(candidate)) {
          occupied.add(candidate);
          nextAssignments.push({ cycle_number: 1, unit_number: candidate, reader_profile_id: r.reader_profile_id, slot_index: 1 });
          placed = true;
          break;
        }
      }
      if (!placed)
        return json({ ok: false, valid: false, errors: [{ code: "single_part_conflict_unresolvable", message: "no available unit for single-part reader after exhausting all 30 positions", reader_profile_id: r.reader_profile_id, reader_name: r.reader_name }], warnings: preWarnings, summary: { ...baseSummary(), assignments_count: nextAssignments.length } }, 400);
    }
  }

  const rootRow = await DB.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_khatma_id FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT mk.id, mk.parent_khatma_id
      FROM managed_khatmas mk
      JOIN ancestors ON mk.id = ancestors.parent_khatma_id
      WHERE mk.deleted_at IS NULL AND ancestors.parent_khatma_id IS NOT NULL AND ancestors.parent_khatma_id != ''
    )
    SELECT id FROM ancestors WHERE parent_khatma_id IS NULL OR parent_khatma_id = '' LIMIT 1
  `).bind(currentKhatmaId).first();
  const rootKhatmaId = rootRow?.id || currentKhatmaId;

  const history = await loadPlanHistoryFromCurrentKhatma(DB, currentKhatmaId);

  const planReaders = activeReaders.map(r => ({
    reader_profile_id: r.reader_profile_id,
    reader_name_snapshot: r.reader_name || "",
    phone_snapshot: r.phone || "",
    access_code_snapshot: r.access_code || "",
    group_id_snapshot: r.group_id || groupId,
    start_juz_snapshot: r.start_juz,
    parts_count_snapshot: Number(r.parts_count),
    status_snapshot: r.status || "active",
    history_parts: (history.byReader.get(r.reader_profile_id) || []).slice().sort((a, b) => a - b)
  }));

  const generatedPlan = {
    group_id: groupId, root_khatma_id: rootKhatmaId, current_khatma_id: currentKhatmaId,
    khatma_type: khatmaType, total_cycles: 1, total_parts: totalParts, algorithm, algorithm_version: "1",
    readers: planReaders, assignments: nextAssignments
  };

  const validation = await validateRolloverPlan(DB, generatedPlan);

  const readerMeta = new Map(activeReaders.map(r => [r.reader_profile_id, { name: r.reader_name || "", parts_count: Number(r.parts_count) }]));
  const previewRows = nextAssignments.slice()
    .sort((a, b) => a.unit_number - b.unit_number)
    .map(a => ({ unit_number: a.unit_number, reader_profile_id: a.reader_profile_id, reader_name: readerMeta.get(a.reader_profile_id)?.name || "", slot_index: a.slot_index, parts_count: readerMeta.get(a.reader_profile_id)?.parts_count || 1 }));

  let draftPlanId = null;
  if (body.save_as_draft === true && nextAssignments.length > 0) {
    try {
      const t = now();
      draftPlanId = newId("rplan");
      const vp = (validation && validation.plan) || {};
      const dStmts = [
        DB.prepare(`INSERT INTO managed_rollover_plans (
          id, group_id, root_khatma_id, current_khatma_id, khatma_type, total_cycles, total_parts,
          status, algorithm, algorithm_version, input_hash, readers_hash, history_hash,
          created_by_user_id, generated_by_user_id, generated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(draftPlanId, groupId, rootKhatmaId, currentKhatmaId, khatmaType,
          1, totalParts, algorithm, "1",
          vp.input_hash || null, vp.readers_hash || null, vp.history_hash || null,
          check.user.id, check.user.id, t, t, t)
      ];
      const rStmt = DB.prepare(`INSERT INTO managed_rollover_plan_readers (
        id, plan_id, reader_profile_id, reader_name_snapshot, phone_snapshot, access_code_snapshot,
        group_id_snapshot, start_juz_snapshot, parts_count_snapshot, status_snapshot,
        history_parts_json, history_unique_count, reader_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of planReaders) {
        dStmts.push(rStmt.bind(newId("rpr"), draftPlanId, r.reader_profile_id,
          r.reader_name_snapshot, r.phone_snapshot || null, r.access_code_snapshot || null,
          r.group_id_snapshot || groupId, r.start_juz_snapshot || null,
          r.parts_count_snapshot, r.status_snapshot || "active",
          JSON.stringify(r.history_parts || []), (r.history_parts || []).length, newId("rhr"), t, t));
      }
      const aStmt = DB.prepare(`INSERT INTO managed_rollover_plan_assignments (
        id, plan_id, cycle_number, planned_period_number, reader_profile_id, unit_number,
        slot_index, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`);
      for (const a of nextAssignments) {
        dStmts.push(aStmt.bind(newId("rpa"), draftPlanId, a.cycle_number || 1, null,
          a.reader_profile_id, a.unit_number, a.slot_index, t, t));
      }
      dStmts.push(DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'draft_generated', ?, ?, ?)")
        .bind(newId("rpe"), draftPlanId, JSON.stringify({ algorithm, current_khatma_id: currentKhatmaId, save_as_draft: true, warning_count: preWarnings.length + (validation.warnings || []).length, source: "generate-preview" }), check.user.id, t));
      await DB.batch(dStmts);
    } catch (draftErr) { throw draftErr; }
  }

  return json({
    ok: true,
    valid: validation.valid,
    errors: validation.errors,
    warnings: [...preWarnings, ...validation.warnings],
    summary: { group_id: groupId, group_name: group.name || "", khatma_type: khatmaType, current_khatma_id: currentKhatmaId, current_khatma_serial: currentKhatma.khatma_serial_number || "", total_cycles: 1, total_parts: totalParts, readers_count: activeReaders.length, assignments_count: nextAssignments.length, algorithm },
    generated_plan: generatedPlan,
    preview: { rows: previewRows },
    ...(draftPlanId ? { draft_plan_id: draftPlanId } : {})
  });
}

async function previewManagedRolloverPlan(request, DB, id) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const plan = await loadRolloverPlan(DB, id);
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const validation = await validateRolloverPlan(DB, plan, { excludePlanId: id });
  return json({ ok: true, ...mapPlanPreview(plan, validation) });
}

async function approveManagedRolloverPlan(request, DB, id) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const plan = await loadRolloverPlan(DB, id);
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  if (plan.status !== "draft") return json({ ok: false, error: "plan_not_draft", status: plan.status }, 409);
  const validation = await validateRolloverPlan(DB, plan, { excludePlanId: id });
  if (!validation.valid) return json({ ok: false, error: "plan_invalid", validation }, 400);
  const t = now();
  await DB.batch([
    DB.prepare(`UPDATE managed_rollover_plans
      SET status = 'approved', approved_by_user_id = ?, approved_at = ?, input_hash = ?,
          readers_hash = ?, history_hash = ?, updated_at = ?
      WHERE id = ?`).bind(check.user.id, t, validation.hashes.input_hash, validation.hashes.readers_hash, validation.hashes.history_hash, t, id),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'approved', ?, ?, ?)")
      .bind(newId("rpe"), id, JSON.stringify({}), check.user.id, t)
  ]);
  const stored = await loadRolloverPlan(DB, id);
  return json({ ok: true, ...mapPlanPreview(stored, validation) });
}

async function batchScanRolloverKhatmas(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  await ensureSerialSchema(DB);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const khatmaType = String(body.khatma_type || '').trim() || null;
  const serialFrom = String(body.serial_from || '').trim() || null;
  const serialTo   = String(body.serial_to   || '').trim() || null;

  const conditions = [
    "mk.deleted_at IS NULL",
    "mk.archived_at IS NULL",
    "mk.khatma_serial_number IS NOT NULL",
    "mk.group_id IS NOT NULL",
    "mk.group_id != ''"
  ];
  const binds = [];
  if (khatmaType && ['weekly','monthly','yearly'].includes(khatmaType)) {
    conditions.push("mk.khatma_type = ?");
    binds.push(khatmaType);
  }
  if (serialFrom) { conditions.push("mk.khatma_serial_number >= ?"); binds.push(serialFrom); }
  if (serialTo)   { conditions.push("mk.khatma_serial_number <= ?"); binds.push(serialTo); }

  const rows = (await DB.prepare(`
    SELECT mk.id, mk.khatma_serial_number, mk.khatma_type, mk.period_number,
           mk.group_id, mk.khatma_date,
           mrg.name AS group_name, mrg.status AS group_status,
           bp.id AS blocking_plan_id, bp.status AS blocking_plan_status
    FROM managed_khatmas mk
    LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
    LEFT JOIN (
      SELECT group_id, khatma_type, MIN(id) AS id, status
      FROM managed_rollover_plans
      WHERE status IN ('approved','active')
      GROUP BY group_id, khatma_type
    ) bp ON bp.group_id = mk.group_id AND bp.khatma_type = COALESCE(mk.khatma_type,'monthly')
    WHERE ${conditions.join(' AND ')}
    ORDER BY mk.khatma_serial_number ASC
    LIMIT 200
  `).bind(...binds).all()).results || [];

  const items = rows.map(row => ({
    khatma_id: row.id,
    khatma_serial: row.khatma_serial_number,
    khatma_type: row.khatma_type || 'monthly',
    period_number: row.period_number || 1,
    group_id: row.group_id,
    group_name: row.group_name || '',
    has_blocking_plan: !!row.blocking_plan_id,
    blocking_plan_id: row.blocking_plan_id || null,
    blocking_plan_status: row.blocking_plan_status || null,
    can_generate: !row.blocking_plan_id
  }));

  return json({ ok: true, count: items.length, items });
}

async function batchSaveDrafts(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ ok: false, error: "items_required" }, 400);
  if (items.length > 50) return json({ ok: false, error: "too_many_items", max: 50 }, 400);

  const authHeader = request.headers.get('Authorization') || '';
  const results = [];

  for (const item of items) {
    const groupId   = String(item.group_id   || '').trim();
    const khatmaId  = String(item.khatma_id  || '').trim();
    const khatmaType = String(item.khatma_type || 'monthly').trim();

    if (!groupId || !khatmaId) {
      results.push({ khatma_id: khatmaId || null, status: 'error', reason: 'missing_fields' });
      continue;
    }

    const blockingPlan = await DB.prepare(
      "SELECT id, status FROM managed_rollover_plans WHERE group_id = ? AND khatma_type = ? AND status IN ('approved','active') LIMIT 1"
    ).bind(groupId, khatmaType).first();

    if (blockingPlan) {
      results.push({ khatma_id: khatmaId, khatma_serial: item.khatma_serial || null, group_id: groupId, status: 'skipped', reason: 'active_plan_exists', blocking_plan_id: blockingPlan.id, blocking_plan_status: blockingPlan.status });
      continue;
    }

    try {
      const fakeReq = new Request('https://internal/generate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ group_id: groupId, khatma_type: khatmaType, current_khatma_id: khatmaId, algorithm: 'period_shift_v1', save_as_draft: true })
      });
      const resp = await generatePreviewManagedRolloverPlan(fakeReq, DB);
      const data = await resp.json();

      if (data.draft_plan_id) {
        results.push({ khatma_id: khatmaId, khatma_serial: item.khatma_serial || null, group_id: groupId, status: 'created', draft_plan_id: data.draft_plan_id, warning_count: (data.warnings || []).length });
      } else if (data.ok === false) {
        results.push({ khatma_id: khatmaId, khatma_serial: item.khatma_serial || null, group_id: groupId, status: 'failed', reason: data.error || 'generation_failed', errors: (data.errors || []).map(e => e.code || e) });
      } else {
        results.push({ khatma_id: khatmaId, khatma_serial: item.khatma_serial || null, group_id: groupId, status: 'skipped', reason: 'no_draft_returned' });
      }
    } catch (err) {
      results.push({ khatma_id: khatmaId, khatma_serial: item.khatma_serial || null, group_id: groupId, status: 'failed', reason: err.message || 'internal_error' });
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed  = results.filter(r => r.status === 'failed' || r.status === 'error').length;
  return json({ ok: true, summary: { total: items.length, created, skipped, failed }, results });
}

async function forecastManagedRolloverPlan(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  let body; try { body = await request.json(); } catch { body = {}; }
  const groupId = String(body.group_id || '').trim();
  const khatmaId = String(body.khatma_id || '').trim();
  const periodsReq = Math.min(1000, Math.max(1, Number(body.periods || 12)));
  if (!groupId) return json({ ok: false, error: 'group_id_required' }, 400);
  const group = await DB.prepare("SELECT id, name, rotation_type FROM managed_reader_groups WHERE id = ? LIMIT 1").bind(groupId).first();
  if (!group) return json({ ok: false, error: 'group_not_found' }, 404);
  let startPeriodIndex = 0;
  let khatmaType = group.rotation_type || 'monthly';
  let currentSerial = null;
  if (khatmaId) {
    const kh = await DB.prepare("SELECT period_number, khatma_type, khatma_serial_number FROM managed_khatmas WHERE id = ? LIMIT 1").bind(khatmaId).first();
    if (kh) { startPeriodIndex = Number(kh.period_number || 0); if (kh.khatma_type) khatmaType = kh.khatma_type; currentSerial = kh.khatma_serial_number; }
  } else {
    const latest = await DB.prepare("SELECT period_number, khatma_type, khatma_serial_number FROM managed_khatmas WHERE group_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY period_number DESC LIMIT 1").bind(groupId).first();
    if (latest) { startPeriodIndex = Number(latest.period_number || 0); if (latest.khatma_type) khatmaType = latest.khatma_type; currentSerial = latest.khatma_serial_number; }
  }
  const readers = (await DB.prepare(`
    SELECT id AS reader_profile_id, reader_name, start_juz, parts_count
    FROM managed_reader_profiles
    WHERE group_id = ? AND start_juz IS NOT NULL AND start_juz > 0
      AND parts_count IS NOT NULL AND parts_count > 0 AND status = 'active'
    ORDER BY start_juz ASC
  `).bind(groupId).all()).results || [];
  if (!readers.length) return json({ ok: false, error: 'no_active_readers_with_juz', hint: 'readers must have start_juz and parts_count set' }, 404);
  const cycles = [];
  for (let p = 0; p < periodsReq; p++) {
    const periodIndex = startPeriodIndex + p;
    const occupied = new Map();
    const assignments = [];
    for (const r of readers) {
      const sj = Number(r.start_juz); const pc = Number(r.parts_count);
      if (!Number.isInteger(sj) || sj < 1 || sj > 30 || !Number.isInteger(pc) || pc < 1) continue;
      const units = Array.from({ length: pc }, (_, i) => ((sj - 1 + periodIndex * pc + i) % 30) + 1);
      assignments.push({ reader_profile_id: r.reader_profile_id, reader_name: r.reader_name, start_juz: sj, parts_count: pc, units });
      units.forEach(u => { if (!occupied.has(u)) occupied.set(u, []); occupied.get(u).push(r.reader_profile_id); });
    }
    const warnings = [];
    const allUnits = new Set(assignments.flatMap(a => a.units));
    for (let u = 1; u <= 30; u++) { if (!allUnits.has(u)) warnings.push({ code: 'cycle_missing_unit', unit_number: u }); }
    occupied.forEach((rids, u) => { if (rids.length > 1) warnings.push({ code: 'multi_reader_unit', unit_number: u, reader_count: rids.length }); });
    cycles.push({ period_index: periodIndex, period_label: String(periodIndex + 1), assignments, warnings });
  }
  return json({ ok: true, group_id: groupId, group_name: group.name || '', khatma_type: khatmaType, starting_from_period: startPeriodIndex, current_khatma_serial: currentSerial, periods_count: periodsReq, cycles });
}

async function deleteDraftManagedRolloverPlan(request, DB, planId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const plan = await DB.prepare("SELECT id, status, group_id FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(planId).first();
  if (!plan) return json({ ok: false, error: 'plan_not_found' }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  if (plan.status !== 'draft') return json({ ok: false, error: 'only_draft_plans_can_be_deleted', status: plan.status }, 409);
  await DB.batch([
    DB.prepare("DELETE FROM managed_rollover_plan_assignments WHERE plan_id = ?").bind(planId),
    DB.prepare("DELETE FROM managed_rollover_plan_readers WHERE plan_id = ?").bind(planId),
    DB.prepare("DELETE FROM managed_rollover_plan_events WHERE plan_id = ?").bind(planId),
    DB.prepare("DELETE FROM managed_rollover_plans WHERE id = ? AND status = 'draft'").bind(planId),
  ]);
  return json({ ok: true, deleted: true, planId });
}

async function invalidateManagedRolloverPlan(request, DB, id) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;
  const plan = await DB.prepare("SELECT * FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(id).first();
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const body = await readJson(request);
  const reason = String(body.reason || body.invalidation_reason || "").trim();
  if (!reason) return json({ ok: false, error: "invalidation_reason_required" }, 400);
  const planStatus = String(plan.status || "");
  if (planStatus === "completed") return json({ ok: false, error: "completed_plan_cannot_be_invalidated" }, 409);
  if (planStatus === "invalidated") return json({ ok: false, error: "plan_already_invalidated" }, 409);
  if (!["draft", "approved", "active"].includes(planStatus)) {
    return json({ ok: false, error: "plan_status_not_invalidatable", status: planStatus }, 409);
  }
  const t = now();
  await DB.batch([
    DB.prepare("UPDATE managed_rollover_plans SET status = 'invalidated', invalidated_by_user_id = ?, invalidated_at = ?, invalidation_reason = ?, updated_at = ? WHERE id = ?")
      .bind(check.user.id, t, reason, t, id),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'invalidated', ?, ?, ?)")
      .bind(newId("rpe"), id, JSON.stringify({ reason }), check.user.id, t)
  ]);
  return json({ ok: true, invalidated: true, planId: id, reason });
}

async function editManagedRolloverPlanAssignment(request, DB, planId, assignmentId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  const plan = await DB.prepare("SELECT id, group_id, status FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(planId).first();
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  if (plan.status !== "draft") return json({ ok: false, error: "plan_not_draft", current_status: plan.status }, 409);

  const assignment = await DB.prepare(
    "SELECT * FROM managed_rollover_plan_assignments WHERE id = ? AND plan_id = ? LIMIT 1"
  ).bind(assignmentId, planId).first();
  if (!assignment) return json({ ok: false, error: "assignment_not_found" }, 404);

  const body = await readJson(request);
  const hasReader = Object.prototype.hasOwnProperty.call(body, "reader_profile_id");
  const hasUnit = Object.prototype.hasOwnProperty.call(body, "unit_number");
  const hasSlot = Object.prototype.hasOwnProperty.call(body, "slot_index");
  if (!hasReader && !hasUnit && !hasSlot) {
    return json({ ok: false, error: "يجب إرسال حقل واحد على الأقل: reader_profile_id أو unit_number أو slot_index" }, 400);
  }

  const newReader = hasReader ? String(body.reader_profile_id || "").trim() : null;
  const newUnit = hasUnit ? normalizeUnitNumber(body.unit_number) : null;
  const newSlot = hasSlot ? normalizePositiveInt(body.slot_index, null) : null;

  if (hasReader) {
    if (!newReader) return json({ ok: false, error: "reader_profile_id لا يمكن أن يكون فارغاً" }, 400);
    const profile = await DB.prepare("SELECT id, reader_name, status, group_id FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(newReader).first();
    if (!profile) return json({ ok: false, error: "reader_profile_not_found" }, 400);
    if (profile.status !== "active") return json({ ok: false, error: "reader_not_active" }, 409);
    if (String(profile.group_id || "") !== String(plan.group_id || "")) return json({ ok: false, error: "reader_group_mismatch" }, 400);
    const inPlan = await DB.prepare("SELECT id FROM managed_rollover_plan_readers WHERE plan_id = ? AND reader_profile_id = ? LIMIT 1").bind(planId, newReader).first();
    if (!inPlan) return json({ ok: false, error: "reader_not_in_plan" }, 409);
  }
  if (hasUnit && !newUnit) return json({ ok: false, error: "unit_number يجب أن يكون بين 1 و 30" }, 400);
  if (hasSlot) {
    if (!newSlot) return json({ ok: false, error: "slot_index يجب أن يكون عدداً صحيحاً أكبر من 0" }, 400);
    const effectiveReader = hasReader ? newReader : String(assignment.reader_profile_id || "");
    if (effectiveReader) {
      const dupSlot = await DB.prepare("SELECT id FROM managed_rollover_plan_assignments WHERE plan_id = ? AND cycle_number = ? AND reader_profile_id = ? AND slot_index = ? AND id != ? LIMIT 1").bind(planId, assignment.cycle_number, effectiveReader, newSlot, assignmentId).first();
      if (dupSlot) return json({ ok: false, error: "duplicate_slot_index_for_reader", cycle_number: assignment.cycle_number, slot_index: newSlot }, 409);
    }
  }

  const setClauses = [];
  const setVals = [];
  if (hasReader) { setClauses.push("reader_profile_id = ?"); setVals.push(newReader); }
  if (hasUnit)   { setClauses.push("unit_number = ?");       setVals.push(newUnit); }
  if (hasSlot)   { setClauses.push("slot_index = ?");        setVals.push(newSlot); }
  const t = now();
  setClauses.push("updated_at = ?");
  setVals.push(t);
  setVals.push(assignmentId);

  const before = {};
  const after = {};
  if (hasReader) { before.reader_profile_id = assignment.reader_profile_id; after.reader_profile_id = newReader; }
  if (hasUnit)   { before.unit_number = Number(assignment.unit_number);     after.unit_number = newUnit; }
  if (hasSlot)   { before.slot_index = Number(assignment.slot_index);       after.slot_index = newSlot; }

  await DB.batch([
    DB.prepare(`UPDATE managed_rollover_plan_assignments SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setVals),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'assignment_edited', ?, ?, ?)")
      .bind(newId("rpe"), planId, JSON.stringify({ assignment_id: assignmentId, before, after }), check.user.id, t)
  ]);

  const updated = await DB.prepare(`
    SELECT a.*, r.reader_name_snapshot AS reader_name
    FROM managed_rollover_plan_assignments a
    LEFT JOIN managed_rollover_plan_readers r ON r.plan_id = a.plan_id AND r.reader_profile_id = a.reader_profile_id
    WHERE a.id = ? LIMIT 1
  `).bind(assignmentId).first();

  return json({ ok: true, assignment: updated, warnings: [] });
}

async function addManagedRolloverPlanAssignment(request, DB, planId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  const plan = await DB.prepare("SELECT id, group_id, status FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(planId).first();
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  if (plan.status !== "draft") return json({ ok: false, error: "plan_not_draft", current_status: plan.status }, 409);

  const body = await readJson(request);
  const readerProfileId = String(body.reader_profile_id || "").trim();
  const unitNumber = normalizeUnitNumber(body.unit_number);
  const slotIndex = normalizePositiveInt(body.slot_index, null);
  const cycleNumber = normalizePositiveInt(body.cycle_number, 1);

  if (!readerProfileId) return json({ ok: false, error: "reader_profile_id مطلوب" }, 400);
  if (!unitNumber) return json({ ok: false, error: "unit_number يجب أن يكون بين 1 و 30" }, 400);
  if (!slotIndex) return json({ ok: false, error: "slot_index يجب أن يكون عدداً صحيحاً أكبر من 0" }, 400);

  const profile = await DB.prepare("SELECT id, reader_name, status, group_id FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(readerProfileId).first();
  if (!profile) return json({ ok: false, error: "reader_profile_not_found" }, 400);
  if (profile.status !== "active") return json({ ok: false, error: "reader_not_active" }, 409);
  if (String(profile.group_id || "") !== String(plan.group_id || "")) return json({ ok: false, error: "reader_group_mismatch" }, 400);
  const inPlan = await DB.prepare("SELECT id FROM managed_rollover_plan_readers WHERE plan_id = ? AND reader_profile_id = ? LIMIT 1").bind(planId, readerProfileId).first();
  if (!inPlan) return json({ ok: false, error: "reader_not_in_plan" }, 409);

  const dupSlot = await DB.prepare("SELECT id FROM managed_rollover_plan_assignments WHERE plan_id = ? AND cycle_number = ? AND reader_profile_id = ? AND slot_index = ? LIMIT 1").bind(planId, cycleNumber, readerProfileId, slotIndex).first();
  if (dupSlot) return json({ ok: false, error: "duplicate_slot_index_for_reader", cycle_number: cycleNumber, slot_index: slotIndex }, 409);

  const t = now();
  const assignmentId = newId("rpa");
  const after = { reader_profile_id: readerProfileId, unit_number: unitNumber, slot_index: slotIndex, cycle_number: cycleNumber };

  await DB.batch([
    DB.prepare(`INSERT INTO managed_rollover_plan_assignments (
      id, plan_id, cycle_number, planned_period_number, reader_profile_id, unit_number,
      slot_index, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'planned', ?, ?)`)
      .bind(assignmentId, planId, cycleNumber, readerProfileId, unitNumber, slotIndex, t, t),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'assignment_added', ?, ?, ?)")
      .bind(newId("rpe"), planId, JSON.stringify({ assignment_id: assignmentId, after }), check.user.id, t)
  ]);

  const created = await DB.prepare(`
    SELECT a.*, r.reader_name_snapshot AS reader_name
    FROM managed_rollover_plan_assignments a
    LEFT JOIN managed_rollover_plan_readers r ON r.plan_id = a.plan_id AND r.reader_profile_id = a.reader_profile_id
    WHERE a.id = ? LIMIT 1
  `).bind(assignmentId).first();

  return json({ ok: true, assignment: created }, 201);
}

async function deleteManagedRolloverPlanAssignment(request, DB, planId, assignmentId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  const plan = await DB.prepare("SELECT id, group_id, status FROM managed_rollover_plans WHERE id = ? LIMIT 1").bind(planId).first();
  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);
  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  if (plan.status !== "draft") return json({ ok: false, error: "plan_not_draft", current_status: plan.status }, 409);

  const assignment = await DB.prepare("SELECT * FROM managed_rollover_plan_assignments WHERE id = ? AND plan_id = ? LIMIT 1").bind(assignmentId, planId).first();
  if (!assignment) return json({ ok: false, error: "assignment_not_found" }, 404);

  const before = { reader_profile_id: assignment.reader_profile_id, unit_number: Number(assignment.unit_number), slot_index: Number(assignment.slot_index), cycle_number: Number(assignment.cycle_number) };
  const t = now();
  await DB.batch([
    DB.prepare("DELETE FROM managed_rollover_plan_assignments WHERE id = ? AND plan_id = ?").bind(assignmentId, planId),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'assignment_deleted', ?, ?, ?)")
      .bind(newId("rpe"), planId, JSON.stringify({ assignment_id: assignmentId, before }), check.user.id, t)
  ]);
  return json({ ok: true, deleted_assignment_id: assignmentId });
}

let _cycleHistorySchemaReady = false;
async function ensureCycleHistorySchema(DB) {
  if (_cycleHistorySchemaReady) return;
  try {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS managed_khatma_cycle_snapshots (
        id TEXT PRIMARY KEY, khatma_id TEXT NOT NULL, cycle_number INTEGER NOT NULL,
        period_number INTEGER NOT NULL, plan_id TEXT,
        khatma_type TEXT NOT NULL DEFAULT 'monthly', applied_at TEXT NOT NULL,
        applied_by_user_id TEXT, total_units INTEGER NOT NULL DEFAULT 30,
        completed_units INTEGER NOT NULL DEFAULT 0, assigned_units INTEGER NOT NULL DEFAULT 0,
        reading_units INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        UNIQUE(khatma_id, cycle_number)
      )`).run(),
      DB.prepare(`CREATE TABLE IF NOT EXISTS managed_khatma_cycle_units (
        id TEXT PRIMARY KEY, cycle_snapshot_id TEXT NOT NULL, khatma_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        unit_number INTEGER NOT NULL CHECK(unit_number >= 1 AND unit_number <= 30),
        label TEXT NOT NULL DEFAULT '', slot_index INTEGER, participant_id_snap TEXT,
        participant_name TEXT, participant_access_code TEXT, reader_profile_id TEXT,
        reader_name TEXT, reader_access_code TEXT,
        status TEXT NOT NULL DEFAULT 'assigned', reading_at TEXT, completed_at TEXT,
        parts_count INTEGER, source_plan_id TEXT, created_at TEXT NOT NULL
      )`).run()
    ]);
  } catch { /* tables already exist from migrations */ }
  _cycleHistorySchemaReady = true;
}

async function snapshotCurrentCycle(DB, khatmaId, snapshotCycleNumber, planId, actorUserId, planCycleNumber) {
  await ensureCycleHistorySchema(DB);

  const khatma = await DB.prepare(
    "SELECT id, period_number, khatma_type FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1"
  ).bind(khatmaId).first();
  if (!khatma) return { ok: false, error: 'khatma_not_found' };

  const existing = await DB.prepare(
    "SELECT id FROM managed_khatma_cycle_snapshots WHERE khatma_id = ? AND cycle_number = ? LIMIT 1"
  ).bind(khatmaId, snapshotCycleNumber).first();
  if (existing) return { ok: false, error: 'cycle_snapshot_exists', existing_id: existing.id };

  const unitRows = (await DB.prepare(
    "SELECT * FROM managed_khatma_units WHERE khatma_id = ? ORDER BY unit_number ASC, id ASC"
  ).bind(khatmaId).all()).results || [];

  const partRows = (await DB.prepare(
    "SELECT id, participant_name, access_code, reader_profile_id FROM managed_khatma_participants WHERE khatma_id = ?"
  ).bind(khatmaId).all()).results || [];
  const partById = new Map(partRows.map(p => [String(p.id), p]));

  const rids = [...new Set(partRows.map(p => p.reader_profile_id).filter(Boolean))];
  const profileById = new Map();
  if (rids.length > 0) {
    const inClause = rids.map(() => '?').join(',');
    const profiles = (await DB.prepare(
      `SELECT id, reader_name, access_code FROM managed_reader_profiles WHERE id IN (${inClause})`
    ).bind(...rids).all()).results || [];
    for (const p of profiles) profileById.set(String(p.id), p);
  }

  const assignMap = new Map();
  if (planId) {
    const assigns = (await DB.prepare(
      "SELECT reader_profile_id, unit_number, slot_index FROM managed_rollover_plan_assignments WHERE plan_id = ? AND cycle_number = ?"
    ).bind(planId, planCycleNumber).all()).results || [];
    const partsCountByReader = new Map();
    for (const a of assigns) {
      const rid = String(a.reader_profile_id || '');
      partsCountByReader.set(rid, (partsCountByReader.get(rid) || 0) + 1);
    }
    for (const a of assigns) {
      const key = `${String(a.reader_profile_id || '')}|${Number(a.unit_number)}`;
      assignMap.set(key, { slot_index: a.slot_index ?? null, parts_count: partsCountByReader.get(String(a.reader_profile_id || '')) || null });
    }
  }

  let completedCount = 0, assignedCount = 0, readingCount = 0;
  for (const u of unitRows) {
    if (u.status === 'completed') completedCount++;
    else if (u.status === 'assigned') assignedCount++;
    else if (u.status === 'reading') readingCount++;
  }

  const t = now();
  const snapId = newId("kcsnap");

  const snapStmt = DB.prepare(
    `INSERT INTO managed_khatma_cycle_snapshots
      (id, khatma_id, cycle_number, period_number, plan_id, khatma_type,
       applied_at, applied_by_user_id, total_units, completed_units, assigned_units, reading_units, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    snapId, khatmaId, snapshotCycleNumber,
    Number(khatma.period_number) || 1,
    planId || null,
    khatma.khatma_type || 'monthly',
    t, actorUserId || null,
    unitRows.length, completedCount, assignedCount, readingCount, t
  );

  const uStmtBase = DB.prepare(
    `INSERT INTO managed_khatma_cycle_units
      (id, cycle_snapshot_id, khatma_id, cycle_number, unit_number, label, slot_index,
       participant_id_snap, participant_name, participant_access_code,
       reader_profile_id, reader_name, reader_access_code,
       status, reading_at, completed_at, parts_count, source_plan_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const unitStmts = unitRows.map(u => {
    const part = u.participant_id ? (partById.get(String(u.participant_id)) || null) : null;
    const rid = part?.reader_profile_id ? String(part.reader_profile_id) : null;
    const profile = rid ? (profileById.get(rid) || null) : null;
    const assignKey = (rid && u.unit_number != null) ? `${rid}|${Number(u.unit_number)}` : null;
    const assign = assignKey ? (assignMap.get(assignKey) || null) : null;
    return uStmtBase.bind(
      newId("kcunit"), snapId, khatmaId, snapshotCycleNumber,
      Number(u.unit_number),
      u.label || `الجزء ${u.unit_number}`,
      assign?.slot_index ?? null,
      part?.id || null, part?.participant_name || null, part?.access_code || null,
      rid || null, profile?.reader_name || null, profile?.access_code || null,
      u.status || 'assigned', u.reading_at || null, u.completed_at || null,
      assign?.parts_count ?? null, planId || null, t
    );
  });

  await DB.batch([snapStmt, ...unitStmts]);
  return {
    ok: true,
    snapshot_id: snapId,
    khatma_id: khatmaId,
    khatma_cycle_number: snapshotCycleNumber,
    plan_cycle_number: planCycleNumber,
    total_units_snapshotted: unitRows.length,
    completed_units: completedCount,
    assigned_units: assignedCount,
    reading_units: readingCount
  };
}

async function loadCycleHistory(DB, khatmaId) {
  await ensureCycleHistorySchema(DB);
  const snapshots = (await DB.prepare(
    "SELECT * FROM managed_khatma_cycle_snapshots WHERE khatma_id = ? ORDER BY cycle_number ASC"
  ).bind(khatmaId).all()).results || [];
  if (snapshots.length === 0) return { ok: true, khatma_id: khatmaId, cycles: [] };
  const units = (await DB.prepare(
    `SELECT * FROM managed_khatma_cycle_units WHERE khatma_id = ?
     ORDER BY cycle_number ASC, unit_number ASC, slot_index ASC, id ASC`
  ).bind(khatmaId).all()).results || [];
  const unitsByCycle = new Map();
  for (const u of units) {
    const cn = Number(u.cycle_number);
    if (!unitsByCycle.has(cn)) unitsByCycle.set(cn, []);
    unitsByCycle.get(cn).push(u);
  }
  const cycles = snapshots.map(snap => ({
    cycle_number: snap.cycle_number,
    period_number: snap.period_number,
    plan_id: snap.plan_id || null,
    khatma_type: snap.khatma_type,
    applied_at: snap.applied_at,
    applied_by_user_id: snap.applied_by_user_id || null,
    total_units: snap.total_units,
    completed_units: snap.completed_units,
    assigned_units: snap.assigned_units,
    reading_units: snap.reading_units,
    units: unitsByCycle.get(Number(snap.cycle_number)) || []
  }));
  return { ok: true, khatma_id: khatmaId, cycles };
}

async function applyManagedRolloverPlan(request, DB, planId) {
  const OPTION_A_APPLY_ENABLED = true;
  if (!OPTION_A_APPLY_ENABLED) {
    return json({ ok: false, error: 'option_a_apply_not_enabled' }, 503);
  }

  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const schemaError = await requireRolloverPlanSchema(DB);
  if (schemaError) return schemaError;

  const body = await readJson(request);
  const cycleNumber = normalizePositiveInt(body.cycle_number ?? body.cycleNumber, null);
  if (!cycleNumber) return json({ ok: false, error: 'cycle_number مطلوب وصحيح' }, 400);

  const plan = await loadRolloverPlan(DB, planId);
  if (!plan) return json({ ok: false, error: 'plan_not_found' }, 404);

  const access = await userCanManageRolloverGroup(DB, check.user, plan.group_id);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);

  if (!['approved', 'active'].includes(plan.status)) {
    return json({ ok: false, error: 'plan_not_appliable', current_status: plan.status }, 409);
  }

  if (!plan.current_khatma_id) return json({ ok: false, error: 'plan_current_khatma_id_missing' }, 400);
  const khatmaId = plan.current_khatma_id;
  const currentKhatma = await DB.prepare(
    'SELECT * FROM managed_khatmas WHERE id = ? AND deleted_at IS NULL LIMIT 1'
  ).bind(khatmaId).first();
  if (!currentKhatma) return json({ ok: false, error: 'current_khatma_not_found' }, 404);
  if (currentKhatma.archived_at) return json({ ok: false, error: 'current_khatma_already_archived' }, 409);

  const totalCycles = plan.total_cycles || 30;
  if (!Number.isInteger(cycleNumber) || cycleNumber < 1 || cycleNumber > totalCycles) {
    return json({ ok: false, error: 'cycle_number_out_of_range', total_cycles: totalCycles }, 400);
  }
  const maxAppliedRow = await DB.prepare(
    "SELECT COALESCE(MAX(cycle_number), 0) AS maxCycle FROM managed_rollover_plan_assignments WHERE plan_id = ? AND status = 'applied'"
  ).bind(planId).first();
  const expectedNext = (Number(maxAppliedRow?.maxCycle) || 0) + 1;
  if (cycleNumber !== expectedNext) {
    return json({ ok: false, error: 'cycle_out_of_order', expected: expectedNext, requested: cycleNumber }, 409);
  }

  const existingSnap = await DB.prepare(
    'SELECT id FROM managed_khatma_cycle_snapshots WHERE khatma_id = ? AND cycle_number = ? LIMIT 1'
  ).bind(khatmaId, currentKhatma.period_number).first();
  if (existingSnap) {
    return json({ ok: false, error: 'cycle_snapshot_already_exists', snapshot_id: existingSnap.id, khatma_cycle_number: currentKhatma.period_number }, 409);
  }

  const existingEvent = await DB.prepare(
    "SELECT id FROM managed_rollover_plan_events WHERE plan_id = ? AND event_type = 'cycle_applied' AND json_extract(event_payload_json, '$.plan_cycle_number') = ? LIMIT 1"
  ).bind(planId, cycleNumber).first();
  if (existingEvent) {
    return json({ ok: false, error: 'cycle_already_applied_event', event_id: existingEvent.id }, 409);
  }

  const assignments = (await DB.prepare(
    'SELECT * FROM managed_rollover_plan_assignments WHERE plan_id = ? AND cycle_number = ? ORDER BY unit_number ASC, slot_index ASC'
  ).bind(planId, cycleNumber).all()).results || [];
  if (assignments.length === 0) return json({ ok: false, error: 'cycle_no_assignments', cycle_number: cycleNumber }, 400);
  if (!assignments.every(a => Number.isInteger(Number(a.unit_number)) && Number(a.unit_number) >= 1 && Number(a.unit_number) <= 30)) {
    return json({ ok: false, error: 'assignment_unit_number_out_of_range' }, 400);
  }

  const planReaders = (await DB.prepare('SELECT * FROM managed_rollover_plan_readers WHERE plan_id = ?').bind(planId).all()).results || [];
  const planReaderById = new Map(planReaders.map(r => [r.reader_profile_id, r]));
  const uniqueRids = [...new Set(assignments.map(a => String(a.reader_profile_id)))];
  for (const rid of uniqueRids) {
    if (!planReaderById.has(rid)) return json({ ok: false, error: 'reader_not_in_plan', reader_profile_id: rid }, 400);
  }
  const inClause = uniqueRids.map(() => '?').join(',');
  const activeProfiles = (await DB.prepare(
    `SELECT id, reader_name, phone, access_code, notes, group_id, status FROM managed_reader_profiles WHERE id IN (${inClause})`
  ).bind(...uniqueRids).all()).results || [];
  const profileById = new Map(activeProfiles.map(p => [p.id, p]));
  for (const rid of uniqueRids) {
    const profile = profileById.get(rid);
    if (!profile) return json({ ok: false, error: 'reader_profile_not_found', reader_profile_id: rid }, 400);
    if (profile.status !== 'active') return json({ ok: false, error: 'inactive_reader', reader_profile_id: rid }, 400);
    if (profile.group_id !== plan.group_id) return json({ ok: false, error: 'reader_wrong_group', reader_profile_id: rid }, 400);
  }

  const byReader = new Map();
  for (const a of assignments) {
    const rid = String(a.reader_profile_id);
    if (!byReader.has(rid)) byReader.set(rid, []);
    byReader.get(rid).push(a);
  }
  for (const [rid, asgns] of byReader) {
    const pr = planReaderById.get(rid);
    if (asgns.length !== (pr?.parts_count_snapshot || 0)) {
      return json({ ok: false, error: 'parts_count_mismatch', reader_profile_id: rid, expected: pr?.parts_count_snapshot, actual: asgns.length }, 400);
    }
  }

  const validation = await validateRolloverPlan(DB, plan, { excludePlanId: planId });
  if (!validation.valid) {
    return json({ ok: false, error: 'plan_no_longer_valid', validation_errors: validation.errors }, 409);
  }

  const snapResult = await snapshotCurrentCycle(DB, khatmaId, currentKhatma.period_number, planId, check.user.id, cycleNumber);
  if (!snapResult.ok) {
    return json({ ok: false, error: 'snapshot_failed', detail: snapResult.error }, 500);
  }

  const t = now();
  const isLastCycle = cycleNumber === totalCycles;
  const newPlanStatus = isLastCycle ? 'completed' : 'active';
  const newPeriodNumber = (Number(currentKhatma.period_number) || 1) + 1;
  const todayIso = new Date().toISOString().slice(0, 10);
  const newExpiresAt = computeRotationPeriodEnd(todayIso, plan.khatma_type)?.toISOString() || null;
  const newWeekNumber = currentKhatma.week_number ? String(Number(currentKhatma.week_number) + 1) : '';

  const participantIdByRid = new Map();
  const participantStmts = [];
  const pStmt = DB.prepare(
    'INSERT INTO managed_khatma_participants (id, khatma_id, participant_name, phone, access_code, reader_profile_id, notes, start_juz, parts_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const [rid, asgns] of byReader) {
    const profile = profileById.get(rid);
    const partId = newId('mpart');
    participantIdByRid.set(rid, partId);
    const units = asgns.map(a => Number(a.unit_number)).sort((a, b) => a - b);
    participantStmts.push(pStmt.bind(partId, khatmaId, profile.reader_name || '', profile.phone || null, profile.access_code || '', rid, profile.notes || '', units[0], units.length, t, t));
  }

  const uStmt = DB.prepare(
    'INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)'
  );
  const unitStmts = assignments.map(a => {
    const rid = String(a.reader_profile_id);
    const partId = participantIdByRid.get(rid) || null;
    return uStmt.bind(newId('munit'), khatmaId, Number(a.unit_number), `الجزء ${a.unit_number}`, partId ? 'assigned' : 'available', partId, t);
  });

  const allStmts = [
    DB.prepare('DELETE FROM managed_khatma_units WHERE khatma_id = ?').bind(khatmaId),
    DB.prepare('DELETE FROM managed_khatma_participants WHERE khatma_id = ?').bind(khatmaId),
    ...participantStmts,
    ...unitStmts,
    DB.prepare(`UPDATE managed_khatmas SET period_number = ?, applied_cycle = ?, khatma_date = ?, expires_at = ?, week_number = ? WHERE id = ? AND deleted_at IS NULL`)
      .bind(newPeriodNumber, cycleNumber, todayIso, newExpiresAt || '', newWeekNumber, khatmaId),
    DB.prepare(`UPDATE managed_rollover_plan_assignments SET status = 'applied', applied_khatma_id = ?, applied_at = ?, updated_at = ? WHERE plan_id = ? AND cycle_number = ? AND status = 'planned'`)
      .bind(khatmaId, t, t, planId, cycleNumber),
    DB.prepare(`UPDATE managed_rollover_plans SET status = ?, updated_at = ? WHERE id = ? AND status IN ('approved', 'active')`)
      .bind(newPlanStatus, t, planId),
    DB.prepare("INSERT INTO managed_rollover_plan_events (id, plan_id, event_type, event_payload_json, created_by_user_id, created_at) VALUES (?, ?, 'cycle_applied', ?, ?, ?)")
      .bind(newId('rpe'), planId,
        JSON.stringify({ option: 'A', plan_cycle_number: cycleNumber, khatma_cycle_number: currentKhatma.period_number, khatma_id: khatmaId, khatma_serial_number: currentKhatma.khatma_serial_number || null, period_number_new: newPeriodNumber, snapshot_id: snapResult.snapshot_id, history_units_inserted: snapResult.total_units_snapshotted, current_units_rebuilt: assignments.length, is_last_cycle: isLastCycle, created_new_khatma: false }),
        check.user.id, t)
  ];

  await DB.batch(allStmts);

  return json({ ok: true, option: 'A', khatma_id: khatmaId, khatma_serial_number: currentKhatma.khatma_serial_number || null, plan_cycle_number: cycleNumber, khatma_cycle_number: currentKhatma.period_number, period_number_new: newPeriodNumber, snapshot_id: snapResult.snapshot_id, history_units_inserted: snapResult.total_units_snapshotted, current_units_rebuilt: assignments.length, created_new_khatma: false }, 200);
}

async function getCycleHistory(request, DB, khatmaId) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const result = await requireManagedControl(request, DB, khatmaId);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status || 403);
  const history = await loadCycleHistory(DB, khatmaId);
  return json(history);
}

// ══════════════════════════════════════════════════════════════════════════════
// BATCH MONTHLY ROLLOVER
// ══════════════════════════════════════════════════════════════════════════════

let _batchRolloverSchemaReady = false;

async function ensureBatchRolloverSchema(DB) {
  if (_batchRolloverSchemaReady) return;
  try {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS managed_batch_rollover_events (
        id TEXT PRIMARY KEY,
        khatma_id TEXT NOT NULL,
        group_id TEXT,
        target_year_month TEXT NOT NULL,
        period_number_before INTEGER,
        period_number_after INTEGER,
        algorithm TEXT NOT NULL,
        assignments_created INTEGER DEFAULT 0,
        readers_count INTEGER DEFAULT 0,
        applied_by_user_id TEXT,
        event_payload_json TEXT,
        created_at TEXT NOT NULL
      )`).run(),
      DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_brev_khatma_month
        ON managed_batch_rollover_events(khatma_id, target_year_month)`).run(),
      DB.prepare(`CREATE INDEX IF NOT EXISTS idx_brev_month_created
        ON managed_batch_rollover_events(target_year_month, created_at)`).run(),
      DB.prepare(`CREATE INDEX IF NOT EXISTS idx_brev_khatma_created
        ON managed_batch_rollover_events(khatma_id, created_at)`).run()
    ]);
  } catch { /* table/indexes already exist from migration */ }
  _batchRolloverSchemaReady = true;
}

async function batchStatementsInChunks(DB, statements, size = 25) {
  for (let i = 0; i < statements.length; i += size) {
    await DB.batch(statements.slice(i, i + size));
  }
}

async function loadCompletedBatchRolloverKhatmaIds(DB, targetYearMonth, khatmaIds, size = 90) {
  const completed = new Set();
  for (let i = 0; i < khatmaIds.length; i += size) {
    const ids = khatmaIds.slice(i, i + size).filter(Boolean);
    if (!ids.length) continue;
    const inClause = ids.map(() => '?').join(',');
    const rows = (await DB.prepare(
      `SELECT khatma_id
       FROM managed_batch_rollover_events
       WHERE target_year_month = ?
         AND khatma_id IN (${inClause})`
    ).bind(targetYearMonth, ...ids).all()).results || [];
    for (const row of rows) completed.add(row.khatma_id);
  }
  return completed;
}

const ROLLOVER_CLOSING_WINDOW_DAYS = 2;

async function batchMonthlyRollover(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  await ensureBatchRolloverSchema(DB);
  await ensureCycleHistorySchema(DB);

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const targetYearMonth = String(body.target_year_month || '').trim();
  const _ymParts = /^(\d{4})-(\d{2})$/.exec(targetYearMonth);
  const _hijriYear = _ymParts ? Number(_ymParts[1]) : 0;
  const _hijriMonth = _ymParts ? Number(_ymParts[2]) : 0;
  if (!_ymParts || _hijriYear < 1300 || _hijriYear > 1600 || _hijriMonth < 1 || _hijriMonth > 12) {
    return json({ ok: false, error: 'invalid_target_year_month', message: 'target_year_month must be a Hijri year-month key like 1448-02 (year 1300-1600, month 01-12)' }, 400);
  }

  const requestedGroupIds = Array.isArray(body.group_ids) && body.group_ids.length
    ? body.group_ids.map(id => String(id).trim()).filter(Boolean)
    : null;
  const dryRun = body.dry_run === true;

  // Calendar closing-window guard: a real (non-preview) run into a PAST or CURRENT
  // Hijri month is always allowed as catch-up (target == current is allowed as
  // catch-up only; duplicate protection remains handled by managed_batch_rollover_events).
  // Rolling into the immediate NEXT month is allowed only inside the closing window
  // (last ROLLOVER_CLOSING_WINDOW_DAYS days of the current Hijri month), so real
  // month-end prep can run a day or two early. Anything further out is blocked.
  // Preview (dry_run:true) is exempt so planning/testing can look ahead freely.
  if (!dryRun) {
    const _todayHijri = getHijriPartsServer(new Date());
    const _currentKeyNum = _todayHijri.year * 12 + _todayHijri.month;
    const _targetKeyNum = _hijriYear * 12 + _hijriMonth;
    const _currentYearMonthStr = `${_todayHijri.year}-${String(_todayHijri.month).padStart(2, '0')}`;

    if (_targetKeyNum > _currentKeyNum + 1) {
      return json({
        ok: false,
        error: 'rollover_too_early',
        message: 'لا يمكن تنفيذ التدوير الحقيقي لشهر مستقبلي بعيد. المعاينة فقط مسموحة الآن.',
        current_hijri_year_month: _currentYearMonthStr,
        target_year_month: targetYearMonth
      }, 409);
    }

    if (_targetKeyNum === _currentKeyNum + 1) {
      const daysInCurrentMonth = getHijriPartsServer(hijriMonthEndDateServer(new Date())).day;
      const daysRemainingInCurrentMonth = daysInCurrentMonth - _todayHijri.day;
      if (!isWithinRolloverClosingWindow(new Date(), ROLLOVER_CLOSING_WINDOW_DAYS)) {
        return json({
          ok: false,
          error: 'rollover_too_early',
          message: 'لا يمكن تنفيذ التدوير الحقيقي للشهر القادم إلا خلال آخر يومين من الشهر الهجري الحالي. المعاينة (dry_run) مسموحة الآن.',
          current_hijri_year_month: _currentYearMonthStr,
          target_year_month: targetYearMonth,
          closing_window_days: ROLLOVER_CLOSING_WINDOW_DAYS,
          days_remaining_in_current_month: daysRemainingInCurrentMonth
        }, 409);
      }
    }
    // else _targetKeyNum <= _currentKeyNum: past or current month, catch-up, always allowed here.
  }

  const requestedMode = String(body.mode || '').trim();
  const chunkMode = !dryRun && requestedMode === 'next_pending_chunk' ? 'next_pending_chunk' : 'offset';
  const algorithm = String(body.algorithm || 'period_shift_v1').trim();
  if (algorithm !== 'period_shift_v1') {
    return json({ ok: false, error: 'unsupported_algorithm', supported: ['period_shift_v1'] }, 400);
  }

  const _maxLimit = dryRun ? 99 : 1;
  const _rawOffset = Number.isInteger(Number(body.offset)) && Number(body.offset) >= 0 ? Number(body.offset) : 0;
  const _rawLimit = Number.isInteger(Number(body.limit)) && Number(body.limit) > 0
    ? Math.min(Number(body.limit), _maxLimit)
    : _maxLimit;

  // Eligible khatmas: monthly, active, scoped by caller's authorization
  const isOwner = check.user.role === 'owner';
  const khatmaOrderBy = "ORDER BY COALESCE(mk.khatma_serial_number, ''), COALESCE(mk.title, ''), mk.id ASC";
  let khatmaRows;

  if (isOwner) {
    // Owner sees all active monthly khatmas — no group creator restriction
    const ownerSelect = `
      SELECT mk.id, mk.title, mk.group_id, mk.period_number, mk.khatma_serial_number,
             mrg.name AS group_name
      FROM managed_khatmas mk
      JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
      WHERE mk.khatma_type = 'monthly'
        AND mk.deleted_at IS NULL
        AND mk.archived_at IS NULL
        AND mk.status = 'active'
        AND mrg.status = 'active'
    `;
    if (requestedGroupIds && requestedGroupIds.length) {
      const inClause = requestedGroupIds.map(() => '?').join(',');
      khatmaRows = (await DB.prepare(`${ownerSelect} AND mrg.id IN (${inClause}) ${khatmaOrderBy}`)
        .bind(...requestedGroupIds).all()).results || [];
    } else {
      khatmaRows = (await DB.prepare(`${ownerSelect} ${khatmaOrderBy}`).all()).results || [];
    }
  } else {
    // Creator path: khatmas created by peers in the same creator group(s).
    // getCreatorGroupMemberIds returns user IDs (not reader group IDs).
    // mk.created_by_user_id is the correct join key, not mk.group_id.
    const visibleUserIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userInClause = visibleUserIds.map(() => '?').join(',');
    const baseCreatorSelect = `
      SELECT mk.id, mk.title, mk.group_id, mk.period_number, mk.khatma_serial_number,
             mrg.name AS group_name
      FROM managed_khatmas mk
      JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
      WHERE mk.khatma_type = 'monthly'
        AND mk.deleted_at IS NULL
        AND mk.archived_at IS NULL
        AND mk.status = 'active'
        AND mk.created_by_user_id IN (${userInClause})
        AND mrg.status = 'active'
    `;
    if (requestedGroupIds && requestedGroupIds.length) {
      // Validate supplied group_ids are reader group IDs visible to this creator
      const visGroupRows = (await DB.prepare(
        `SELECT DISTINCT mk.group_id FROM managed_khatmas mk
         WHERE mk.khatma_type = 'monthly'
           AND mk.deleted_at IS NULL
           AND mk.archived_at IS NULL
           AND mk.created_by_user_id IN (${userInClause})`
      ).bind(...visibleUserIds).all()).results || [];
      const visibleReaderGroupIds = visGroupRows.map(r => r.group_id);
      const unauthorized = requestedGroupIds.filter(id => !visibleReaderGroupIds.includes(id));
      if (unauthorized.length) {
        return json({ ok: false, error: 'unauthorized_groups', unauthorized_group_ids: unauthorized }, 403);
      }
      const groupInClause = requestedGroupIds.map(() => '?').join(',');
      khatmaRows = (await DB.prepare(`${baseCreatorSelect} AND mk.group_id IN (${groupInClause}) ${khatmaOrderBy}`)
        .bind(...visibleUserIds, ...requestedGroupIds).all()).results || [];
    } else {
      khatmaRows = (await DB.prepare(`${baseCreatorSelect} ${khatmaOrderBy}`)
        .bind(...visibleUserIds).all()).results || [];
    }
  }

  // Slice the candidate list into a safe chunk. Real next_pending_chunk excludes
  // completed khatmas before processing so completed rows are not returned as skips.
  const totalCandidates = khatmaRows.length;
  const allCandidateIds = khatmaRows.map(k => k.id).filter(Boolean);
  const completedBeforeSet = await loadCompletedBatchRolloverKhatmaIds(DB, targetYearMonth, allCandidateIds);
  const completedBefore = completedBeforeSet.size;
  const pendingRows = chunkMode === 'next_pending_chunk'
    ? khatmaRows.filter(k => !completedBeforeSet.has(k.id))
    : khatmaRows;
  const pendingFound = Math.max(0, totalCandidates - completedBefore);
  const chunkSource = chunkMode === 'next_pending_chunk' ? pendingRows : khatmaRows;
  const batchOffset = chunkMode === 'next_pending_chunk' ? 0 : Math.max(0, Math.min(_rawOffset, totalCandidates));
  const batchLimit = _rawLimit;
  const chunk = chunkSource.slice(batchOffset, batchOffset + batchLimit);
  const processedCount = chunk.length;
  const hasMoreBeforeApply = chunkMode === 'next_pending_chunk'
    ? processedCount < pendingFound
    : batchOffset + processedCount < totalCandidates;
  const nextOffset = chunkMode === 'next_pending_chunk' ? null : (hasMoreBeforeApply ? batchOffset + processedCount : null);

  // Prefetch readers for all groups in this chunk — 1 query replaces N per-khatma queries
  const chunkGroupIds = [...new Set(chunk.map(k => k.group_id).filter(Boolean))];
  const readersByGroupId = new Map();
  if (chunkGroupIds.length) {
    const rgClause = chunkGroupIds.map(() => '?').join(',');
    const allReaderRows = (await DB.prepare(
      `SELECT id AS reader_profile_id, reader_name, phone, access_code, group_id, start_juz, parts_count, status
       FROM managed_reader_profiles
       WHERE status = 'active' AND group_id IN (${rgClause}) ORDER BY id ASC`
    ).bind(...chunkGroupIds).all()).results || [];
    // Membership rows cover readers linked to a group without matching managed_reader_profiles.group_id
    const membershipRows = (await DB.prepare(
      `SELECT mrp.id AS reader_profile_id, mrp.reader_name, mrp.phone, mrp.access_code, rgm.group_id AS group_id, mrp.start_juz, mrp.parts_count, mrp.status
       FROM managed_reader_group_memberships rgm
       JOIN managed_reader_profiles mrp ON mrp.id = rgm.reader_profile_id
       WHERE rgm.status = 'active' AND rgm.group_id IN (${rgClause}) AND mrp.status = 'active'`
    ).bind(...chunkGroupIds).all()).results || [];
    const seenByGroup = new Set();
    for (const r of [...allReaderRows, ...membershipRows]) {
      const dedupeKey = `${r.group_id}::${r.reader_profile_id}`;
      if (seenByGroup.has(dedupeKey)) continue;
      seenByGroup.add(dedupeKey);
      const sj = normalizePositiveInt(r.start_juz, null);
      const pc = normalizePositiveInt(r.parts_count, null) || 0;
      const mapped = { reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || '', phone: r.phone || '', access_code: r.access_code || '', group_id: r.group_id || '', start_juz: sj, parts_count: pc, status: r.status || 'active' };
      if (!readersByGroupId.has(r.group_id)) readersByGroupId.set(r.group_id, { active: [], inactive: [] });
      if (sj && pc) readersByGroupId.get(r.group_id).active.push(mapped);
      else readersByGroupId.get(r.group_id).inactive.push(mapped);
    }
  }

  // Prefetch existing batch events for chunk — 1 query
  const chunkKhatmaIds = chunk.map(k => k.id);
  const existingEventsSet = await loadCompletedBatchRolloverKhatmaIds(DB, targetYearMonth, chunkKhatmaIds);

  // Prefetch existing snapshots for chunk — 1 query
  const existingSnapsSet = new Set();
  const maxSnapshotCycleByKhatma = new Map();
  if (chunkKhatmaIds.length) {
    const snapClause = chunkKhatmaIds.map(() => '?').join(',');
    const snapRows = (await DB.prepare(
      `SELECT khatma_id, cycle_number FROM managed_khatma_cycle_snapshots WHERE khatma_id IN (${snapClause})`
    ).bind(...chunkKhatmaIds).all()).results || [];
    for (const s of snapRows) {
      const snapKhatmaId = s.khatma_id;
      const snapCycle = Number(s.cycle_number) || 0;
      existingSnapsSet.add(`${snapKhatmaId}|${snapCycle}`);
      const currentMax = maxSnapshotCycleByKhatma.get(snapKhatmaId) || 0;
      if (snapCycle > currentMax) maxSnapshotCycleByKhatma.set(snapKhatmaId, snapCycle);
    }
  }

  const rolled = [];
  const skipped = [];
  const failed = [];
  const warnings = [];
  let partialRecoveryTotal = 0;

  for (const khatma of chunk) {
    const khatmaId = khatma.id;
    const groupId = khatma.group_id || '';
    const khatmaName = khatma.title || '';
    const groupName = khatma.group_name || '';
    const periodBefore = Number(khatma.period_number) || 1;

    try {
      // Guard 1: event exists — already fully rolled for this target month
      if (existingEventsSet.has(khatmaId)) {
        skipped.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, reason: 'already_rolled_this_month' });
        continue;
      }

      // Guard 2: detect partial recovery vs inconsistent snapshot state
      const hasSnapForThisCycle = existingSnapsSet.has(`${khatmaId}|${periodBefore}`);
      const maxSnapCycle = maxSnapshotCycleByKhatma.get(khatmaId) || 0;
      if (maxSnapCycle > periodBefore) {
        skipped.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, reason: 'inconsistent_future_snapshot', max_snapshot_cycle: maxSnapCycle, period_before: periodBefore });
        continue;
      }
      const isPartialRecovery = hasSnapForThisCycle;

      // Use prefetched readers map — no per-khatma DB query
      const readerData = readersByGroupId.get(groupId) || { active: [], inactive: [] };
      const activeReaders = readerData.active;
      for (const r of readerData.inactive) {
        warnings.push({ khatma_id: khatmaId, code: 'inactive_reader_excluded', reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || '' });
      }
      if (!activeReaders.length) {
        skipped.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, reason: 'no_eligible_readers' });
        continue;
      }

      // Canonical formula: computeRotationJuzServer(start_juz, parts_count, period_number)
      const nextAssignments = [];
      let skippedReaders = 0;
      for (const r of activeReaders) {
        const startJuz = Number(r.start_juz);
        const partsCount = Number(r.parts_count);
        if (!Number.isInteger(startJuz) || startJuz < 1 || startJuz > 30 || !Number.isInteger(partsCount) || partsCount < 1) {
          warnings.push({ khatma_id: khatmaId, code: 'reader_missing_juz_config', reader_profile_id: r.reader_profile_id, reader_name: r.reader_name || '' });
          skippedReaders++;
          continue;
        }
        const units = computeRotationJuzServer(startJuz, partsCount, periodBefore);
        for (let i = 0; i < units.length; i++) {
          nextAssignments.push({ reader_profile_id: r.reader_profile_id, unit_number: units[i], slot_index: i + 1 });
        }
      }

      if (!nextAssignments.length) {
        skipped.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, reason: 'no_assignments_generated', detail: { skipped_readers: skippedReaders } });
        continue;
      }

      const eligibleReaderCount = activeReaders.length - skippedReaders;
      if (isPartialRecovery) partialRecoveryTotal++;

      if (dryRun) {
        rolled.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, period_number_before: periodBefore, period_number_after: periodBefore + 1, assignments_created: nextAssignments.length, readers_count: eligibleReaderCount, target_year_month: targetYearMonth, dry_run: true, partial_recovery: isPartialRecovery });
        continue;
      }

      const t = now();
      const periodAfter = periodBefore + 1;

      // Step 1: snapshot (skip if partial recovery — snapshot already written)
      if (!isPartialRecovery) {
        const snapResult = await snapshotCurrentCycle(DB, khatmaId, periodBefore, null, check.user.id, periodBefore);
        if (!snapResult.ok) {
          failed.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, error: snapResult.error, detail: snapResult });
          continue;
        }
      }

      // Steps 2-5: rebuild assignments in small batches — avoids D1 batch statement limit
      const byReader = new Map();
      for (const a of nextAssignments) {
        if (!byReader.has(a.reader_profile_id)) byReader.set(a.reader_profile_id, []);
        byReader.get(a.reader_profile_id).push(a);
      }
      const readerById = new Map(activeReaders.map(r => [r.reader_profile_id, r]));

      const participantIdByRid = new Map();
      const participantStmts = [];
      const pStmt = DB.prepare('INSERT INTO managed_khatma_participants (id, khatma_id, participant_name, phone, access_code, reader_profile_id, notes, start_juz, parts_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [rid, asgns] of byReader) {
        const r = readerById.get(rid);
        if (!r) continue;
        const partId = newId('mpart');
        participantIdByRid.set(rid, partId);
        const sortedUnits = asgns.map(a => a.unit_number).sort((a, b) => a - b);
        participantStmts.push(pStmt.bind(partId, khatmaId, r.reader_name || '', r.phone || null, r.access_code || '', rid, null, sortedUnits[0], sortedUnits.length, t, t));
      }

      const uStmt = DB.prepare('INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)');
      const unitStmts = nextAssignments.map(a => {
        const partId = participantIdByRid.get(a.reader_profile_id) || null;
        return uStmt.bind(newId('munit'), khatmaId, a.unit_number, `الجزء ${a.unit_number}`, partId ? 'assigned' : 'available', partId, t);
      });

      const eventPayload = JSON.stringify({ algorithm, period_number_before: periodBefore, period_number_after: periodAfter, assignments_created: nextAssignments.length, readers_count: eligibleReaderCount, partial_recovery: isPartialRecovery });

      // Step 2: delete existing assignments
      await DB.batch([
        DB.prepare('DELETE FROM managed_khatma_units WHERE khatma_id = ?').bind(khatmaId),
        DB.prepare('DELETE FROM managed_khatma_participants WHERE khatma_id = ?').bind(khatmaId)
      ]);
      // Step 3: insert new participants in chunks of 25
      await batchStatementsInChunks(DB, participantStmts, 25);
      // Step 4: insert new units in chunks of 25
      await batchStatementsInChunks(DB, unitStmts, 25);
      // Step 5: update period + log event (must be last — idempotency guard)
      await DB.batch([
        DB.prepare('UPDATE managed_khatmas SET period_number = ? WHERE id = ? AND deleted_at IS NULL').bind(periodAfter, khatmaId),
        DB.prepare('INSERT INTO managed_batch_rollover_events (id, khatma_id, group_id, target_year_month, period_number_before, period_number_after, algorithm, assignments_created, readers_count, applied_by_user_id, event_payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(newId('brev'), khatmaId, groupId, targetYearMonth, periodBefore, periodAfter, algorithm, nextAssignments.length, eligibleReaderCount, check.user.id, eventPayload, t)
      ]);

      rolled.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: groupId, group_name: groupName, period_number_before: periodBefore, period_number_after: periodAfter, assignments_created: nextAssignments.length, readers_count: eligibleReaderCount, target_year_month: targetYearMonth, partial_recovery: isPartialRecovery });

    } catch (err) {
      failed.push({ khatma_id: khatmaId, khatma_name: khatmaName, group_id: khatma.group_id || '', group_name: khatma.group_name || '', error: err?.message || 'unexpected_error' });
    }
  }

  if (partialRecoveryTotal > 0) {
    warnings.push({ code: 'partial_recovery_detected', count: partialRecoveryTotal });
  }

  const completedAfterSet = dryRun
    ? completedBeforeSet
    : await loadCompletedBatchRolloverKhatmaIds(DB, targetYearMonth, allCandidateIds);
  const completedAfter = completedAfterSet.size;
  const pendingAfter = Math.max(0, totalCandidates - completedAfter);
  const hasMore = chunkMode === 'next_pending_chunk' ? pendingAfter > 0 : hasMoreBeforeApply;

  const diagnostics = {
    target_calendar: 'hijri',
    chunk_mode: chunkMode,
    chunk_limit: batchLimit,
    completed_before: completedBefore,
    completed_after: completedAfter,
    pending_after: pendingAfter,
    candidates_found: totalCandidates,
    pending_found: pendingFound,
    processed_count: processedCount,
    offset: batchOffset,
    limit: batchLimit,
    has_more: hasMore,
    next_offset: nextOffset,
    eligible_monthly_query_scope: isOwner ? 'owner_all_active_groups' : 'creator_peer_created_khatmas',
    requested_group_ids_count: requestedGroupIds ? requestedGroupIds.length : 0,
    partial_recovery_count: partialRecoveryTotal
  };
  return json({ ok: true, target_year_month: targetYearMonth, dry_run: dryRun, algorithm, summary: { rolled: rolled.length, skipped: skipped.length, failed: failed.length, warnings: warnings.length }, diagnostics, rolled, skipped, failed, warnings });
}

async function listManagedReaders(request, DB) {
  await ensureGroupSchema(DB);
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") || "";

  // Pagination and search only apply to the "all readers" query (no groupId filter)
  const paginate = !groupId;
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = paginate ? (Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1) : 1;
  const limit = paginate ? Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25)) : 9999;
  const offset = paginate ? (page - 1) * limit : 0;
  const q = (url.searchParams.get("q") || "").trim();
  const ungroupedOnly = paginate && url.searchParams.get("ungrouped") === "1";

  let rows, total;

  if (check.user.role === "owner") {
    let baseWhere, baseParams;
    if (groupId) {
      // P0: membership-inclusive, with legacy group_id kept as fallback.
      baseWhere = "WHERE mrp.status != 'deleted' AND (mrp.group_id = ? OR mrp.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = ? AND status = 'active'))";
      baseParams = [groupId, groupId];
    } else if (ungroupedOnly) {
      baseWhere = "WHERE mrp.status != 'deleted' AND mrp.group_id IS NULL";
      baseParams = [];
    } else {
      baseWhere = "WHERE mrp.status != 'deleted'";
      baseParams = [];
    }
    if (q) {
      const like = `%${q}%`;
      baseWhere += " AND (mrp.reader_name LIKE ? OR mrp.phone LIKE ? OR mrp.access_code LIKE ? OR mrp.serial_code LIKE ?)";
      baseParams.push(like, like, like, like);
    }
    if (paginate) {
      const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_reader_profiles mrp ${baseWhere}`)
        .bind(...baseParams).first();
      total = countRow?.total || 0;
    }
    const mainSql = `SELECT mrp.*, u.display_name AS owner_display_name, u.username AS owner_username, g.name AS group_name
      FROM managed_reader_profiles mrp
      LEFT JOIN users u ON u.id = mrp.created_by_user_id
      LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
      ${baseWhere}
      ORDER BY mrp.created_at DESC${paginate ? " LIMIT ? OFFSET ?" : ""}`;
    const mainParams = paginate ? [...baseParams, limit, offset] : baseParams;
    rows = (await DB.prepare(mainSql).bind(...mainParams).all()).results || [];
  } else {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const inClause = visibleIds.map(() => "?").join(",");
    const userGroupIds = await getUserGroupIds(DB, check.user.id);
    const sharedReaderClause = userGroupIds.length
      ? `OR (mrp.shared_creator_group_id IS NOT NULL AND mrp.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")}))`
      : "";
    const baseReaderParams = [...visibleIds, ...userGroupIds];

    let roleWhere, roleParams;
    if (groupId) {
      // P0: membership-inclusive, with legacy group_id kept as fallback.
      roleWhere = `WHERE mrp.status != 'deleted' AND (mrp.created_by_user_id IN (${inClause}) ${sharedReaderClause}) AND (mrp.group_id = ? OR mrp.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = ? AND status = 'active'))`;
      roleParams = [...baseReaderParams, groupId, groupId];
    } else {
      roleWhere = `WHERE mrp.status != 'deleted' AND (mrp.created_by_user_id IN (${inClause}) ${sharedReaderClause})`;
      roleParams = [...baseReaderParams];
      if (ungroupedOnly) roleWhere += " AND mrp.group_id IS NULL";
    }
    if (q) {
      const like = `%${q}%`;
      roleWhere += " AND (mrp.reader_name LIKE ? OR mrp.phone LIKE ? OR mrp.access_code LIKE ? OR mrp.serial_code LIKE ?)";
      roleParams.push(like, like, like, like);
    }
    if (paginate) {
      const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_reader_profiles mrp ${roleWhere}`)
        .bind(...roleParams).first();
      total = countRow?.total || 0;
    }
    const mainSql = `SELECT mrp.*, g.name AS group_name
      FROM managed_reader_profiles mrp
      LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
      ${roleWhere}
      ORDER BY mrp.created_at DESC${paginate ? " LIMIT ? OFFSET ?" : ""}`;
    const mainParams = paginate ? [...roleParams, limit, offset] : roleParams;
    rows = (await DB.prepare(mainSql).bind(...mainParams).all()).results || [];
  }

  const result = {
    ok: true,
    readers: rows.map(r => ({ ...mapManagedReader(r), groupName: r.group_name || "", ownerName: r.owner_display_name || r.owner_username || "" }))
  };
  if (paginate) {
    result.total = total;
    result.page = page;
    result.limit = limit;
    result.pages = Math.ceil(total / limit) || 1;
  }
  return json(result);
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

// Generates a unique numeric access code (PIN) for a reader owned by ownerId.
// `reserved` is a Set of codes already allocated in the current batch
// but not yet committed to DB.
async function generateReaderAccessCode(DB, ownerId, reserved = new Set()) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = String(Math.floor(1000000000 + Math.random() * 9000000000));
    if (reserved.has(candidate)) continue;
    const used = await DB.prepare("SELECT id FROM managed_reader_profiles WHERE created_by_user_id = ? AND access_code = ? LIMIT 1").bind(ownerId, candidate).first();
    if (!used) return candidate;
  }
  throw new Error("تعذر توليد كود قارئ فريد، حاول مجددًا");
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
  // Seed with codes provided in this batch so generated codes never collide with them
  const usedCodes = new Set(parsed.readers.map(r => r.accessCode).filter(Boolean));
  for (const reader of parsed.readers) {
    const readerGroupId = reader.groupId || groupId;
    const hasReaderId = Boolean(reader.id);
    let existing = null;
    if (hasReaderId) {
      existing = await DB.prepare("SELECT * FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(reader.id).first();
      if (!existing) return json({ ok: false, error: "معرّف قارئ في ملف التعديل غير موجود" }, 404);
      if (check.user.role !== "owner") {
        await ensureCreatorGroupSchema(DB);
        const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
        if (!visibleIds.includes(existing.created_by_user_id)) return json({ ok: false, error: "لا تملك صلاحية تعديل هذا القارئ" }, 403);
      }
      // Empty code on an update keeps the reader's current code
      if (!reader.accessCode) reader.accessCode = String(existing.access_code || "");
      const duplicate = await DB.prepare("SELECT id FROM managed_reader_profiles WHERE created_by_user_id = ? AND access_code = ? AND id != ? LIMIT 1").bind(existing.created_by_user_id, reader.accessCode, existing.id).first();
      if (duplicate) return json({ ok: false, error: "كود القارئ مستخدم لقارئ آخر. اختر كودًا مختلفًا." }, 409);
      usedCodes.add(reader.accessCode);
    } else {
      if (!reader.accessCode) {
        reader.accessCode = await generateReaderAccessCode(DB, ownerId, usedCodes);
      } else {
        const duplicate = await DB.prepare("SELECT id FROM managed_reader_profiles WHERE created_by_user_id = ? AND access_code = ? LIMIT 1").bind(ownerId, reader.accessCode).first();
        if (duplicate) return json({ ok: false, error: "كود القارئ مستخدم لقارئ موجود. استخدم تصدير التعديل لتحديثه أو غيّر الكود." }, 409);
      }
      usedCodes.add(reader.accessCode);
    }
    if (existing) {
      stmts.push(DB.prepare(`
        UPDATE managed_reader_profiles
        SET reader_name = ?, phone = ?, access_code = ?, notes = ?,
            country = COALESCE(NULLIF(?, ''), country),
            group_id = ?,
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
  const url = new URL(request.url);
  const page  = Math.max(1, parseInt(url.searchParams.get("page")  || "1",  10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const statusFilter = url.searchParams.get("status") || "";
  const archivedClause = statusFilter === "archived" ? "AND archived_at IS NOT NULL" : "AND archived_at IS NULL";

  let baseWhere = `WHERE mk.deleted_at IS NULL ${archivedClause}`;
  let params = [];

  if (check.user.role !== "owner") {
    await ensureCreatorGroupSchema(DB);
    const visibleIds = await getCreatorGroupMemberIds(DB, check.user.id);
    const userGroupIds = await getUserGroupIds(DB, check.user.id);
    const idIn = visibleIds.map(() => "?").join(",");
    if (userGroupIds.length) {
      const sharedIn = userGroupIds.map(() => "?").join(",");
      baseWhere += ` AND (mk.created_by_user_id IN (${idIn}) OR (mk.shared_creator_group_id IS NOT NULL AND mk.shared_creator_group_id IN (${sharedIn})))`;
      params = [...visibleIds, ...userGroupIds];
    } else {
      baseWhere += ` AND mk.created_by_user_id IN (${idIn})`;
      params = [...visibleIds];
    }
  }

  if (q) {
    const like = `%${q}%`;
    baseWhere += " AND (mk.title LIKE ? OR mk.week_number LIKE ?)";
    params.push(like, like);
  }

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM managed_khatmas mk ${baseWhere}`).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT mk.id, mk.title, mk.week_number, mk.khatma_type, mk.khatma_date,
            mk.hijri_date, mk.gregorian_date, mk.expires_at, mk.division, mk.selection_mode,
            mk.owner_name, mk.created_by_user_id, mk.status, mk.created_at, mk.closed_at,
            mk.archived_at, mk.shared_creator_group_id, mk.group_id, mk.rotation_start_date,
            mk.rotation_duration_years, mk.khatma_serial_number
     FROM managed_khatmas mk ${baseWhere} ORDER BY mk.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  const pages = Math.ceil(total / limit) || 1;
  if (!rows.length) return json({ ok: true, khatmas: [], total, page, limit, pages });

  // Fetch unit summary counts for this page only (max 50 khatmas at once)
  const ids = rows.map(r => r.id);
  const unitRows = (await DB.prepare(
    `SELECT khatma_id,
            COUNT(*) AS total_units,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_units,
            SUM(CASE WHEN status IN ('assigned','reading') THEN 1 ELSE 0 END) AS active_units
     FROM managed_khatma_units WHERE khatma_id IN (${ids.map(() => "?").join(",")}) GROUP BY khatma_id`
  ).bind(...ids).all()).results || [];
  const unitMap = new Map(unitRows.map(u => [u.khatma_id, u]));

  return json({
    ok: true,
    khatmas: rows.map(row => {
      const khatmaType = row.khatma_type || "monthly";
      const rotationStart = row.rotation_start_date || "";
      let expiresAt = row.expires_at || "";
      if (rotationStart && (khatmaType === 'monthly' || khatmaType === 'weekly' || khatmaType === 'yearly')) {
        const periodEnd = computeRotationPeriodEnd(rotationStart, khatmaType);
        if (periodEnd) expiresAt = periodEnd.toISOString();
      }
      const u = unitMap.get(row.id) || { total_units: 0, completed_units: 0, active_units: 0 };
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
        status: row.status || "active",
        createdAt: row.created_at || "",
        closedAt: row.closed_at || "",
        archivedAt: row.archived_at || "",
        sharedCreatorGroupId: row.shared_creator_group_id || "",
        groupId: row.group_id || "",
        rotationStartDate: rotationStart,
        rotationDurationYears: row.rotation_duration_years || 5,
        khatmaSerialNumber: row.khatma_serial_number || "",
        unitSummary: {
          total: Number(u.total_units) || 0,
          completed: Number(u.completed_units) || 0,
          active: Number(u.active_units) || 0
        }
      };
    }),
    total, page, limit, pages
  });
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

  const weekNumber = "";

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
  // Use khatmaDate as fallback so rotation_start_date is always aligned with the
  // khatma's declared start date when the form doesn't send rotationStartDate explicitly.
  const rotationStartDate = String(data.rotationStartDate || data.khatmaDate || data.rotation_start_date || "").trim() || null;
  const autoExpiresAt = rotationStartDate && (khatmaType === 'monthly' || khatmaType === 'weekly' || khatmaType === 'yearly')
    ? (computeRotationPeriodEnd(rotationStartDate, khatmaType)?.toISOString() || data.expiresAt || "")
    : (data.expiresAt || "");
  await ensureSerialSchema(DB);
  const khatmaSerial = await nextKhatmaSerial(DB);
  await DB.prepare(`
    INSERT INTO managed_khatmas (
      id, title, week_number, khatma_type, khatma_date, hijri_date, gregorian_date, expires_at,
      division, selection_mode, owner_name, created_by_user_id, coordinator_name, coordinator_whatsapp,
      dedication, quote_by, quote_text, quote_source, notes, status, created_at, closed_at, deleted_at,
      group_id, rotation_start_date, khatma_serial_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?)
  `).bind(
    id,
    data.title || "ختمة مُدارة جديدة",
    "",
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
    rotationStartDate,
    khatmaSerial
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
    const assignedParticipants = assignmentParticipantsForUnit(assignments, unitNumber, participantLookup);
    if (!assignedParticipants.length) {
      batch.push(unitStmt.bind(
        newId("munit"),
        id,
        unitNumber,
        `${parsedUnits.meta.label} ${unitNumber}`,
        "available",
        null,
        t
      ));
      continue;
    }
    for (const participant of assignedParticipants) {
      batch.push(unitStmt.bind(
        newId("munit"),
        id,
        unitNumber,
        `${parsedUnits.meta.label} ${unitNumber}`,
        "assigned",
        participant.id,
        t
      ));
    }
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

  // P0 guard: reject incomplete save payloads instead of silently wiping unit
  // assignments. A caller that omits unitAssignments/assignments entirely (e.g.
  // an admin-fields-only edit sent by hand or by an incomplete integration) must
  // not be allowed to collapse an already-assigned unit layout down to zero.
  const hasAssignmentsField = Object.prototype.hasOwnProperty.call(data, "unitAssignments") || Object.prototype.hasOwnProperty.call(data, "assignments");
  const existingAssignedCount = existingUnits.filter(u => u.participant_id).length;
  if (!hasAssignmentsField && existingAssignedCount > 0) {
    return json({ ok: false, error: "يجب إرسال تعيينات الأجزاء (unitAssignments) كاملة عند تعديل ختمة بها تعيينات قائمة، لتفادي فقدانها. أرسل نفس التعيينات الحالية إن لم ترغب بتغييرها." }, 400);
  }

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
  const existingUnitMap = new Map(
    existingUnits.map(u => [`${u.unit_number}:${u.participant_id || ""}`, u])
  );
  const existingUnitsByNumber = new Map();
  for (const unit of existingUnits) {
    if (!existingUnitsByNumber.has(unit.unit_number)) existingUnitsByNumber.set(unit.unit_number, []);
    existingUnitsByNumber.get(unit.unit_number).push(unit);
  }
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
      if (rs && (khatmaType === 'monthly' || khatmaType === 'weekly' || khatmaType === 'yearly')) {
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
    const assignedParticipants = assignmentParticipantsForUnit(assignments, unitNumber, participantLookup);
    const desiredParticipantIds = new Set(assignedParticipants.map(p => p.id));
    const existingForUnit = existingUnitsByNumber.get(unitNumber) || [];

    for (const participantId of desiredParticipantIds) {
      if (!participantIds.has(participantId)) return json({ ok: false, error: "تعيين غير صحيح لأحد الأجزاء" }, 400);
    }
    for (const existing of existingForUnit) {
      if ((existing.status === "reading" || existing.status === "completed") && !desiredParticipantIds.has(existing.participant_id || "")) {
        return json({ ok: false, error: "لا يمكن تغيير قارئ جزء قيد القراءة أو مكتمل" }, 409);
      }
    }

    let keptAvailableId = "";
    for (const existing of existingForUnit) {
      if (existing.participant_id) continue;
      if (!desiredParticipantIds.size && !keptAvailableId && existing.status === "available") {
        keptAvailableId = existing.id;
        stmts.push(DB.prepare("UPDATE managed_khatma_units SET label = ?, status = 'available', reading_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?").bind(`${parsedUnits.meta.label} ${unitNumber}`, t, existing.id));
      } else if (existing.status === "available" || existing.status === "assigned") {
        stmts.push(DB.prepare("DELETE FROM managed_khatma_units WHERE id = ?").bind(existing.id));
      }
    }

    for (const participant of assignedParticipants) {
      const existing = existingUnitMap.get(`${unitNumber}:${participant.id}`);
      if (existing) {
        const nextStatus = existing.status === "available" ? "assigned" : existing.status;
        stmts.push(DB.prepare(`
          UPDATE managed_khatma_units
          SET label = ?, status = ?, participant_id = ?, reading_at = CASE WHEN ? = 'available' THEN NULL ELSE reading_at END, completed_at = CASE WHEN ? = 'available' THEN NULL ELSE completed_at END, updated_at = ?
          WHERE id = ?
        `).bind(`${parsedUnits.meta.label} ${unitNumber}`, nextStatus, participant.id, nextStatus, nextStatus, t, existing.id));
      } else {
        stmts.push(DB.prepare(`
          INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at)
          VALUES (?, ?, ?, ?, 'assigned', ?, NULL, NULL, ?)
        `).bind(newId("munit"), id, unitNumber, `${parsedUnits.meta.label} ${unitNumber}`, participant.id, t));
      }
    }

    for (const existing of existingForUnit) {
      const existingParticipantId = existing.participant_id || "";
      if (!existingParticipantId || desiredParticipantIds.has(existingParticipantId)) continue;
      if (existing.status === "available" || existing.status === "assigned") {
        stmts.push(DB.prepare("DELETE FROM managed_khatma_units WHERE id = ?").bind(existing.id));
      }
    }

    if (!desiredParticipantIds.size && !keptAvailableId) {
      stmts.push(DB.prepare(`
        INSERT INTO managed_khatma_units (id, khatma_id, unit_number, label, status, participant_id, reading_at, completed_at, updated_at)
        VALUES (?, ?, ?, ?, 'available', NULL, NULL, NULL, ?)
      `).bind(newId("munit"), id, unitNumber, `${parsedUnits.meta.label} ${unitNumber}`, t));
    }
  }

  const deletedUnitNumbers = new Set(
    existingUnits.filter(u => !nextUnitSet.has(u.unit_number)).map(u => u.unit_number)
  );
  for (const unitNumber of deletedUnitNumbers) {
    stmts.push(DB.prepare("DELETE FROM managed_khatma_units WHERE khatma_id = ? AND unit_number = ? AND status IN ('available', 'assigned')").bind(id, unitNumber));
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

  const user = await currentUser(request, DB);
  const manager = user && (user.role === "owner" || (user.id === khatma.created_by_user_id && await hasManagedPermission(DB, user)));
  if (khatma.status === "closed" && !manager) return json({ ok: false, error: "الختمة مغلقة من قبل المنشئ" }, 409);

  if (action === "available") {
    if (!manager) return json({ ok: false, error: "إعادة الإتاحة مخصصة لصاحب الختمة" }, 403);
    const targetUnitId = String(body.unitId || body.id || "").trim();
    const targetParticipantId = String(body.participantId || body.participant_id || "").trim();
    if (!targetUnitId && !targetParticipantId) return json({ ok: false, error: "حدد القارئ المطلوب تحديثه" }, 400);
    const targetUnit = targetUnitId
      ? await DB.prepare("SELECT id FROM managed_khatma_units WHERE id = ? AND khatma_id = ? LIMIT 1").bind(targetUnitId, khatmaId).first()
      : await DB.prepare("SELECT id FROM managed_khatma_units WHERE khatma_id = ? AND unit_number = ? AND participant_id = ? LIMIT 1").bind(khatmaId, unitNumber, targetParticipantId).first();
    if (!targetUnit) return json({ ok: false, error: "الجزء غير موجود" }, 404);
    await DB.prepare("UPDATE managed_khatma_units SET status = 'available', participant_id = NULL, reading_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?")
      .bind(now(), targetUnit.id).run();
    return json({ ok: true, khatma: await getManagedKhatma(DB, khatmaId, manager) });
  }

  const targetUnitId = String(body.unitId || body.id || "").trim();
  const targetParticipantId = String(body.participantId || body.participant_id || "").trim();
  let resolvedParticipant = null;
  if (!manager) {
    const identityRaw = String(body.identity || body.phone || body.accessCode || body.code || "").trim();
    resolvedParticipant = await findManagedParticipantByIdentity(DB, khatmaId, identityRaw);
    if (!resolvedParticipant) return json({ ok: false, error: "الكود أو رقم الجوال أو الاسم غير صحيح" }, 403);
  } else if (!targetUnitId && !targetParticipantId) {
    return json({ ok: false, error: "حدد القارئ المطلوب تحديثه" }, 400);
  }

  const unit = targetUnitId
    ? await DB.prepare(`
        SELECT u.*, p.participant_name, p.phone, p.access_code
        FROM managed_khatma_units u
        LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
        WHERE u.id = ? AND u.khatma_id = ?
        LIMIT 1
      `).bind(targetUnitId, khatmaId).first()
    : manager
    ? await DB.prepare(`
        SELECT u.*, p.participant_name, p.phone, p.access_code
        FROM managed_khatma_units u
        LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
        WHERE u.khatma_id = ? AND u.unit_number = ? AND u.participant_id = ?
        LIMIT 1
      `).bind(khatmaId, unitNumber, targetParticipantId).first()
    : resolvedParticipant.reader_profile_id
    ? await DB.prepare(`
        SELECT u.*, p.participant_name, p.phone, p.access_code
        FROM managed_khatma_units u
        LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
        WHERE u.khatma_id = ? AND u.unit_number = ? AND (u.participant_id = ? OR p.reader_profile_id = ?)
        ORDER BY CASE WHEN u.participant_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).bind(khatmaId, unitNumber, resolvedParticipant.id, resolvedParticipant.reader_profile_id, resolvedParticipant.id).first()
    : await DB.prepare(`
        SELECT u.*, p.participant_name, p.phone, p.access_code
        FROM managed_khatma_units u
        LEFT JOIN managed_khatma_participants p ON p.id = u.participant_id
        WHERE u.khatma_id = ? AND u.unit_number = ? AND u.participant_id = ?
        LIMIT 1
      `).bind(khatmaId, unitNumber, resolvedParticipant.id).first();

  if (!unit) return json({ ok: false, error: "الجزء غير موجود" }, 404);
  if (!unit.participant_id) return json({ ok: false, error: "لم يتم تعيين قارئ لهذا الجزء" }, 409);

  let viewerParticipant = null;
  if (!manager) {
    // P0 patch: Arabic-digit normalization applied here only (character mapping,
    // no padding) so identityCode/identityPhone/validName keep working exactly as
    // before for already-Western-digit input.
    const identityRaw = arabicDigitsToWestern(String(body.identity || body.phone || body.accessCode || body.code || "").trim());
    const identityCode = normalizeAccessCode(identityRaw);
    const identityPhone = normalizePhone(identityRaw);
    // P0 patch: also accept a bare 1-6 digit abbreviated serial (e.g. "2080" for
    // "R-002080"), mirroring the shorthand readerPortal() already supports.
    const identitySerial = /^R-\d{1,6}$/i.test(identityRaw)
      ? identityRaw.toUpperCase()
      : /^\d{1,6}$/.test(identityRaw)
        ? "R-" + identityRaw.padStart(6, "0")
        : "";
    const validCode = identityCode && identityCode === String(unit.access_code || "");
    const validPhone = identityPhone && identityPhone.length >= 9 && identityPhone === normalizePhone(unit.phone || "");
    const validName = identityRaw && identityRaw.trim() === String(unit.participant_name || "").trim();

    if (!validCode && !validPhone && !validName) {
      // Fallback: check sibling participants sharing the same reader_profile_id.
      // Covers readers with multiple participant records in the same khatma.
      let allowedViaSiblingProfile = false;
      const unitParticipantRow = await DB.prepare(
        "SELECT reader_profile_id FROM managed_khatma_participants WHERE id = ? LIMIT 1"
      ).bind(unit.participant_id).first();
      if (unitParticipantRow?.reader_profile_id) {
        if (identitySerial) {
          const serialProfile = await DB.prepare(
            "SELECT id FROM managed_reader_profiles WHERE id = ? AND serial_code = ? AND status != 'deleted' LIMIT 1"
          ).bind(unitParticipantRow.reader_profile_id, identitySerial).first();
          allowedViaSiblingProfile = !!serialProfile;
        }
        const conditions = [];
        const params = [khatmaId, unitParticipantRow.reader_profile_id];
        if (identityCode && isValidAccessCode(identityCode)) { conditions.push("access_code = ?"); params.push(identityCode); }
        if (identityPhone && identityPhone.length >= 9) { conditions.push("phone = ?"); params.push(identityPhone); }
        if (identityRaw.length >= 2) { conditions.push("participant_name = ?"); params.push(identityRaw); }
        // P0 fix: only overwrite allowedViaSiblingProfile with the phone/code/name
        // sibling check when it hasn't already been granted via the serial-code
        // check above. Previously this unconditionally overwrote a `true` result
        // from the serial-code match with `false` whenever `conditions` was empty
        // or the sibling lookup missed, silently blocking valid serial-code logins.
        if (!allowedViaSiblingProfile && conditions.length) {
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
    await DB.prepare("UPDATE managed_khatma_units SET status = 'reading', reading_at = ?, completed_at = NULL, updated_at = ? WHERE id = ?").bind(t, t, unit.id).run();
  } else if (action === "complete") {
    if (unit.status !== "assigned" && unit.status !== "reading" && unit.status !== "completed") return json({ ok: false, error: "لا يمكن إغلاق هذا الجزء قبل تعيين قارئه" }, 409);
    await DB.prepare("UPDATE managed_khatma_units SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").bind(t, t, unit.id).run();
  } else {
    return json({ ok: false, error: "إجراء غير معروف" }, 400);
  }

  return json({ ok: true, khatma: manager ? await getManagedKhatma(DB, khatmaId, true) : await getManagedKhatmaParticipantView(DB, khatmaId, viewerParticipant) });
}

async function readerPortal(request, DB) {
  await ensureManagedSchema(DB);
  const body = await readJson(request);
  // P0 patch: Arabic-digit input normalized to Western digits here (character
  // mapping only, no padding) so the existing R-serial / bare-digit-shorthand /
  // access-code / phone / name branches below work transparently either way.
  const identityRaw = arabicDigitsToWestern(String(body.identity || "").trim());
  if (!identityRaw) return json({ ok: false, error: "أدخل الكود أو رقم الجوال أو الاسم" }, 400);
  const accessCode = normalizeAccessCode(identityRaw);
  const phone = normalizePhone(identityRaw);
  const base = `SELECT mcp.* FROM managed_khatma_participants mcp
    JOIN managed_khatmas mk ON mk.id = mcp.khatma_id AND mk.deleted_at IS NULL`;
  let participants = [];
  // Serial code lookup (R-XXXXXX) uses the reader profile to resolve all linked participations.
  if (/^R-\d{1,6}$/i.test(identityRaw.trim())) {
    const normalizedSerial = identityRaw.trim().toUpperCase();
    const profileRow = await DB.prepare(
      "SELECT id FROM managed_reader_profiles WHERE serial_code = ? AND status != 'deleted' LIMIT 1"
    ).bind(normalizedSerial).first();
    if (profileRow) {
      participants = (await DB.prepare(base + " WHERE mcp.reader_profile_id = ?").bind(profileRow.id).all()).results || [];
    }
  }
  // Pure digits (1-6): also try as abbreviated serial code (e.g., "2080" → "R-002080")
  if (!participants.length && /^\d{1,6}$/.test(identityRaw)) {
    const paddedSerial = "R-" + identityRaw.padStart(6, "0");
    const profileRow = await DB.prepare(
      "SELECT id FROM managed_reader_profiles WHERE serial_code = ? AND status != 'deleted' LIMIT 1"
    ).bind(paddedSerial).first();
    if (profileRow) {
      participants = (await DB.prepare(base + " WHERE mcp.reader_profile_id = ?").bind(profileRow.id).all()).results || [];
    }
  }
  if (!participants.length && accessCode && isValidAccessCode(accessCode)) {
    participants = (await DB.prepare(base + " WHERE mcp.access_code = ?").bind(accessCode).all()).results || [];
  }
  if (!participants.length) {
    const pVars  = phoneSearchVariants(identityRaw);
    const pLocal = normalizePhone(identityRaw);
    const pCore  = pLocal.startsWith("0") ? pLocal.slice(1) : pLocal;
    // Phase 1: exact variants match on participant phone
    if (pVars.length) {
      const inSql = pVars.map(()=>"?").join(",");
      participants = (await DB.prepare(base + ` WHERE mcp.phone IN (${inSql})`).bind(...pVars).all()).results || [];
    }
    // Phase 2: suffix match on participant phone (cross-format)
    if (!participants.length && pCore.length >= 8) {
      const cands = (await DB.prepare(
        base + " WHERE SUBSTR(REPLACE(mcp.phone,'+',''),-?) = ?"
      ).bind(pCore.length, pCore).all()).results || [];
      if (cands.length) {
        const ids = new Set(cands.map(r => r.reader_profile_id || (r.participant_name + "|" + r.phone)));
        if (ids.size > 1) return json({ ok: false, error: "يتطابق الرقم مع أكثر من قارئ، يرجى استخدام كود الدخول أو رقم السيريال" }, 409);
        participants = cands;
      }
    }
    // Phase 3: phone in managed_reader_profiles → participants via reader_profile_id
    // Mirrors serial-code path; handles cases where mcp.phone is empty/unset
    if (!participants.length) {
      let profileByPhone = null;
      if (pVars.length) {
        const inSql = pVars.map(()=>"?").join(",");
        profileByPhone = await DB.prepare(
          `SELECT id FROM managed_reader_profiles WHERE phone IN (${inSql}) AND status != 'deleted' LIMIT 1`
        ).bind(...pVars).first();
      }
      if (!profileByPhone && pCore.length >= 8) {
        const cands = (await DB.prepare(
          "SELECT id FROM managed_reader_profiles WHERE SUBSTR(REPLACE(phone,'+',''),-?) = ? AND status != 'deleted'"
        ).bind(pCore.length, pCore).all()).results || [];
        if (cands.length > 1) return json({ ok: false, error: "يتطابق الرقم مع أكثر من قارئ، يرجى استخدام كود الدخول أو رقم السيريال" }, 409);
        if (cands.length === 1) profileByPhone = cands[0];
      }
      if (profileByPhone) {
        participants = (await DB.prepare(base + " WHERE mcp.reader_profile_id = ?").bind(profileByPhone.id).all()).results || [];
      }
    }
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
      "SELECT id, serial_code, country, reader_name, phone FROM managed_reader_profiles WHERE id = ? LIMIT 1"
    ).bind(profileId).first();
    if (profileRow) readerProfile = {
      id:         profileRow.id || "",
      serialCode: profileRow.serial_code || "",
      country:    profileRow.country || "",
      name:       profileRow.reader_name || "",
      phone:      profileRow.phone || ""
    };
  }
  return json({ ok: true, identity: identityRaw, khatmas, readerProfile });
}

async function updateReaderProfile(request, DB) {
  const body = await readJson(request);
  const identityRaw = String(body.identity || "").trim();
  const phone       = String(body.phone   || "").trim();
  const country     = String(body.country || "").trim();
  if (!identityRaw) return json({ ok: false, error: "الهوية مطلوبة" }, 400);
  if (!country)     return json({ ok: false, error: "الدولة مطلوبة" }, 400);
  if (!phone)       return json({ ok: false, error: "رقم الجوال مطلوب" }, 400);
  if (!/^\+\d{8,15}$/.test(phone))
    return json({ ok: false, error: "رقم الجوال يجب أن يبدأ بـ + ويحتوي أرقاماً فقط (8-15 رقم)" }, 400);
  let profileRow = null;
  if (/^R-\d{1,6}$/i.test(identityRaw)) {
    profileRow = await DB.prepare(
      "SELECT id FROM managed_reader_profiles WHERE serial_code = ? AND status != 'deleted' LIMIT 1"
    ).bind(identityRaw.toUpperCase()).first();
  }
  if (!profileRow) {
    const ac = normalizeAccessCode(identityRaw);
    if (ac && isValidAccessCode(ac))
      profileRow = await DB.prepare(
        "SELECT id FROM managed_reader_profiles WHERE access_code = ? AND status != 'deleted' LIMIT 1"
      ).bind(ac).first();
  }
  if (!profileRow) {
    const pVars  = phoneSearchVariants(identityRaw);
    const pLocal = normalizePhone(identityRaw);
    const pCore  = pLocal.startsWith("0") ? pLocal.slice(1) : pLocal;
    if (pVars.length) {
      const inSql = pVars.map(()=>"?").join(",");
      profileRow = await DB.prepare(
        `SELECT id FROM managed_reader_profiles WHERE phone IN (${inSql}) AND status != 'deleted' LIMIT 1`
      ).bind(...pVars).first();
    }
    if (!profileRow && pCore.length >= 8) {
      const cands = (await DB.prepare(
        "SELECT id FROM managed_reader_profiles WHERE SUBSTR(REPLACE(phone,'+',''),-?) = ? AND status != 'deleted'"
      ).bind(pCore.length, pCore).all()).results || [];
      if (cands.length > 1) return json({ ok: false, error: "يتطابق الرقم مع أكثر من قارئ، يرجى استخدام كود الدخول أو رقم السيريال" }, 409);
      if (cands.length === 1) profileRow = cands[0];
    }
  }
  if (!profileRow && identityRaw.length >= 2) {
    profileRow = await DB.prepare(
      "SELECT id FROM managed_reader_profiles WHERE reader_name = ? AND status != 'deleted' LIMIT 1"
    ).bind(identityRaw).first();
  }
  if (!profileRow) return json({ ok: false, error: "لم يتم العثور على بيانات القارئ" }, 404);
  await DB.prepare(
    "UPDATE managed_reader_profiles SET phone = ?, country = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(phone, country, profileRow.id).run();
  return json({ ok: true });
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
      SELECT COALESCE(mrp.reader_name, p.participant_name) as name, COUNT(*) as cnt
      FROM managed_khatma_units u
      JOIN managed_khatmas mk ON mk.id = u.khatma_id AND mk.deleted_at IS NULL
      JOIN managed_khatma_participants p ON p.id = u.participant_id
      LEFT JOIN managed_reader_profiles mrp ON mrp.id = p.reader_profile_id
      WHERE u.status = 'completed'
        ${khatmaClause}
      GROUP BY COALESCE(mrp.reader_name, p.participant_name) ORDER BY cnt DESC LIMIT 10
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

// ── Progress Monitoring Center — read-only aggregation views over existing
// managed_* tables. No new schema. Mirrors the owner/creator scoping pattern
// already used by dashboardStats/listReaderGroups/readerGlobalSearch.
function maskManagedProgressPhone(phone) {
  const s = String(phone || "").trim();
  if (!s) return "";
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(s.length - 4) + s.slice(-2);
}

async function getManagedProgressScope(DB, user) {
  const isOwner = user.role === "owner";
  if (isOwner) {
    return { isOwner, khatmaWhere: "mk.deleted_at IS NULL", khatmaParams: [], groupWhere: "mrg.status != 'deleted'", groupParams: [] };
  }
  const memberIds = await getCreatorGroupMemberIds(DB, user.id);
  const userGroupIds = await getUserGroupIds(DB, user.id);
  let khatmaWhere, khatmaParams, groupWhere, groupParams;
  if (userGroupIds.length) {
    const sharedK = `OR (mk.shared_creator_group_id IS NOT NULL AND mk.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")}))`;
    khatmaWhere = `mk.deleted_at IS NULL AND (mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")}) ${sharedK})`;
    khatmaParams = [...memberIds, ...userGroupIds];
    const sharedG = `OR (mrg.shared_creator_group_id IS NOT NULL AND mrg.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")}))`;
    groupWhere = `mrg.status != 'deleted' AND (mrg.created_by_user_id IN (${memberIds.map(() => "?").join(",")}) ${sharedG})`;
    groupParams = [...memberIds, ...userGroupIds];
  } else {
    khatmaWhere = `mk.deleted_at IS NULL AND mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
    khatmaParams = [...memberIds];
    groupWhere = `mrg.status != 'deleted' AND mrg.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
    groupParams = [...memberIds];
  }
  return { isOwner, khatmaWhere, khatmaParams, groupWhere, groupParams };
}

async function managedProgress(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;
  await ensureManagedSchema(DB);
  await ensureGroupSchema(DB);

  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "summary").trim();
  if (!["summary", "khatmas", "groups", "readers", "assignments"].includes(view)) {
    return json({ ok: false, error: "invalid_view", message: "view يجب أن يكون: summary, khatmas, groups, readers, assignments" }, 400);
  }

  const scope = await getManagedProgressScope(DB, check.user);
  const q = (url.searchParams.get("q") || "").trim();
  const groupIdFilter = (url.searchParams.get("group_id") || "").trim();
  const khatmaIdFilter = (url.searchParams.get("khatma_id") || "").trim();
  const readerIdFilter = (url.searchParams.get("reader_id") || "").trim();
  const statusFilter = (url.searchParams.get("status") || "").trim();
  const minCompletionRaw = url.searchParams.get("min_completion");
  const maxCompletionRaw = url.searchParams.get("max_completion");
  const minCompletion = minCompletionRaw !== null && minCompletionRaw !== "" && Number.isFinite(Number(minCompletionRaw)) ? Number(minCompletionRaw) : null;
  const maxCompletion = maxCompletionRaw !== null && maxCompletionRaw !== "" && Number.isFinite(Number(maxCompletionRaw)) ? Number(maxCompletionRaw) : null;
  const dir = (url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const dirLower = dir === "ASC" ? "asc" : "desc";
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10) || 25));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
  const safeFirst = async (stmt) => { try { return (await stmt.first()) || {}; } catch { return {}; } };
  const safeAll = async (stmt) => { try { return (await stmt.all()).results || []; } catch { return []; } };
  const buildPagination = (total, count) => ({ total: Number(total || 0), limit, offset, count, has_more: offset + count < Number(total || 0) });

  if (view === "summary") {
    const khatmaRow = await safeFirst(DB.prepare(`SELECT COUNT(*) as total FROM managed_khatmas mk WHERE ${scope.khatmaWhere}`).bind(...scope.khatmaParams));
    const groupRow = await safeFirst(DB.prepare(`SELECT COUNT(*) as total FROM managed_reader_groups mrg WHERE ${scope.groupWhere}`).bind(...scope.groupParams));
    const readerRow = await safeFirst(DB.prepare(`
      SELECT COUNT(DISTINCT mrp.id) as total
      FROM managed_reader_profiles mrp
      JOIN managed_khatma_participants mkp ON mkp.reader_profile_id = mrp.id
      JOIN managed_khatmas mk ON mk.id = mkp.khatma_id
      WHERE mrp.status != 'deleted' AND ${scope.khatmaWhere}
    `).bind(...scope.khatmaParams));
    const unitRow = await safeFirst(DB.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN u.status='reading' THEN 1 ELSE 0 END) as reading,
        SUM(CASE WHEN u.status='assigned' THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN u.status='available' THEN 1 ELSE 0 END) as available
      FROM managed_khatma_units u JOIN managed_khatmas mk ON mk.id = u.khatma_id
      WHERE ${scope.khatmaWhere}
    `).bind(...scope.khatmaParams));
    // low_progress_khatmas_count threshold: completion_pct < 50 (khatmas with at least 1 unit only)
    const lowProgressRow = await safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT mk.id, COUNT(u.id) as total_units, SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed
        FROM managed_khatmas mk JOIN managed_khatma_units u ON u.khatma_id = mk.id
        WHERE ${scope.khatmaWhere}
        GROUP BY mk.id
        HAVING total_units > 0 AND (CAST(completed AS REAL) / total_units) < 0.5
      )
    `).bind(...scope.khatmaParams));
    // Reader status breakdown: completed = all assigned units done; not_started = zero completed;
    // partial = some but not all. Only readers with at least 1 assignment are counted.
    const readerStatusRow = await safeFirst(DB.prepare(`
      SELECT
        SUM(CASE WHEN completed = assigned_total THEN 1 ELSE 0 END) as completed_readers,
        SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as not_started_readers,
        SUM(CASE WHEN completed > 0 AND completed < assigned_total THEN 1 ELSE 0 END) as partial_readers
      FROM (
        SELECT mrp.id, COUNT(u.id) as assigned_total, SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed
        FROM managed_reader_profiles mrp
        JOIN managed_khatma_participants mkp ON mkp.reader_profile_id = mrp.id
        JOIN managed_khatma_units u ON u.participant_id = mkp.id
        JOIN managed_khatmas mk ON mk.id = mkp.khatma_id
        WHERE mrp.status != 'deleted' AND ${scope.khatmaWhere}
        GROUP BY mrp.id
        HAVING assigned_total > 0
      )
    `).bind(...scope.khatmaParams));

    const totalUnits = Number(unitRow.total || 0);
    const completed = Number(unitRow.completed || 0);
    return json({
      ok: true, view: "summary",
      khatmas: { total: Number(khatmaRow.total || 0) },
      groups: { total: Number(groupRow.total || 0) },
      readers: { total: Number(readerRow.total || 0) },
      assignments: {
        total: totalUnits, completed, pending: totalUnits - completed,
        reading: Number(unitRow.reading || 0), assigned: Number(unitRow.assigned || 0), available: Number(unitRow.available || 0),
        completionPct: totalUnits ? Math.round((completed / totalUnits) * 100) : 0
      },
      low_progress_khatmas_count: Number(lowProgressRow.total || 0),
      completed_readers_count: Number(readerStatusRow.completed_readers || 0),
      not_started_readers_count: Number(readerStatusRow.not_started_readers || 0),
      partial_readers_count: Number(readerStatusRow.partial_readers || 0)
    });
  }

  if (view === "khatmas") {
    let where = scope.khatmaWhere;
    const params = [...scope.khatmaParams];
    if (khatmaIdFilter) { where += " AND mk.id = ?"; params.push(khatmaIdFilter); }
    if (groupIdFilter) { where += " AND mk.group_id = ?"; params.push(groupIdFilter); }
    if (q) { where += " AND (mk.title LIKE ? OR mk.khatma_serial_number LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    const havingParams = [];
    const havingParts = [];
    if (minCompletion !== null) { havingParts.push("completion_pct >= ?"); havingParams.push(minCompletion); }
    if (maxCompletion !== null) { havingParts.push("completion_pct <= ?"); havingParams.push(maxCompletion); }
    const havingClause = havingParts.length ? `HAVING ${havingParts.join(" AND ")}` : "";
    const sortMap = { completion_pct: "completion_pct", pending_count: "pending", completed_count: "completed", khatma_serial: "mk.khatma_serial_number", group_serial: "mrg.group_serial_number", title: "mk.title", total_units: "total_units" };
    const sortKeyReq = url.searchParams.get("sort");
    const sortCol = sortMap[sortKeyReq] || "mk.created_at";
    const sortKeyUsed = sortMap[sortKeyReq] ? sortKeyReq : "created_at";

    const countRow = await safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT mk.id,
          CASE WHEN COUNT(u.id)=0 THEN 0 ELSE ROUND(100.0*SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)/COUNT(u.id)) END as completion_pct
        FROM managed_khatmas mk
        LEFT JOIN managed_khatma_units u ON u.khatma_id = mk.id
        LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
        WHERE ${where}
        GROUP BY mk.id
        ${havingClause}
      )
    `).bind(...params, ...havingParams));

    const rows = await safeAll(DB.prepare(`
      SELECT mk.id, mk.title, mk.khatma_serial_number, mk.period_number, mk.status,
        mrg.id as group_id, mrg.name as group_name, mrg.group_serial_number,
        COUNT(u.id) as total_units,
        SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed,
        (COUNT(u.id) - SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)) as pending,
        COUNT(DISTINCT u.participant_id) as readers_count,
        CASE WHEN COUNT(u.id)=0 THEN 0 ELSE ROUND(100.0*SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)/COUNT(u.id)) END as completion_pct
      FROM managed_khatmas mk
      LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
      LEFT JOIN managed_khatma_units u ON u.khatma_id = mk.id
      WHERE ${where}
      GROUP BY mk.id
      ${havingClause}
      ORDER BY ${sortCol} ${dir}
      LIMIT ? OFFSET ?
    `).bind(...params, ...havingParams, limit, offset));

    return json({
      ok: true, view: "khatmas",
      items: rows.map(r => ({
        id: r.id, title: r.title || "", khatmaSerialNumber: r.khatma_serial_number || "", periodNumber: Number(r.period_number) || 1, status: r.status || "",
        groupId: r.group_id || "", groupName: r.group_name || "", groupSerialNumber: r.group_serial_number || "",
        totalUnits: Number(r.total_units) || 0, completed: Number(r.completed) || 0, pending: Number(r.pending) || 0,
        readersCount: Number(r.readers_count) || 0, completionPct: Number(r.completion_pct) || 0
      })),
      pagination: buildPagination(countRow.total, rows.length),
      sort: { key: sortKeyUsed, dir: dirLower },
      filters: { q, group_id: groupIdFilter, khatma_id: khatmaIdFilter, min_completion: minCompletion, max_completion: maxCompletion }
    });
  }

  if (view === "groups") {
    let where = scope.groupWhere;
    const params = [...scope.groupParams];
    if (groupIdFilter) { where += " AND mrg.id = ?"; params.push(groupIdFilter); }
    if (q) { where += " AND (mrg.name LIKE ? OR mrg.group_serial_number LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    const havingParams = [];
    const havingParts = [];
    if (minCompletion !== null) { havingParts.push("completion_pct >= ?"); havingParams.push(minCompletion); }
    if (maxCompletion !== null) { havingParts.push("completion_pct <= ?"); havingParams.push(maxCompletion); }
    const havingClause = havingParts.length ? `HAVING ${havingParts.join(" AND ")}` : "";
    const sortMap = { completion_pct: "completion_pct", pending_count: "pending", completed_count: "completed", group_serial: "mrg.group_serial_number", name: "mrg.name", total_units: "total_units" };
    const sortKeyReq = url.searchParams.get("sort");
    const sortCol = sortMap[sortKeyReq] || "mrg.created_at";
    const sortKeyUsed = sortMap[sortKeyReq] ? sortKeyReq : "created_at";

    const countRow = await safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT mrg.id,
          CASE WHEN COUNT(u.id)=0 THEN 0 ELSE ROUND(100.0*SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)/COUNT(u.id)) END as completion_pct
        FROM managed_reader_groups mrg
        LEFT JOIN managed_khatmas mk ON mk.group_id = mrg.id AND mk.deleted_at IS NULL
        LEFT JOIN managed_khatma_units u ON u.khatma_id = mk.id
        WHERE ${where}
        GROUP BY mrg.id
        ${havingClause}
      )
    `).bind(...params, ...havingParams));

    const rows = await safeAll(DB.prepare(`
      SELECT mrg.id, mrg.name, mrg.group_serial_number,
        COUNT(DISTINCT mk.id) as khatmas_count,
        COUNT(u.id) as total_units,
        SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed,
        (COUNT(u.id) - SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)) as pending,
        CASE WHEN COUNT(u.id)=0 THEN 0 ELSE ROUND(100.0*SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)/COUNT(u.id)) END as completion_pct,
        (SELECT COUNT(DISTINCT rid) FROM (
           SELECT reader_profile_id as rid FROM managed_reader_group_memberships WHERE group_id = mrg.id AND status='active'
           UNION
           SELECT id as rid FROM managed_reader_profiles WHERE group_id = mrg.id AND status != 'deleted'
         )) as readers_count
      FROM managed_reader_groups mrg
      LEFT JOIN managed_khatmas mk ON mk.group_id = mrg.id AND mk.deleted_at IS NULL
      LEFT JOIN managed_khatma_units u ON u.khatma_id = mk.id
      WHERE ${where}
      GROUP BY mrg.id
      ${havingClause}
      ORDER BY ${sortCol} ${dir}
      LIMIT ? OFFSET ?
    `).bind(...params, ...havingParams, limit, offset));

    return json({
      ok: true, view: "groups",
      items: rows.map(r => ({
        id: r.id, name: r.name || "", groupSerialNumber: r.group_serial_number || "",
        khatmasCount: Number(r.khatmas_count) || 0, readersCount: Number(r.readers_count) || 0,
        totalUnits: Number(r.total_units) || 0, completed: Number(r.completed) || 0, pending: Number(r.pending) || 0,
        completionPct: Number(r.completion_pct) || 0
      })),
      pagination: buildPagination(countRow.total, rows.length),
      sort: { key: sortKeyUsed, dir: dirLower },
      filters: { q, group_id: groupIdFilter, min_completion: minCompletion, max_completion: maxCompletion }
    });
  }

  if (view === "readers") {
    let where = "mrp.status != 'deleted'";
    const params = [];
    if (scope.isOwner) {
      // owner: no extra restriction beyond deleted check
    } else {
      where += ` AND ${scope.khatmaWhere}`;
      params.push(...scope.khatmaParams);
    }
    if (readerIdFilter) { where += " AND mrp.id = ?"; params.push(readerIdFilter); }
    if (khatmaIdFilter) { where += " AND mk.id = ?"; params.push(khatmaIdFilter); }
    if (groupIdFilter) {
      where += ` AND (mrp.group_id = ? OR EXISTS (SELECT 1 FROM managed_reader_group_memberships rgm3 WHERE rgm3.reader_profile_id = mrp.id AND rgm3.group_id = ? AND rgm3.status = 'active'))`;
      params.push(groupIdFilter, groupIdFilter);
    }
    if (q) { where += " AND (mrp.reader_name LIKE ? OR mrp.serial_code LIKE ? OR mrp.phone LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const havingParts = [];
    if (statusFilter === "completed") havingParts.push("pending = 0 AND assigned_total > 0");
    else if (statusFilter === "partial") havingParts.push("completed_count > 0 AND pending > 0");
    else if (statusFilter === "has_progress") havingParts.push("completed_count > 0");
    else if (statusFilter === "not_started") havingParts.push("completed_count = 0");
    const havingClause = havingParts.length ? `HAVING ${havingParts.join(" AND ")}` : "";
    const sortMap = { completion_pct: "completion_pct", pending_count: "pending", completed_count: "completed_count", reader_name: "mrp.reader_name", assigned_total: "assigned_total" };
    const sortKeyReq = url.searchParams.get("sort");
    const sortCol = sortMap[sortKeyReq] || "mrp.reader_name";
    const sortKeyUsed = sortMap[sortKeyReq] ? sortKeyReq : "reader_name";

    const countRow = await safeFirst(DB.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT mrp.id, COUNT(u.id) as assigned_total,
          SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed_count,
          (COUNT(u.id) - SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)) as pending
        FROM managed_reader_profiles mrp
        JOIN managed_khatma_participants mkp ON mkp.reader_profile_id = mrp.id
        JOIN managed_khatma_units u ON u.participant_id = mkp.id
        JOIN managed_khatmas mk ON mk.id = mkp.khatma_id
        WHERE ${where}
        GROUP BY mrp.id
        ${havingClause}
      )
    `).bind(...params));

    const rows = await safeAll(DB.prepare(`
      SELECT mrp.id, mrp.reader_name, mrp.phone, mrp.serial_code,
        COUNT(u.id) as assigned_total,
        SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END) as completed_count,
        (COUNT(u.id) - SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)) as pending,
        MAX(u.completed_at) as last_completed_at,
        CASE WHEN COUNT(u.id)=0 THEN 0 ELSE ROUND(100.0*SUM(CASE WHEN u.status='completed' THEN 1 ELSE 0 END)/COUNT(u.id)) END as completion_pct
      FROM managed_reader_profiles mrp
      JOIN managed_khatma_participants mkp ON mkp.reader_profile_id = mrp.id
      JOIN managed_khatma_units u ON u.participant_id = mkp.id
      JOIN managed_khatmas mk ON mk.id = mkp.khatma_id
      WHERE ${where}
      GROUP BY mrp.id
      ${havingClause}
      ORDER BY ${sortCol} ${dir}
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset));

    const statusLabels = { completed: "مكتمل", partial: "جزئي", not_started: "لم ينجز", no_assignments: "لا تكليفات" };
    return json({
      ok: true, view: "readers",
      items: rows.map(r => {
        const assigned = Number(r.assigned_total) || 0;
        const completedCnt = Number(r.completed_count) || 0;
        const status = assigned === 0 ? "no_assignments" : completedCnt === 0 ? "not_started" : completedCnt === assigned ? "completed" : "partial";
        return {
          id: r.id, readerName: r.reader_name || "", phone: r.phone || "", serialCode: r.serial_code || "",
          assignedTotal: assigned, completed: completedCnt, pending: Number(r.pending) || 0,
          completionPct: Number(r.completion_pct) || 0, lastCompletedAt: r.last_completed_at || null,
          status, statusLabel: statusLabels[status]
        };
      }),
      pagination: buildPagination(countRow.total, rows.length),
      sort: { key: sortKeyUsed, dir: dirLower },
      filters: { q, group_id: groupIdFilter, khatma_id: khatmaIdFilter, reader_id: readerIdFilter, status: statusFilter || null }
    });
  }

  // view === "assignments"
  let where = scope.khatmaWhere;
  const params = [...scope.khatmaParams];
  if (khatmaIdFilter) { where += " AND mk.id = ?"; params.push(khatmaIdFilter); }
  if (groupIdFilter) { where += " AND mk.group_id = ?"; params.push(groupIdFilter); }
  if (readerIdFilter) { where += " AND mrp.id = ?"; params.push(readerIdFilter); }
  if (statusFilter === "unread") { where += " AND u.status != 'completed'"; }
  else if (statusFilter) { where += " AND u.status = ?"; params.push(statusFilter); }
  if (q) { where += " AND (mk.title LIKE ? OR mrp.reader_name LIKE ? OR u.label LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sortMap = { khatma_serial: "mk.khatma_serial_number", group_serial: "mrg.group_serial_number", reader_name: "mrp.reader_name", completed_at: "u.completed_at", status: "u.status" };
  const sortKeyReq = url.searchParams.get("sort");
  const sortCol = sortMap[sortKeyReq] || "mk.khatma_serial_number";
  const sortKeyUsed = sortMap[sortKeyReq] ? sortKeyReq : "khatma_serial";

  const countRow = await safeFirst(DB.prepare(`
    SELECT COUNT(*) as total
    FROM managed_khatma_units u
    JOIN managed_khatmas mk ON mk.id = u.khatma_id
    LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
    LEFT JOIN managed_khatma_participants mkp ON mkp.id = u.participant_id
    LEFT JOIN managed_reader_profiles mrp ON mrp.id = mkp.reader_profile_id
    WHERE ${where}
  `).bind(...params));

  const rows = await safeAll(DB.prepare(`
    SELECT u.unit_number, u.label, u.status, u.completed_at, u.reading_at,
      mk.id as khatma_id, mk.title as khatma_title, mk.khatma_serial_number, mk.period_number,
      mrg.id as group_id, mrg.name as group_name, mrg.group_serial_number,
      mrp.id as reader_id, mrp.reader_name, mrp.phone
    FROM managed_khatma_units u
    JOIN managed_khatmas mk ON mk.id = u.khatma_id
    LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id
    LEFT JOIN managed_khatma_participants mkp ON mkp.id = u.participant_id
    LEFT JOIN managed_reader_profiles mrp ON mrp.id = mkp.reader_profile_id
    WHERE ${where}
    ORDER BY ${sortCol} ${dir}, u.unit_number ASC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset));

  return json({
    ok: true, view: "assignments",
    items: rows.map(r => ({
      unitNumber: Number(r.unit_number), label: r.label || "", status: r.status || "", completedAt: r.completed_at || null, readingAt: r.reading_at || null,
      khatmaId: r.khatma_id, khatmaTitle: r.khatma_title || "", khatmaSerialNumber: r.khatma_serial_number || "", periodNumber: Number(r.period_number) || 1,
      groupId: r.group_id || "", groupName: r.group_name || "", groupSerialNumber: r.group_serial_number || "",
      readerId: r.reader_id || "", readerName: r.reader_name || "", readerPhone: r.phone || ""
    })),
    pagination: buildPagination(countRow.total, rows.length),
    sort: { key: sortKeyUsed, dir: dirLower },
    filters: { q, group_id: groupIdFilter, khatma_id: khatmaIdFilter, reader_id: readerIdFilter, status: statusFilter || null }
  });
}

async function readerGlobalSearch(request, DB) {
  const check = await requireManagedCreator(request, DB);
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const q    = (url.searchParams.get("q")    || "").trim();
  const type = (url.searchParams.get("type") || "").trim(); // reader | group | khatma | "" (all)
  if (!q || q.length < 2) return json({ ok: true, readers: [], participants: [], groups: [], khatmas: [] });

  await ensureManagedSchema(DB);

  const isOwner = check.user.role === "owner";
  const memberIds = isOwner ? [] : await getCreatorGroupMemberIds(DB, check.user.id);
  await ensureCreatorGroupSchema(DB);
  const userGroupIds = isOwner ? [] : await getUserGroupIds(DB, check.user.id);

  const like = `%${q}%`;
  const kp   = isOwner ? [] : memberIds;

  const rClause = isOwner ? "" : `AND mrp.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;

  let khatmaWhereExtra;
  let khatmaParams;
  if (isOwner) {
    khatmaWhereExtra = "";
    khatmaParams = [];
  } else if (userGroupIds.length) {
    khatmaWhereExtra = `AND (mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")}) OR (mk.shared_creator_group_id IS NOT NULL AND mk.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")})))`;
    khatmaParams = [...memberIds, ...userGroupIds];
  } else {
    khatmaWhereExtra = `AND mk.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
    khatmaParams = [...memberIds];
  }

  let grpWhereExtra;
  let grpParams;
  if (isOwner) {
    grpWhereExtra = "";
    grpParams = [];
  } else if (userGroupIds.length) {
    grpWhereExtra = `AND (g.created_by_user_id IN (${memberIds.map(() => "?").join(",")}) OR (g.shared_creator_group_id IS NOT NULL AND g.shared_creator_group_id IN (${userGroupIds.map(() => "?").join(",")})))`;
    grpParams = [...memberIds, ...userGroupIds];
  } else {
    grpWhereExtra = `AND g.created_by_user_id IN (${memberIds.map(() => "?").join(",")})`;
    grpParams = [...memberIds];
  }

  const safeAll = async (stmt) => { try { return (await stmt.all()).results || []; } catch { return []; } };

  const wantReader  = !type || type === "reader";
  const wantGroup   = !type || type === "group";
  const wantKhatma  = !type || type === "khatma";

  const [readerRows, groupRows, khatmaRows] = await Promise.all([
    wantReader ? safeAll(DB.prepare(`
      SELECT mrp.id, mrp.reader_name AS name, mrp.phone, mrp.access_code, mrp.serial_code,
             mrp.start_juz, mrp.parts_count, mrp.notes,
             mrg.name AS group_name, mrg.id AS group_id, mrg.group_serial_number AS group_serial
      FROM managed_reader_profiles mrp
      LEFT JOIN managed_reader_groups mrg ON mrg.id = mrp.group_id AND mrg.status != 'deleted'
      WHERE mrp.status != 'deleted'
        AND (mrp.reader_name LIKE ? OR mrp.phone LIKE ? OR mrp.access_code LIKE ? OR mrp.serial_code LIKE ?)
        ${rClause}
      LIMIT 20
    `).bind(like, like, like, like, ...kp)) : Promise.resolve([]),

    wantGroup ? safeAll(DB.prepare(`
      SELECT g.id, g.name, g.group_serial_number,
             COUNT(p.id) AS readers_count
      FROM managed_reader_groups g
      LEFT JOIN managed_reader_profiles p ON p.group_id = g.id AND p.status != 'deleted'
      WHERE g.status != 'deleted'
        AND (g.name LIKE ? OR g.id LIKE ? OR g.group_serial_number LIKE ?)
        ${grpWhereExtra}
      GROUP BY g.id
      LIMIT 20
    `).bind(like, like, like, ...grpParams)) : Promise.resolve([]),

    wantKhatma ? safeAll(DB.prepare(`
      SELECT mk.id, mk.title, mk.status, mk.khatma_type, mk.khatma_serial_number,
             mk.week_number, mk.khatma_date,
             mrg.name AS group_name, mrg.id AS group_id
      FROM managed_khatmas mk
      LEFT JOIN managed_reader_groups mrg ON mrg.id = mk.group_id AND mrg.status != 'deleted'
      WHERE mk.deleted_at IS NULL
        AND (mk.title LIKE ? OR mk.week_number LIKE ? OR mk.khatma_serial_number LIKE ?)
        ${khatmaWhereExtra}
      ORDER BY mk.created_at DESC
      LIMIT 20
    `).bind(like, like, like, ...khatmaParams)) : Promise.resolve([]),
  ]);

  return json({
    ok: true,
    query: q,
    type: type || "all",
    readers: readerRows.map(r => ({
      type: "reader", id: r.id, name: r.name || "",
      phone: r.phone || "", accessCode: r.access_code || "",
      serialCode: r.serial_code || "",
      startJuz: r.start_juz || "", partsCount: r.parts_count || "",
      notes: r.notes || "", groupName: r.group_name || "", groupId: r.group_id || "",
      groupSerial: r.group_serial || "",
    })),
    groups: groupRows.map(g => ({
      type: "group", id: g.id, name: g.name || "",
      serialNumber: g.group_serial_number || "",
      readersCount: Number(g.readers_count) || 0,
    })),
    khatmas: khatmaRows.map(k => ({
      type: "khatma", id: k.id, name: k.title || "",
      serialNumber: k.khatma_serial_number || "",
      status: k.status || "", khatmaType: k.khatma_type || "",
      weekNumber: k.week_number || "", khatmaDate: k.khatma_date || "",
      groupName: k.group_name || "", groupId: k.group_id || "",
    })),
    participants: [],
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
  if (!rows.length) {
    const pVars  = phoneSearchVariants(identityRaw);
    const pLocal = normalizePhone(identityRaw);
    const pCore  = pLocal.startsWith("0") ? pLocal.slice(1) : pLocal;
    if (pVars.length) {
      const inSql = pVars.map(()=>"?").join(",");
      rows = (await DB.prepare(base + ` WHERE mcp.phone IN (${inSql})`).bind(...pVars).all()).results || [];
    }
    if (!rows.length && pCore.length >= 8) {
      const cands = (await DB.prepare(
        base + " WHERE SUBSTR(REPLACE(mcp.phone,'+',''),-?) = ?"
      ).bind(pCore.length, pCore).all()).results || [];
      if (cands.length) {
        const ids = new Set(cands.map(r => r.reader_profile_id || (r.participant_name + "|" + r.phone)));
        if (ids.size > 1) return json({ ok: false, error: "يتطابق الرقم مع أكثر من قارئ، يرجى استخدام كود الدخول أو رقم السيريال" }, 409);
        rows = cands;
      }
    }
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

// ── Owner Control Center ──────────────────────────────────────

async function ownerOverview(request, DB) {
  const [usersR, creatorsR, groupsR, readersR, membershipsR, vacanciesR, missingPhoneR, missingCountryR, khatmasR, activeKhatmasR] = await DB.batch([
    DB.prepare("SELECT COUNT(*) AS c FROM users WHERE status != 'deleted'"),
    DB.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'creator' AND status != 'deleted'"),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_groups WHERE status != 'deleted'"),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_profiles WHERE status != 'deleted'"),
    // P0: requires migration 027_reader_group_memberships.sql to have been applied first.
    DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_group_memberships WHERE status = 'active'"),
    DB.prepare(`SELECT COUNT(*) AS c FROM managed_khatma_units u
      JOIN managed_khatmas mk ON mk.id = u.khatma_id
      WHERE u.participant_id IS NULL AND mk.deleted_at IS NULL AND mk.archived_at IS NULL`),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_profiles WHERE status != 'deleted' AND (phone IS NULL OR TRIM(phone) = '')"),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_reader_profiles WHERE status != 'deleted' AND (country IS NULL OR TRIM(country) = '')"),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_khatmas WHERE deleted_at IS NULL"),
    DB.prepare("SELECT COUNT(*) AS c FROM managed_khatmas WHERE deleted_at IS NULL AND archived_at IS NULL")
  ]);
  return json({ ok: true, stats: {
    users: usersR.results?.[0]?.c || 0,
    creators: creatorsR.results?.[0]?.c || 0,
    groups: groupsR.results?.[0]?.c || 0,
    readerGroupMemberships: membershipsR.results?.[0]?.c || 0,
    readers: readersR.results?.[0]?.c || 0,
    vacancies: vacanciesR.results?.[0]?.c || 0,
    missingPhone: missingPhoneR.results?.[0]?.c || 0,
    missingCountry: missingCountryR.results?.[0]?.c || 0,
    khatmas: khatmasR.results?.[0]?.c || 0,
    activeKhatmas: activeKhatmasR.results?.[0]?.c || 0
  }});
}

async function ownerListReaders(request, DB) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const groupId = url.searchParams.get("groupId") || "";
  const ownerId = url.searchParams.get("ownerId") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const country = url.searchParams.get("country") || "";
  const missingContact = url.searchParams.get("missingContact") || "";

  let where = "WHERE 1=1";
  const params = [];
  if (groupId) { where += " AND (mrp.group_id = ? OR mrp.id IN (SELECT reader_profile_id FROM managed_reader_group_memberships WHERE group_id = ? AND status = 'active'))"; params.push(groupId, groupId); }
  if (ownerId) { where += " AND mrp.created_by_user_id = ?"; params.push(ownerId); }
  if (statusFilter) { where += " AND mrp.status = ?"; params.push(statusFilter); }
  else { where += " AND mrp.status != 'deleted'"; }
  if (country) { where += " AND mrp.country = ?"; params.push(country); }
  if (missingContact === "phone") { where += " AND (mrp.phone IS NULL OR TRIM(mrp.phone) = '')"; }
  else if (missingContact === "country") { where += " AND (mrp.country IS NULL OR TRIM(mrp.country) = '')"; }
  else if (missingContact === "any") { where += " AND (mrp.phone IS NULL OR TRIM(mrp.phone) = '' OR mrp.country IS NULL OR TRIM(mrp.country) = '')"; }
  if (q) {
    const like = `%${q}%`;
    where += " AND (mrp.reader_name LIKE ? OR mrp.phone LIKE ? OR mrp.access_code LIKE ? OR mrp.serial_code LIKE ? OR mrp.country LIKE ? OR g.name LIKE ? OR u.username LIKE ?)";
    params.push(like, like, like, like, like, like, like);
  }

  const joinClause = `FROM managed_reader_profiles mrp
    LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
    LEFT JOIN users u ON u.id = mrp.created_by_user_id`;

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total ${joinClause} ${where}`).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT mrp.*, g.name AS group_name, u.username AS owner_username, u.display_name AS owner_display_name
     ${joinClause} ${where} ORDER BY mrp.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  return json({
    ok: true,
    readers: rows.map(r => ({ ...mapManagedReader(r), groupName: r.group_name || "", ownerUsername: r.owner_username || "", ownerName: r.owner_display_name || r.owner_username || "" })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerEditReader(request, DB, id) {
  const data = await readJson(request);
  const allowedCols = { reader_name: true, phone: true, country: true, access_code: true, serial_code: true, status: true, group_id: true, notes: true };
  const updates = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedCols[k]) updates[k] = v == null ? "" : String(v).trim();
  }
  if (!Object.keys(updates).length) return json({ ok: false, error: "لا توجد حقول للتعديل" }, 400);
  if ("phone" in updates && updates.phone && !/^\+\d{7,15}$/.test(updates.phone)) {
    return json({ ok: false, error: "رقم الجوال يجب أن يكون بصيغة دولية +XXXXXXXXX" }, 400);
  }
  if ("access_code" in updates && !/^\d{4,10}$/.test(updates.access_code || "")) {
    return json({ ok: false, error: "الكود يجب أن يكون أرقاماً من 4 إلى 10 خانات" }, 400);
  }
  if ("group_id" in updates && updates.group_id) {
    const grp = await DB.prepare("SELECT id FROM managed_reader_groups WHERE id = ? AND status != 'deleted' LIMIT 1").bind(updates.group_id).first();
    if (!grp) return json({ ok: false, error: "المجموعة غير موجودة" }, 400);
  }
  const existing = await DB.prepare("SELECT id FROM managed_reader_profiles WHERE id = ? LIMIT 1").bind(id).first();
  if (!existing) return json({ ok: false, error: "القارئ غير موجود" }, 404);
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(", ");
  await DB.prepare(`UPDATE managed_reader_profiles SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...Object.values(updates), id).run();
  return json({ ok: true });
}

async function ownerListGroups(request, DB) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const ownerId = url.searchParams.get("ownerId") || "";
  const statusFilter = url.searchParams.get("status") || "";

  let where = "WHERE 1=1";
  const params = [];
  if (ownerId) { where += " AND g.created_by_user_id = ?"; params.push(ownerId); }
  if (statusFilter) { where += " AND g.status = ?"; params.push(statusFilter); }
  else { where += " AND g.status != 'deleted'"; }
  // Smart numeric search: pure number → match id suffix too, rank exact match first
  const isNumericQ = q !== "" && /^\d+$/.test(q);
  const pad3 = isNumericQ ? q.padStart(3, "0") : "";

  if (q) {
    const like = `%${q}%`;
    if (isNumericQ) {
      where += " AND (g.name LIKE ? OR g.id LIKE ?)";
      params.push(like, `%_${pad3}`);
    } else {
      where += " AND (g.name LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)";
      params.push(like, like, like);
    }
  }

  const orderBy = isNumericQ
    ? `ORDER BY CASE WHEN g.id LIKE ? THEN 0 ELSE 1 END ASC, CASE WHEN g.name LIKE ? THEN 0 ELSE 1 END ASC, g.id ASC`
    : `ORDER BY g.created_at DESC`;
  const orderParams = isNumericQ ? [`%_${pad3}`, `% ${q}`] : [];

  const countRow = await DB.prepare(
    `SELECT COUNT(*) AS total FROM managed_reader_groups g LEFT JOIN users u ON u.id = g.created_by_user_id ${where}`
  ).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT g.*, COUNT(p.id) AS readers_count, u.username AS owner_username, u.display_name AS owner_display_name
     FROM managed_reader_groups g
     LEFT JOIN managed_reader_profiles p ON p.group_id = g.id AND p.status != 'deleted'
     LEFT JOIN users u ON u.id = g.created_by_user_id
     ${where} GROUP BY g.id ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...params, ...orderParams, limit, offset).all()).results || [];

  return json({
    ok: true,
    groups: rows.map(r => ({ id: r.id, name: r.name || "", notes: r.notes || "", rotationType: r.rotation_type || "", rotationStartDate: r.rotation_start_date || "", status: r.status || "", createdAt: r.created_at || "", readerCount: Number(r.readers_count) || 0, ownerUsername: r.owner_username || "", ownerName: r.owner_display_name || r.owner_username || "" })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerReportMissingContact(request, DB) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q       = (url.searchParams.get("q")       || "").trim();
  const missing = (url.searchParams.get("missing")  || "any");

  let where = "WHERE mrp.status != 'deleted'";
  const params = [];

  if (missing === "phone")   { where += " AND (mrp.phone IS NULL OR TRIM(mrp.phone) = '')"; }
  else if (missing === "country") { where += " AND (mrp.country IS NULL OR TRIM(mrp.country) = '')"; }
  else { where += " AND (mrp.phone IS NULL OR TRIM(mrp.phone) = '' OR mrp.country IS NULL OR TRIM(mrp.country) = '')"; }

  if (q) {
    const like = `%${q}%`;
    where += " AND (mrp.reader_name LIKE ? OR mrp.serial_code LIKE ? OR g.name LIKE ?)";
    params.push(like, like, like);
  }

  const join = `FROM managed_reader_profiles mrp
    LEFT JOIN managed_reader_groups g ON g.id = mrp.group_id
    LEFT JOIN users u ON u.id = mrp.created_by_user_id`;

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total ${join} ${where}`)
    .bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT mrp.serial_code, mrp.reader_name, mrp.phone, mrp.country, mrp.status,
       g.name AS group_name, u.display_name AS owner_name
     ${join} ${where} ORDER BY g.id ASC, mrp.serial_code ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  return json({
    ok: true,
    rows: rows.map(r => ({
      serial_code: r.serial_code || '',
      reader_name: r.reader_name || '',
      phone:       r.phone       || '',
      country:     r.country     || '',
      group_name:  r.group_name  || '',
      owner_name:  r.owner_name  || '',
      status:      r.status      || ''
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerReportGroups(request, DB) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();

  let where = "WHERE g.status != 'deleted'";
  const params = [];

  if (q) {
    const like = `%${q}%`;
    where += " AND (g.name LIKE ? OR u.display_name LIKE ?)";
    params.push(like, like);
  }

  const countRow = await DB.prepare(
    `SELECT COUNT(*) AS total FROM managed_reader_groups g LEFT JOIN users u ON u.id = g.created_by_user_id ${where}`
  ).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT g.name AS group_name, g.status,
       u.display_name AS owner_name,
       COUNT(p.id) AS reader_count,
       COUNT(CASE WHEN p.reader_name = 'شاغر' THEN 1 END) AS vacancies_count,
       COUNT(CASE WHEN p.phone IS NULL OR TRIM(p.phone) = '' THEN 1 END) AS missing_phone_count,
       COUNT(CASE WHEN p.country IS NULL OR TRIM(p.country) = '' THEN 1 END) AS missing_country_count
     FROM managed_reader_groups g
     LEFT JOIN users u ON u.id = g.created_by_user_id
     LEFT JOIN managed_reader_profiles p ON p.group_id = g.id AND p.status != 'deleted'
     ${where} GROUP BY g.id ORDER BY g.id ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  return json({
    ok: true,
    rows: rows.map(r => ({
      group_name:          r.group_name          || '',
      owner_name:          r.owner_name          || '',
      readerCount:         Number(r.reader_count)         || 0,
      vacanciesCount:      Number(r.vacancies_count)      || 0,
      missingPhoneCount:   Number(r.missing_phone_count)  || 0,
      missingCountryCount: Number(r.missing_country_count)|| 0,
      status:              r.status              || ''
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerListKhatmas(request, DB) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const ownerId = url.searchParams.get("ownerId") || "";
  const statusFilter = url.searchParams.get("status") || "";

  let where = "WHERE mk.deleted_at IS NULL";
  const params = [];
  if (ownerId) { where += " AND mk.created_by_user_id = ?"; params.push(ownerId); }
  if (statusFilter === "archived") { where += " AND mk.archived_at IS NOT NULL"; }
  else if (statusFilter === "active") { where += " AND mk.archived_at IS NULL"; }
  if (q) {
    const like = `%${q}%`;
    where += " AND (mk.title LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)";
    params.push(like, like, like);
  }

  const countRow = await DB.prepare(
    `SELECT COUNT(*) AS total FROM managed_khatmas mk LEFT JOIN users u ON u.id = mk.created_by_user_id ${where}`
  ).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT mk.id, mk.title, mk.khatma_type, mk.archived_at, mk.created_at,
       u.username AS owner_username, u.display_name AS owner_display_name,
       (SELECT COUNT(*) FROM managed_khatma_participants WHERE khatma_id = mk.id) AS participants_count,
       (SELECT COUNT(*) FROM managed_khatma_units WHERE khatma_id = mk.id) AS units_count
     FROM managed_khatmas mk LEFT JOIN users u ON u.id = mk.created_by_user_id
     ${where} ORDER BY mk.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  return json({
    ok: true,
    khatmas: rows.map(r => ({
      id: r.id, title: r.title || "", khatmaType: r.khatma_type || "",
      status: r.archived_at ? "archived" : "active",
      participantsCount: Number(r.participants_count) || 0,
      unitsCount: Number(r.units_count) || 0,
      ownerUsername: r.owner_username || "", ownerName: r.owner_display_name || r.owner_username || "",
      createdAt: r.created_at || ""
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerListUsers(request, DB) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const offset = (page - 1) * limit;
  const q = (url.searchParams.get("q") || "").trim();
  const roleFilter = url.searchParams.get("role") || "";
  const statusFilter = url.searchParams.get("status") || "";

  let where = "WHERE 1=1";
  const params = [];
  if (roleFilter) { where += " AND u.role = ?"; params.push(roleFilter); }
  if (statusFilter) { where += " AND u.status = ?"; params.push(statusFilter); }
  else { where += " AND u.status != 'deleted'"; }
  if (q) {
    const like = `%${q}%`;
    where += " AND (u.username LIKE ? OR u.display_name LIKE ?)";
    params.push(like, like);
  }

  const countRow = await DB.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`).bind(...params).first();
  const total = countRow?.total || 0;

  const rows = (await DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at,
       (SELECT COUNT(*) FROM managed_reader_groups WHERE created_by_user_id = u.id AND status != 'deleted') AS groups_count,
       (SELECT COUNT(*) FROM managed_reader_profiles WHERE created_by_user_id = u.id AND status != 'deleted') AS readers_count,
       (SELECT COUNT(*) FROM managed_khatmas WHERE created_by_user_id = u.id AND deleted_at IS NULL) AS khatmas_count
     FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()).results || [];

  return json({
    ok: true,
    users: rows.map(r => ({
      id: r.id, username: r.username || "", displayName: r.display_name || "",
      role: r.role || "", status: r.status || "",
      groupsCount: Number(r.groups_count) || 0,
      readersCount: Number(r.readers_count) || 0,
      khatmasCount: Number(r.khatmas_count) || 0,
      createdAt: r.created_at || ""
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1
  });
}

async function ownerSearch(request, DB) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = url.searchParams.get("type") || "all";
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10)));
  if (!q) return json({ ok: true, results: { readers: [], groups: [], khatmas: [], users: [] } });
  const like = `%${q}%`;
  const [readersR, groupsR, khatmasR, usersR] = await DB.batch([
    DB.prepare(`SELECT id, reader_name, serial_code, access_code, phone, country FROM managed_reader_profiles WHERE status != 'deleted' AND (reader_name LIKE ? OR serial_code LIKE ? OR access_code LIKE ? OR phone LIKE ?) LIMIT ?`).bind(like, like, like, like, limit),
    DB.prepare(`SELECT id, name FROM managed_reader_groups WHERE status != 'deleted' AND name LIKE ? LIMIT ?`).bind(like, limit),
    DB.prepare(`SELECT id, title FROM managed_khatmas WHERE deleted_at IS NULL AND title LIKE ? LIMIT ?`).bind(like, limit),
    DB.prepare(`SELECT id, username, display_name, role FROM users WHERE status != 'deleted' AND (username LIKE ? OR display_name LIKE ?) LIMIT ?`).bind(like, like, limit)
  ]);
  const r = {
    readers: (type === "all" || type === "readers") ? (readersR.results || []) : [],
    groups:  (type === "all" || type === "groups")  ? (groupsR.results  || []) : [],
    khatmas: (type === "all" || type === "khatmas") ? (khatmasR.results || []) : [],
    users:   (type === "all" || type === "users")   ? (usersR.results   || []) : []
  };
  return json({ ok: true, results: r });
}

// ── Pure-JS ZIP + XLSX writer (STORED mode, no dependencies) ──────────────

const _CRC32T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function _crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ _CRC32T[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total); let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
const _ENC = new TextEncoder();

function _zipLocal(nameBytes, data, crc) {
  const v = new DataView(new ArrayBuffer(30));
  v.setUint32(0, 0x504B0304, false);
  v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
  v.setUint16(10, 0, true); v.setUint16(12, 0x4A76, true);
  v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
  v.setUint16(26, nameBytes.length, true); v.setUint16(28, 0, true);
  return _concat([new Uint8Array(v.buffer), nameBytes, data]);
}
function _zipCentral(nameBytes, crc, size, offset) {
  const v = new DataView(new ArrayBuffer(46));
  v.setUint32(0, 0x504B0102, false);
  v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true);
  v.setUint16(12, 0, true); v.setUint16(14, 0x4A76, true);
  v.setUint32(16, crc, true); v.setUint32(20, size, true); v.setUint32(24, size, true);
  v.setUint16(28, nameBytes.length, true); v.setUint16(30, 0, true); v.setUint16(32, 0, true);
  v.setUint16(34, 0, true); v.setUint16(36, 0, true); v.setUint32(38, 0, true); v.setUint32(42, offset, true);
  return _concat([new Uint8Array(v.buffer), nameBytes]);
}
function _buildZip(files) {
  const locals = []; const centrals = []; let off = 0;
  for (const f of files) {
    const nb = _ENC.encode(f.name); const crc = _crc32(f.data); const size = f.data.length;
    const loc = _zipLocal(nb, f.data, crc);
    locals.push(loc); centrals.push(_zipCentral(nb, crc, size, off)); off += loc.length;
  }
  const cd = _concat(centrals);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x504B0506, false);
  eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cd.length, true); eocd.setUint32(16, off, true); eocd.setUint16(20, 0, true);
  return _concat([...locals, cd, new Uint8Array(eocd.buffer)]);
}
function _xe(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _buildXlsx(sheets) {
  // sheets: [{name: string, rows: [[cell,cell,...], ...]}]
  const files = [];
  let ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`;
  sheets.forEach((_, i) => { ct += `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`; });
  ct += `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  files.push({ name: '[Content_Types].xml', data: _ENC.encode(ct) });
  files.push({ name: '_rels/.rels', data: _ENC.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) });
  let wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`;
  sheets.forEach((s, i) => { wb += `<sheet name="${_xe(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`; });
  wb += `</sheets></workbook>`;
  files.push({ name: 'xl/workbook.xml', data: _ENC.encode(wb) });
  let wbr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  sheets.forEach((_, i) => { wbr += `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`; });
  wbr += `</Relationships>`;
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: _ENC.encode(wbr) });
  const COLS = ['A','B','C','D','E','F','G','H','I','J'];
  for (let i = 0; i < sheets.length; i++) {
    const { rows } = sheets[i];
    let ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
    for (let r = 0; r < rows.length; r++) {
      ws += `<row r="${r+1}">`;
      for (let c = 0; c < rows[r].length && c < COLS.length; c++) {
        ws += `<c r="${COLS[c]}${r+1}" t="inlineStr"><is><t>${_xe(rows[r][c])}</t></is></c>`;
      }
      ws += `</row>`;
    }
    ws += `</sheetData></worksheet>`;
    files.push({ name: `xl/worksheets/sheet${i+1}.xml`, data: _ENC.encode(ws) });
  }
  return _buildZip(files);
}

// ── Owner: export groups readers as .xlsx ─────────────────────────────────

async function ownerExportMuharramGroupsXlsx(request, DB) {
  const OWNER_ID = 'user_245e3fc4cf0445a78e';
  const PAT = 'mgroup_muh1448_%';

  const [groupsRes, readersRes] = await DB.batch([
    DB.prepare(`SELECT id, name FROM managed_reader_groups WHERE id LIKE ? AND created_by_user_id = ? AND status = 'active' ORDER BY id ASC`).bind(PAT, OWNER_ID),
    DB.prepare(`SELECT group_id, serial_code, reader_name, access_code, country, phone FROM managed_reader_profiles WHERE group_id LIKE ? AND status = 'active' ORDER BY group_id ASC, CASE WHEN serial_code IS NULL OR serial_code = '' THEN 1 ELSE 0 END, serial_code ASC`).bind(PAT)
  ]);

  const groups = groupsRes.results || [];
  if (!groups.length) return json({ ok: false, error: 'لا توجد مجموعات' }, 404);

  const byGroup = {};
  for (const r of (readersRes.results || [])) {
    if (!byGroup[r.group_id]) byGroup[r.group_id] = [];
    byGroup[r.group_id].push(r);
  }

  const sheets = groups.map(g => ({
    name: g.name,
    rows: [
      ['الرقم التسلسلي', 'اسم القارئ', 'كود الدخول / PIN', 'الدولة', 'رقم الجوال'],
      ...(byGroup[g.id] || []).map(r => [r.serial_code ?? '', r.reader_name ?? '', r.access_code ?? '', r.country ?? '', r.phone ?? ''])
    ]
  }));

  const xlsx = _buildXlsx(sheets);
  const today = new Date().toISOString().slice(0, 10);
  return new Response(xlsx, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="toallah-groups-readers-${today}.xlsx"`,
      'cache-control': 'no-store'
    }
  });
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
    if (parts.length === 2 && parts[0] === "auth" && parts[1] === "change-password" && method === "POST") return changePassword(request, env.DB);
    if (parts.length === 1 && parts[0] === "users") {
      if (method === "GET") return listUsers(request, env.DB);
      if (method === "POST") return createUser(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "users" && method === "PATCH") return editUser(request, env.DB, parts[1]);
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
    if (parts.length === 3 && parts[0] === "reader" && parts[1] === "me" && parts[2] === "profile" && method === "PATCH") return updateReaderProfile(request, env.DB);
    if (parts.length === 1 && parts[0] === "system-backup" && method === "GET") return systemBackup(request, env.DB);
    if (parts.length === 1 && parts[0] === "system-restore" && method === "POST") return systemRestore(request, env.DB);
    if (parts.length === 1 && parts[0] === "dashboard-stats" && method === "GET") return dashboardStats(request, env.DB);
    if (parts.length === 1 && parts[0] === "managed-progress" && method === "GET") return managedProgress(request, env.DB);
    if (parts.length === 1 && parts[0] === "reader-global-search" && method === "GET") return readerGlobalSearch(request, env.DB);
    if (parts.length === 1 && parts[0] === "managed-reader-groups") {
      if (method === "GET") return listReaderGroups(request, env.DB);
      if (method === "POST") return createReaderGroup(request, env.DB);
    }
    if (parts.length === 2 && parts[0] === "managed-reader-groups" && parts[1] === "range" && method === "GET") return getReaderGroupsRange(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-reader-groups") {
      if (method === "GET") return getReaderGroupById(request, env.DB, parts[1]);
      if (method === "PUT" || method === "POST") return updateReaderGroup(request, env.DB, parts[1]);
      if (method === "DELETE") return deleteReaderGroup(request, env.DB, parts[1]);
    }
    // P0: Multi-Group Reader membership routes
    if (parts.length === 3 && parts[0] === "managed-reader-groups" && parts[2] === "members" && method === "POST") return addReaderToGroup(request, env.DB, parts[1]);
    if (parts.length === 4 && parts[0] === "managed-reader-groups" && parts[2] === "members" && method === "DELETE") return removeReaderFromGroup(request, env.DB, parts[1], parts[3]);
    if (parts.length === 3 && parts[0] === "managed-readers" && parts[2] === "groups" && method === "GET") return listReaderGroupMemberships(request, env.DB, parts[1]);

    // Rollover — Hijri Monthly Rollover Phase 2
    // Batch Monthly Rollover (target_hijri_month + Preview Mode + Run)
    if (parts.length === 2 && parts[0] === "managed-rollover" && parts[1] === "batch-monthly" && method === "POST") return batchMonthlyRollover(request, env.DB);
    // Rollover Plan system
    if (parts.length === 1 && parts[0] === "managed-rollover-plans" && method === "GET") return listManagedRolloverPlans(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "export-template" && method === "GET") return exportRolloverPlanTemplate(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "import" && method === "POST") return importManagedRolloverPlan(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "validate" && method === "POST") return validateManagedRolloverPlanOnly(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "generate-preview" && method === "POST") return generatePreviewManagedRolloverPlan(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "batch-scan" && method === "POST") return batchScanRolloverKhatmas(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "batch-save-drafts" && method === "POST") return batchSaveDrafts(request, env.DB);
    if (parts.length === 2 && parts[0] === "managed-rollover-plans" && parts[1] === "forecast" && method === "POST") return forecastManagedRolloverPlan(request, env.DB);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "delete-draft" && method === "DELETE") return deleteDraftManagedRolloverPlan(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "preview" && method === "GET") return previewManagedRolloverPlan(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "approve" && method === "POST") return approveManagedRolloverPlan(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "invalidate" && method === "POST") return invalidateManagedRolloverPlan(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "assignments" && method === "POST") return addManagedRolloverPlanAssignment(request, env.DB, parts[1]);
    if (parts.length === 4 && parts[0] === "managed-rollover-plans" && parts[2] === "assignments" && method === "PATCH") return editManagedRolloverPlanAssignment(request, env.DB, parts[1], parts[3]);
    if (parts.length === 4 && parts[0] === "managed-rollover-plans" && parts[2] === "assignments" && method === "DELETE") return deleteManagedRolloverPlanAssignment(request, env.DB, parts[1], parts[3]);
    if (parts.length === 3 && parts[0] === "managed-rollover-plans" && parts[2] === "apply" && method === "POST") return applyManagedRolloverPlan(request, env.DB, parts[1]);
    if (parts.length === 3 && parts[0] === "managed-khatmas" && parts[2] === "cycle-history" && method === "GET") return getCycleHistory(request, env.DB, parts[1]);

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
    // Ordinary (non-managed) khatmas are retired — ToAllah is managed-khatmas-only.
    // Short-circuits every /khatmas* route before any ordinary handler can run.
    if (parts[0] === "khatmas") {
      return json({ ok: false, error: "retired", message: "الختمات العادية لم تعد متاحة. جميع الختمات الآن مُدارة." }, 410);
    }
    // Owner Control Center
    if (parts.length >= 2 && parts[0] === "owner") {
      const chk = await requireOwner(request, env.DB); if (!chk.ok) return chk.response;
      if (parts[1] === "overview" && parts.length === 2 && method === "GET") return ownerOverview(request, env.DB);
      if (parts[1] === "readers" && parts.length === 2 && method === "GET") return ownerListReaders(request, env.DB);
      if (parts[1] === "readers" && parts.length === 3 && method === "PATCH") return ownerEditReader(request, env.DB, parts[2]);
      if (parts[1] === "groups"  && parts.length === 2 && method === "GET") return ownerListGroups(request, env.DB);
      if (parts[1] === "khatmas" && parts.length === 2 && method === "GET") return ownerListKhatmas(request, env.DB);
      if (parts[1] === "users"   && parts.length === 2 && method === "GET") return ownerListUsers(request, env.DB);
      if (parts[1] === "search"  && parts.length === 2 && method === "GET") return ownerSearch(request, env.DB);
      if (parts[1] === "export-muharram-groups-readers-xlsx" && parts.length === 2 && method === "GET") return ownerExportMuharramGroupsXlsx(request, env.DB);
      if (parts[1] === "reports" && parts.length === 3 && method === "GET") {
        if (parts[2] === "missing-contact") return ownerReportMissingContact(request, env.DB);
        if (parts[2] === "groups")          return ownerReportGroups(request, env.DB);
      }
    }
    // Supervisor management (owner + managed creator)
    if (parts.length === 2 && parts[0] === "users" && parts[1] === "search" && method === "GET") return searchUsersForSupervisor(request, env.DB);
    if (parts.length === 3 && parts[0] === "users" && parts[2] === "supervisor-permission" && method === "POST") return setSupervisorPermission(request, env.DB, parts[1]);
    if (parts[0] === "supervisors") {
      if (parts.length === 1 && method === "GET") return listSupervisors(request, env.DB);
      if (parts.length === 2 && method === "GET") return getSupervisorAssignments(request, env.DB, parts[1]);
      if (parts.length === 2 && method === "POST") return saveSupervisorAssignments(request, env.DB, parts[1]);
    }
    if (parts.length === 2 && parts[0] === "picker" && parts[1] === "creator-groups" && method === "GET") return pickerCreatorGroups(request, env.DB);
    // Supervisor panel
    if (parts[0] === "supervisor") {
      if (parts.length === 2 && parts[1] === "stats" && method === "GET") return supervisorStats(request, env.DB);
      if (parts.length === 2 && parts[1] === "khatmas" && method === "GET") return supervisorListKhatmas(request, env.DB);
      if (parts.length === 3 && parts[1] === "khatmas" && method === "GET") return supervisorGetKhatma(request, env.DB, parts[2]);
      if (parts.length === 2 && parts[1] === "readers" && method === "GET") return supervisorListReaders(request, env.DB);
      if (parts.length === 2 && parts[1] === "reader-groups" && method === "GET") return supervisorListReaderGroups(request, env.DB);
      if (parts.length === 6 && parts[1] === "khatmas" && parts[3] === "units" && parts[5] === "status" && method === "POST") return supervisorChangeUnitStatus(request, env.DB, parts[2], parts[4]);
      if (parts.length === 6 && parts[1] === "khatmas" && parts[3] === "units" && parts[5] === "reassign" && method === "POST") return supervisorReassignUnit(request, env.DB, parts[2], parts[4]);
      if (parts.length === 4 && parts[1] === "readers" && parts[3] === "move-group" && method === "POST") return supervisorMoveReader(request, env.DB, parts[2]);
      if (parts.length === 3 && parts[1] === "readers" && method === "PATCH") return supervisorUpdateReaderNotes(request, env.DB, parts[2]);
    }
    return json({ ok: false, error: "Not found", path: parts }, 404);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Unexpected error" }, 500);
  }
}
