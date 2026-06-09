# وثيقة التشغيل والصيانة الكاملة — مشروع إلى الله (ToAllah)

> **تاريخ الإنشاء:** يونيو 2026  
> **الهدف:** وثيقة مرجعية شاملة للمشروع قبل تسليمه للجهة الخيرية.  
> **المبدأ:** كل معلومة مبنية على الكود الحقيقي لا على افتراضات عامة.

---

## فهرس المحتويات

0. [هيكلة المشروع (Architecture)](#0-هيكلة-المشروع)
1. [نظرة عامة على المشروع](#1-نظرة-عامة-على-المشروع)
2. [بنية الملفات](#2-بنية-الملفات)
3. [Frontend — شرح صفحة بصفحة](#3-frontend--شرح-صفحة-بصفحة)
4. [Backend — شرح Endpoint بـ Endpoint](#4-backend--شرح-endpoint-بـ-endpoint)
5. [قاعدة البيانات — الجداول](#5-قاعدة-البيانات--الجداول)
6. [علاقات البيانات](#6-علاقات-البيانات)
7. [منطق التدوير والتواريخ](#7-منطق-التدوير-والتواريخ)
8. [دفتر القراء (Reader Registry)](#8-دفتر-القراء-reader-registry)
9. [بوابة القارئ (Reader Portal)](#9-بوابة-القارئ-reader-portal)
10. [المشاركة مع منشئي الختمات](#10-المشاركة-مع-منشئي-الختمات)
11. [Dashboard و Monitor](#11-dashboard-و-monitor)
12. [PWA — التطبيق التقدمي](#12-pwa--التطبيق-التقدمي)
13. [النشر والتشغيل](#13-النشر-والتشغيل)
14. [دليل المشاكل (Troubleshooting)](#14-دليل-المشاكل-troubleshooting)
15. [Smoke Test بعد أي نشر](#15-smoke-test-بعد-أي-نشر)
16. [ملاحظات صيانة مستقبلية](#16-ملاحظات-صيانة-مستقبلية)

---

## 0. هيكلة المشروع

### شجرة الملفات الرئيسية

```
ToAllah/
├── public/                        ← ملفات الواجهة (تُرفع على Cloudflare Pages)
│   ├── index.html                 ← SPA الوحيد — يحتوي HTML + CSS + كل القوالب
│   ├── app.js                     ← كامل منطق Frontend (~3650+ سطر)
│   ├── styles.css                 ← (موجود لكن CSS الرئيسي مدمج في index.html)
│   ├── manifest.webmanifest       ← إعدادات PWA
│   ├── service-worker.js          ← Service Worker للتخزين المؤقت
│   ├── apple-touch-icon.png       ← أيقونة iOS
│   ├── config.js                  ← (إعدادات مخصصة اختيارية)
│   └── icons/                     ← أيقونات PWA بأحجام متعددة
│       ├── icon-72x72.png
│       ├── icon-192x192.png
│       ├── icon-512x512.png
│       ├── maskable-192x192.png
│       └── maskable-512x512.png
│
├── functions/
│   └── api/
│       └── [[path]].js            ← كامل Backend (~2600+ سطر)
│                                    يعمل كـ Cloudflare Pages Function
│
├── migrations/                    ← ملفات D1 migrations مرتبة تصاعدياً
│   ├── 0001_init.sql              ← الجداول الأساسية: users, khatmas, khatma_units
│   ├── 001_add_khatma_coordinator_fields.sql
│   ├── 002_add_selection_mode.sql
│   ├── 003_add_login_attempts.sql
│   ├── 004_add_managed_khatmas.sql          ← الختمات المُدارة والمشاركين والوحدات
│   ├── 005_add_managed_reader_profiles.sql  ← دفتر القراء العالمي
│   ├── 006_add_khatma_type.sql
│   ├── 007_add_reader_groups_and_rotation.sql ← المجموعات والتدوير
│   ├── 008_add_group_indexes.sql
│   ├── 009_rotation_duration_and_reader_portal.sql
│   ├── 010_creator_groups.sql               ← مجموعات المنشئين
│   ├── 011_auto_rotation.sql
│   ├── 012_archive_and_templates.sql
│   ├── 013_khatma_templates.sql
│   ├── 014_backup_logs.sql
│   └── 015_add_reader_registry_fields.sql   ← serial_code و country
│
├── wrangler.toml                  ← إعدادات Cloudflare (الاسم، D1، output dir)
├── package.json                   ← تبعيات Node (wrangler فقط)
├── schema.sql                     ← نسخة مجمّعة من كل الجداول (للمراجعة)
└── .gitignore
```

---

### ما الذي يعمل أين؟

| المكوّن | أين يعمل | الملف |
|---------|----------|-------|
| واجهة المستخدم (SPA) | المتصفح | `public/index.html` + `public/app.js` |
| التخزين المؤقت وعمل PWA | Service Worker في المتصفح | `public/service-worker.js` |
| API وقاعدة البيانات | Cloudflare Functions (Workers) | `functions/api/[[path]].js` |
| قاعدة البيانات | Cloudflare D1 (SQLite) | binding اسمه `DB` |
| الملفات الثابتة | Cloudflare Pages CDN | كل `public/*` |

---

### مخطط المعمارية (Architecture Diagram)

```
المتصفح (Browser)
      │
      │  (HTTPS)
      ▼
Cloudflare Pages CDN
      │
      ├──► Static Files: index.html / app.js / styles.css / icons
      │    (Service Worker يخزّن هذه مؤقتاً)
      │
      └──► /api/* طلبات API
                │
                ▼
        Cloudflare Pages Functions
        (functions/api/[[path]].js)
                │
                ├── currentUser() ← يتحقق من التوكن في user_sessions
                ├── computeRotationPeriodEnd() ← يحسب نهاية الدورة
                ├── mapManagedKhatma() ← يحوّل DB row → كائن JSON
                └── [منطق كل endpoint]
                │
                ▼
        Cloudflare D1 (SQLite)
        (قاعدة بيانات: toallah_db)
```

---

### تدفق بيانات بوابة القارئ

```
القارئ يُدخل الكود/الجوال/الاسم
      │
      ▼
POST /api/reader-portal  {identity: "..."}
      │
      ▼
readerPortal() في [[path]].js
      │
      ├── يبحث في managed_khatma_participants
      │   (بالـ access_code أو phone أو participant_name أو serial_code)
      │
      ▼
getManagedKhatmaParticipantView(DB, khatma_id, participant)
      │
      ├── يجلب صف managed_khatmas
      ├── يجلب managed_khatma_units WHERE participant_id = participant.id
      └── يُنشئ mapManagedKhatma() مع الوحدات المخصصة فقط
      │
      ▼
{ok: true, khatmas: [...], readerProfile: {...}}
      │
      ▼
setupReaderLogin() في app.js
يعرض الختمات مع أجزاء القارئ
```

---

### تدفق بيانات الختمة المُدارة

```
المنشئ ينشئ/يُعدّل ختمة
      │
      ▼
POST /api/managed-khatmas   (createManagedKhatma)
      │
      ├── يكتب في managed_khatmas
      ├── يكتب في managed_khatma_participants (للمشاركين)
      └── يكتب في managed_khatma_units (للوحدات/الأجزاء)
      │
      ▼
GET /api/managed-khatmas/{id}/admin  (getManagedAdmin)
      │
      ▼
mapManagedKhatma(row, units, participants)
      ├── يعيد حساب expiresAt لكل نوع دوري (monthly/weekly/yearly)
      └── يُرجع كائن JSON كامل
      │
      ▼
setupManagedKhatma(id, manageMode) في app.js
يعرض بطاقة الإدارة مع countdown وإحصائيات
```

---

### نقاط الدخول الرئيسية

| النقطة | الملف | الوظيفة |
|--------|-------|---------|
| دخول التطبيق | `public/index.html` → `<script src="app.js">` | تحميل الـ SPA |
| دخول الواجهة | `app.js` → `init()` سطر 128 | تحميل المستخدم ثم `router()` |
| دخول الـ API | `functions/api/[[path]].js` → `export async function onRequest` | نقطة دخول Cloudflare Function |
| Router الصفحات | `app.js` → `async function router()` سطر 311 | يوجّه حسب `location.hash` |
| جلب البيانات | `app.js` → `async function api(path, options)` سطر 292 | wrapper لكل طلبات API |

---

### أهم الدوال المركزية

| الدالة | الملف | الوظيفة |
|--------|-------|---------|
| `computeRotationPeriodEnd()` | `[[path]].js` سطر 46 | حساب نهاية الدورة (backend) |
| `mapManagedKhatma()` | `[[path]].js` سطر 882 | تحويل صف DB → كائن API |
| `readerPortal()` | `[[path]].js` سطر 2021 | بحث القارئ وعرض ختماته |
| `dashboardStats()` | `[[path]].js` سطر 2229 | إحصائيات لوحة التحكم |
| `computeCurrentPeriodEnd()` | `app.js` سطر 1225 | حساب نهاية الدورة (frontend) |
| `formatPeriodEnd()` | `app.js` سطر 1291 | تنسيق تاريخ نهاية الدورة للعرض |
| `setupReaderLogin()` | `app.js` سطر 1694 | بوابة القارئ — شاشة البحث |
| `setupManagedKhatma()` | `app.js` سطر 2977 | عرض الختمة وإدارتها |
| `router()` | `app.js` سطر 311 | توجيه صفحات الـ SPA |

---

### أهم الجداول المركزية

| الجدول | الوظيفة |
|--------|---------|
| `managed_khatmas` | سجلات الختمات المُدارة |
| `managed_khatma_participants` | القراء المضافون في كل ختمة |
| `managed_khatma_units` | الأجزاء/الوحدات مع حالتها ومن قرأها |
| `managed_reader_profiles` | دفتر القراء العالمي (قارئ مستقل عن الختمات) |
| `users` | حسابات المنشئين والمالك |
| `managed_creator_groups` | مجموعات لمشاركة الختمات بين المنشئين |

---

### إذا أردت فهم المشروع خلال 15 دقيقة

**اقرأ بهذا الترتيب:**

1. **`wrangler.toml`** (ثانيتان) — يخبرك باسم المشروع، D1 database ID، ومكان الملفات الثابتة.

2. **`public/index.html`** — أولاً القسم `<style>` ليفهم نظام التصميم. ثم ابحث عن `<template id=` لترى كل قوالب الصفحات (كل صفحة لها `<template>` منفصلة في نفس الملف).

3. **`public/app.js`** أسطر 1–350 — تجد `state` الكائن الرئيسي، دالة `init()` التي تُشغَّل عند الفتح، و`router()` التي توجّه الصفحات.

4. **`functions/api/[[path]].js`** أسطر 2490–2593 — الـ routing الكامل للـ API (كل endpoint في سطر واحد أو سطرين واضحين).

5. **`migrations/`** — اقرأ `0001_init.sql` و`004_add_managed_khatmas.sql` و`005_add_managed_reader_profiles.sql` لفهم هيكل البيانات الأساسي. الجداول الأهم هي: `managed_khatmas`، `managed_khatma_participants`، `managed_khatma_units`، `managed_reader_profiles`.

---

## 1. نظرة عامة على المشروع

### الهدف

**إلى الله** هو منصة لتنظيم ختمات القرآن الكريم المُدارة. تُتيح للمنشئين إنشاء ختمات وتوزيع الأجزاء على القراء، وتتيح للقراء متابعة أجزائهم وتسجيل إتمامها.

---

### المستخدمون والأدوار

| الدور | التعريف | الصلاحيات |
|-------|---------|-----------|
| **owner** | المالك (مستخدم واحد فقط في النظام) | كل الصلاحيات: إدارة المستخدمين، الختمات العادية، الختمات المُدارة، النسخ الاحتياطي |
| **creator** | منشئ الختمة | إنشاء وإدارة الختمات المُدارة (إذا أعطاه المالك صلاحية `managed-permission`). لا يرى الختمات العادية |
| **reader** | القارئ | لا حساب له في النظام. يدخل عبر بوابة القارئ بالكود أو الجوال أو الاسم |

> **ملاحظة تقنية:** الدور `owner` مخزّن في حقل `role` في جدول `users`. الصلاحية `managedKhatmaCreator` مستقلة ومخزّنة في جدول `managed_khatma_permissions`.

---

### الفرق بين أنواع الختمات

| النوع | التعريف | الجدول | من يراها |
|-------|---------|--------|---------|
| **ختمة عادية** (`khatmas`) | ختمة عامة قديمة بدون إدارة متقدمة | `khatmas` + `khatma_units` | owner فقط |
| **ختمة مُدارة** (`managed_khatmas`) | ختمة بإدارة كاملة: مشاركون، أجزاء، تدوير، بوابة قارئ | `managed_khatmas` + `managed_khatma_participants` + `managed_khatma_units` | creator + owner |
| **دفتر القراء** | قائمة عالمية بالقراء المسجّلين (مستقلة عن الختمات) | `managed_reader_profiles` | creator + owner |
| **بوابة القارئ** | واجهة للقارئ (بدون حساب) لرؤية ختماته وأجزائه | لا جدول منفصل — تُجمع من الجداول السابقة | أي شخص عنده كود أو جوال |

---

## 2. بنية الملفات

### `public/index.html`

**وظيفته:** الملف الوحيد الذي يُرسَل للمتصفح. يحتوي على:
- CSS كامل (متضمن في `<style>` داخله — أكثر من 700 سطر)
- هيكل HTML الثابت (navbar، `<div id="app">`)
- جميع قوالب الصفحات داخل `<template id="...">` (كل صفحة قالب)
- مرجع لـ `<script src="app.js">`

**أهم الأقسام:**
- CSS المتغيرات (`--primary`, `--bg`, `--gold`) تحدد كامل نظام الألوان
- `[data-theme="dark"]` — الوضع الداكن
- كل `<template id="...Template">` هو قالب صفحة (loginTemplate، dashboardTemplate... إلخ)
- `<div id="app">` هو الحاوية الرئيسية التي يُعيد `app.js` كتابتها عند كل تغيير صفحة

**متى تفتحه:** عند تعديل CSS، إضافة قالب صفحة جديدة، أو تعديل navbar.

**مشاكل شائعة فيه:**
- تغيير CSS يسبب تضاربًا بسبب وجود طبقات CSS متعددة (v5.5، v5.9، v5.10، v5.11، v5.14، v5.15) كل منها يُصحّح السابق
- قوالب `<template>` مدمجة في الملف — إضافة أو تعديل قالب يتطلب الحذر من الأسماء

---

### `public/app.js`

**وظيفته:** كامل منطق التطبيق (~3650 سطر). لا يوجد framework — Vanilla JS خالص.

**أهم الأقسام:**

| السطر | القسم |
|-------|-------|
| 1–10 | `state` الكائن الرئيسي لحالة التطبيق |
| 128 | `init()` — نقطة الدخول |
| 292 | `api()` — wrapper لجميع طلبات HTTP |
| 311 | `router()` — التوجيه بين الصفحات |
| 1225 | `computeCurrentPeriodEnd()` — حساب نهاية الدورة |
| 1291 | `formatPeriodEnd()` — تنسيق تاريخ العرض |
| 1694 | `setupReaderLogin()` — بوابة القارئ |
| 1917 | `setupReaderKhatma()` — صفحة قارئ داخل ختمة |
| 2229 (backend) | (يوافق) `dashboardStats` |
| 2637 | `setupDashboard()` — لوحة التحكم |
| 2977 | `setupManagedKhatma()` — عرض الختمة وإدارتها |
| 3521 | `isExpired()`, `countdownHtml()`, `formatDateTime()` |

**متى تفتحه:** لأي مشكلة في الواجهة أو منطق العرض أو الحسابات.

**مشاكل شائعة:**
- تعارض `localStorage.reader_portal_identity` يحتفظ بالهوية القديمة
- دوال الحساب الزمني تعتمد على التوقيت المحلي للمتصفح (parseDateOnlyLocal)

---

### `functions/api/[[path]].js`

**وظيفته:** كامل Backend (~2600 سطر). يعمل كـ Cloudflare Pages Function. كل الـ endpoints في ملف واحد.

**أهم الأقسام:**

| السطر | القسم |
|-------|-------|
| 1–45 | دوال مساعدة: `now()`, `newId()`, `json()`, `readJson()` |
| 46–85 | `computeRotationPeriodEnd()` — حساب نهاية الدورة (backend) |
| 86–165 | `adminCode()`, `sha256Hex()`, `hashPassword()`, `checkRateLimit()` |
| 166–222 | `mapKhatma()` — تحويل صف khatma العادي |
| 223–280 | `currentUser()`, `requireOwner()`, `login()`, `logout()` |
| 882–940 | `mapManagedKhatma()` — تحويل صف managed_khatma مع إعادة حساب expiresAt |
| 2021–2070 | `readerPortal()` — البحث وإرجاع بيانات القارئ |
| 2229–2400 | `dashboardStats()` — إحصائيات لوحة التحكم |
| 2490–2592 | `onRequest()` — نقطة الدخول الرئيسية ورسم الـ routing |

**متى تفتحه:** لأي مشكلة في API أو قاعدة البيانات أو الحسابات.

**مشاكل شائعة:**
- Cloudflare Workers يعمل بـ UTC دائماً — `new Date("YYYY-MM-DD")` = منتصف الليل UTC
- D1 يخزّن النصوص كـ TEXT — لا أنواع DATE أو DATETIME حقيقية

---

### `migrations/`

**وظيفته:** ملفات SQL تُطبَّق بالترتيب على D1 لبناء هيكل قاعدة البيانات.

**مهم:** كل migration آمن (يستخدم `IF NOT EXISTS`، لا يحذف أعمدة موجودة). تُطبَّق مرة واحدة فقط.

**متى تفتحه:** عند إضافة جدول أو عمود جديد.

**مشاكل شائعة:**
- تطبيق migration مرتين لا يضر (بسبب `IF NOT EXISTS`)
- نسيان تطبيق migration بعد push سيجعل الكود يعمل بينما العمود الجديد غير موجود في DB

---

### `public/service-worker.js`

**وظيفته:** Service Worker للـ PWA. يخزّن App Shell مؤقتاً.

**استراتيجية التخزين:**
- `/api/*` → **لا تخزين أبداً** (يذهب للشبكة مباشرة)
- `index.html`, `app.js`, `styles.css`, `manifest.webmanifest` → **Cache First** (App Shell)
- `/icons/*` → **Cache First + Cache on Fetch**
- Navigation requests → **Network First** (مع fallback لـ `index.html` عند انقطاع الإنترنت)

**متى تفتحه:** عند مشاكل "الموقع لا يعرض آخر نسخة" أو "يعمل بدون إنترنت".

---

### `public/manifest.webmanifest`

**وظيفته:** بيانات PWA — اسم التطبيق، الأيقونات، لون الثيم، وضع العرض.

**أهم الحقول:**
- `start_url: "/?source=pwa"` — URL البداية عند فتح من شاشة الرئيسية
- `display: "standalone"` — يعمل كتطبيق مستقل بدون شريط المتصفح
- `theme_color: "#0f5f45"` — اللون الأخضر الداكن

---

### `wrangler.toml`

```toml
name = "toallah"
compatibility_date = "2026-05-22"
pages_build_output_dir = "./public"

[[d1_databases]]
binding = "DB"
database_name = "toallah_db"
database_id = "938b6097-b17b-42d9-9112-e135ebf4d3a8"
```

- `name` = اسم المشروع على Cloudflare
- `pages_build_output_dir = "./public"` = المجلد الذي يُنشر
- `binding = "DB"` = الاسم الذي يستخدمه الكود (`env.DB`) للوصول لـ D1

---

## 3. Frontend — شرح صفحة بصفحة

### الصفحة الرئيسية (`#/home`)

- **القالب:** `<template id="homeTemplate">`
- **دالة setup:** `setupHome()` سطر 689
- **ما تعرضه:** صفحة ترحيبية للزوار، أزرار للدخول وللبحث عن ختمة
- **APIs:** لا تستدعي API خاص
- **لمن تظهر:** لأي زائر (مسجّل أو غير مسجّل)
- **مشاكل شائعة:** إذا كان هناك token منتهي، يتحول الزائر لهذه الصفحة تلقائياً

---

### صفحة تسجيل الدخول (`#/login`)

- **القالب:** `<template id="loginTemplate">`
- **دالة setup:** `setupLogin()` سطر 348
- **API:** `POST /api/auth/login` ← `{username, password}`
- **ما يُرجعه API:** `{ok: true, token, user: {..., managedKhatmaCreator}}`
- **بعد النجاح:** يحفظ `token` في `localStorage.auth_token` ويُعيد التوجيه
- **Rate Limiting:** 10 محاولات كل 15 دقيقة من نفس الـ IP (جدول `login_attempts`)

---

### لوحة التحكم (`#/dashboard`)

- **القالب:** `<template id="dashboardTemplate">`
- **دالة setup:** `setupDashboard()` سطر 2637
- **API:** `GET /api/dashboard-stats`
- **ما تعرضه:**
  - بحث شامل عن قارئ (اسم / جوال / كود)
  - بطاقات الملخص: عدد الختمات، الوحدات المكتملة، القراء، الوحدات الجارية
  - رسوم بيانية (Donut Charts): حالة الختمات، حالة الوحدات، الختمات بالنوع
  - أفضل القراء (top 10 بالأجزاء المكتملة)
  - الاتجاه الشهري (آخر 6 أشهر)
- **من يرى:** creator + owner
- **مشاكل شائعة:** إذا لم تظهر إحصائيات الختمات المشتركة → راجع `shared_creator_group_id` و`getCreatorGroupMemberIds()`

---

### قائمة الختمات المُدارة (`#/managed-khatmas`)

- **القالب:** `<template id="managedKhatmasTemplate">`
- **دالة setup:** `setupManagedKhatmas()` سطر 2775
- **API:** يستخدم `state.managedKhatmas` (محمّلة مسبقاً عند `init()`)
- **ما تعرضه:** قائمة الختمات النشطة مع حالتها (نشطة / مغلقة / منتهية / مكتملة)
- **من يرى:** creator + owner
- **مشاكل شائعة:** إذا لم تظهر ختمة → تحقق من `deleted_at` في DB أو `status`

---

### إنشاء ختمة (`#/managed-create`)

- **القالب:** `<template id="managedCreateTemplate">`
- **دالة setup:** `setupManagedCreate()` سطر 2833
- **API:** `POST /api/managed-khatmas`
- **ما يُرسل:**
  - `khatmaType`, `khatmaDate`, `title`, `division`
  - قائمة المشاركين (اسم + جوال + عدد أجزاء)
- **مهم:** الحقل `khatmaDate` يُستخدم كـ `rotation_start_date` في Backend (منذ إصلاح الجلسة الحالية)
- **مشاكل شائعة:** إذا لم يُحفَظ `rotation_start_date` → تحقق من `createManagedKhatma` سطر 1604

---

### عرض وإدارة ختمة (`#/managed-khatma/{id}` أو `#/managed-khatma/{id}/manage`)

- **القالب:** `<template id="managedKhatmaTemplate">`
- **دالة setup:** `setupManagedKhatma(id, manageMode)` سطر 2977
- **APIs:**
  - `GET /api/managed-khatmas/{id}` (عام، بدون أجزاء)
  - `GET /api/managed-khatmas/{id}/admin` (مع إدارة كاملة)
- **ما تعرضه:**
  - رأس الصفحة: العنوان، التاريخ، الحالة
  - إحصائيات: نسبة الإنجاز، مكتمل، مُعيّن
  - `periodStatHtml`: نهاية الدورة الحالية (من `formatPeriodEnd`)
  - `countdownHtml(k)`: العد التنازلي (من `k.expiresAt` الـ backend)
  - قائمة الوحدات/الأجزاء
- **مشاكل شائعة:**
  - تاريخ النهاية خاطئ → راجع `mapManagedKhatma` و`computeRotationPeriodEnd`
  - الوحدات لا تظهر → تحقق من `participant_id` في `managed_khatma_units`

---

### الأرشيف (`#/managed-khatmas/archived`)

- **القالب:** `<template id="managedKhatmasArchivedTemplate">`
- **دالة setup:** `setupManagedKhatmasArchived()` سطر 3271
- **API:** `GET /api/managed-khatmas` (يُرجع كل الختمات بما فيها المؤرشفة)
- **ما تعرضه:** الختمات ذات `archived_at IS NOT NULL`

---

### دفتر القراء (`#/managed-readers`)

- **القالب:** `<template id="managedReadersTemplate">`
- **دالة setup:** `setupManagedReaders()` سطر 1387
- **APIs:**
  - `GET /api/managed-readers` ← قائمة القراء
  - `POST /api/managed-readers` ← إنشاء/تحديث
  - `DELETE /api/managed-readers/{id}` ← حذف
  - `GET /api/managed-reader-groups` ← المجموعات
- **ما تعرضه:** قائمة القراء العالميين مع إمكانية إضافة/تعديل/حذف/بحث
- **مشاكل شائعة:** serial_code لا يظهر → راجع migration 015 وتأكد من تطبيقه

---

### بوابة القارئ (`#/reader-login`)

- **القالب:** `<template id="readerLoginTemplate">`
- **دالة setup:** `setupReaderLogin()` سطر 1694
- **API:** `POST /api/reader-portal` `{identity: "..."}`
- **تفاصيل كاملة في** [القسم 9](#9-بوابة-القارئ-reader-portal)

---

### صفحة القارئ داخل ختمة (`#/reader-khatma/{khatmaId}`)

- **القالب:** `<template id="readerKhatmaTemplate">`
- **دالة setup:** `setupReaderKhatma(khatmaId)` سطر 1917
- **API:** `POST /api/reader-portal` + `POST /api/managed-khatmas/{id}/units/{num}/{action}`
- **تفاصيل كاملة في** [القسم 9](#9-بوابة-القارئ-reader-portal)

---

### مراقبة التقدم (`#/managed-monitor`)

- **القالب:** `<template id="managedMonitorTemplate">`
- **دالة setup:** `setupManagedMonitor()` سطر 2254
- **ما تعرضه:** قائمة تفصيلية لكل الختمات مع نسبة الإنجاز لكل مشارك
- **تفاصيل في** [القسم 11](#11-dashboard-و-monitor)

---

### التقارير (`#/reports`)

- **القالب:** `<template id="reportsTemplate">`
- **دالة setup:** `setupReports()` سطر 2408
- **ما تعرضه:** تقارير مفصلة للأجزاء والقراء (owner فقط)

---

### لوحة المالك (`#/owner`)

- **القالب:** `<template id="ownerTemplate">`
- **دالة setup:** `setupOwner()` سطر 391
- **ما تعرضه:** إدارة المستخدمين، صلاحيات الختمات المُدارة، مجموعات المنشئين
- **من يرى:** owner فقط

---

## 4. Backend — شرح Endpoint بـ Endpoint

كل الـ Endpoints في `functions/api/[[path]].js`. نقطة الدخول: `export async function onRequest(context)` في آخر الملف.

---

### Auth

#### `POST /api/auth/login`
- **الدالة:** `login()` سطر 247
- **الصلاحية:** لا أحد (public)
- **يستقبل:** `{username, password}`
- **يُرجع:** `{ok, token, user: {id, username, displayName, role, managedKhatmaCreator}}`
- **الجداول:** قراءة من `users`، كتابة في `user_sessions`، كتابة في `login_attempts`
- **Rate Limit:** 10 محاولات / 15 دقيقة من نفس IP
- **إذا فشل:** تحقق من `login_attempts` في DB

#### `GET /api/auth/me`
- **الدالة:** `me()` سطر 270
- **يُرجع:** بيانات المستخدم الحالي (من التوكن في Authorization header)

#### `POST /api/auth/logout`
- **الدالة:** `logout()` سطر 275
- **يحذف:** صف من `user_sessions`

---

### الختمات المُدارة

#### `GET /api/managed-khatmas`
- **الدالة:** `listManagedKhatmas()` 
- **الصلاحية:** creator أو owner
- **يُرجع:** قائمة الختمات مع حساب `expiresAt` المُعاد في `mapManagedKhatma()`
- **الجداول:** `managed_khatmas`، `managed_khatma_units`، `managed_khatma_participants`
- **ملاحظة:** يُرجع أيضاً الختمات المشتركة عبر `shared_creator_group_id`

#### `POST /api/managed-khatmas`
- **الدالة:** `createManagedKhatma()` سطر ~1540
- **الصلاحية:** creator أو owner
- **يستقبل:** `{title, khatmaType, khatmaDate, division, participants[], ...}`
- **يكتب في:** `managed_khatmas`، `managed_khatma_participants`، `managed_khatma_units`
- **مهم:** `rotationStartDate = data.rotationStartDate || data.khatmaDate || data.rotation_start_date`

#### `GET /api/managed-khatmas/{id}/admin`
- **الدالة:** `getManagedAdmin()`
- **يُرجع:** كامل بيانات الختمة مع الوحدات والمشاركين للمنشئ

#### `POST /api/managed-khatmas/{id}/admin/update`
- **الدالة:** `updateManagedKhatma()` سطر 1694
- **يُحدّث:** `managed_khatmas`، `managed_khatma_participants`، `managed_khatma_units`
- **مهم:** يعيد حساب `expires_at` لـ monthly/weekly/yearly

#### `POST /api/managed-khatmas/{id}/admin/toggle-close`
- يُغلق أو يُفتح الختمة (تغيير `status`)

#### `POST /api/managed-khatmas/{id}/admin/archive`
- يُضبط `archived_at`

#### `POST /api/managed-khatmas/{id}/admin/delete`
- يُضبط `deleted_at` (soft delete)

#### `POST /api/managed-khatmas/{id}/admin/duplicate`
- ينشئ نسخة من الختمة (مع أو بدون المشاركين)

---

### وحدات الختمة

#### `POST /api/managed-khatmas/{id}/units/{num}/{action}`
- **الدالة:** `managedUnitAction()` 
- **الصلاحية:** أي شخص له access_code صحيح للختمة، أو منشئ الختمة
- **Actions:** `assign`, `reading`, `complete`, `available`
- **يُحدّث:** `managed_khatma_units` (status، participant_id، completed_at)
- **مهم:** زر "تمت القراءة" يستخدم `access_code` لا `serial_code`

---

### بوابة القارئ

#### `POST /api/reader-portal`
- **الدالة:** `readerPortal()` سطر 2021
- **الصلاحية:** public (لا يحتاج تسجيل)
- **يستقبل:** `{identity: "..."}`
- **ترتيب البحث:**
  1. Serial code (`R-XXXXXX`) — عرض فقط، لا يُعطي صلاحية الإكمال
  2. `access_code` (كود 10 أرقام)
  3. `phone` (رقم الجوال مُطبَّع)
  4. `participant_name` (الاسم الكامل)
- **يُرجع:** `{ok, khatmas: [...], readerProfile: {serialCode, country, name}}`
- **الجداول:** `managed_khatma_participants`، `managed_khatmas`، `managed_khatma_units`

#### `POST /api/reader-lookup`
- **الدالة:** `readerLookup()` سطر 2452
- **يستخدم:** في لوحة التحكم للبحث السريع من Admin

---

### دفتر القراء

#### `GET /api/managed-readers`
- يُرجع قائمة القراء للمنشئ الحالي (أو كل القراء للمالك)

#### `POST /api/managed-readers`
- **الدالة:** `upsertManagedReaders()`
- ينشئ أو يُحدّث قارئاً. إذا كان `id` موجوداً → update، وإلا → insert جديد مع توليد `serial_code`

#### `DELETE /api/managed-readers/{id}`
- soft delete: يضع `status = 'deleted'`

---

### dashboard

#### `GET /api/dashboard-stats`
- **الدالة:** `dashboardStats()` سطر 2229
- **الصلاحية:** creator أو owner
- **يُرجع:** `{khatmas, units, readers, groups, topReaders, byMonth}`
- **تفاصيل في** [القسم 11](#11-dashboard-و-monitor)

---

### مجموعات المنشئين (Creator Groups)

#### `GET /api/managed-creator-groups`
- قائمة مجموعات المنشئين (owner فقط)

#### `POST /api/managed-creator-groups`
- إنشاء مجموعة جديدة

#### `POST /api/managed-creator-groups/{id}/members`
- إضافة منشئ للمجموعة

#### `POST /api/managed-khatmas/{id}/admin/share`
- **الدالة:** `shareManagedKhatma()`
- يُضبط `shared_creator_group_id` على الختمة ← يجعلها تظهر لكل أعضاء المجموعة

---

### النسخ الاحتياطي

#### `GET /api/system-backup`
- **الصلاحية:** owner فقط
- **يُرجع:** JSON كامل لكل جداول قاعدة البيانات

#### `POST /api/system-restore`
- **الصلاحية:** owner فقط
- **يستعيد:** البيانات من JSON (خطير — يحذف البيانات الموجودة)

---

## 5. قاعدة البيانات — الجداول

**قاعدة البيانات:** Cloudflare D1 (SQLite)  
**اسمها:** `toallah_db`  
**ID:** `938b6097-b17b-42d9-9112-e135ebf4d3a8`

---

### جدول `users`

**migration:** `0001_init.sql`

| الحقل | النوع | الوظيفة |
|-------|-------|---------|
| `id` | TEXT PK | مثل `user_abc123` |
| `username` | TEXT UNIQUE | اسم الدخول |
| `display_name` | TEXT | الاسم المعروض |
| `password_hash` | TEXT | مشفّر بـ SHA-256 (`v2:` prefix = النسخة الجديدة) |
| `role` | TEXT | `owner` أو `creator` |
| `status` | TEXT | `active` أو `deleted` |
| `created_at`, `updated_at` | TEXT | ISO 8601 |

**متى يُنشأ الصف:** عند إنشاء مستخدم من لوحة المالك  
**مشاكل شائعة:** كلمة مرور خاطئة → تحقق من `password_hash` هل تبدأ بـ `v2:`

---

### جدول `user_sessions`

| الحقل | الوظيفة |
|-------|---------|
| `token` | التوكن (Primary Key) |
| `user_id` | مرتبط بـ `users.id` |
| `expires_at` | يوم + 30 يوماً من تسجيل الدخول |

**مشاكل شائعة:** جلسة منتهية → يُعيد التوجيه للـ `#/login`

---

### جدول `managed_khatmas`

**migration:** `004_add_managed_khatmas.sql` + migrations لاحقة

| الحقل | الوظيفة |
|-------|---------|
| `id` | مثل `mkhatma_abc123` |
| `title` | عنوان الختمة |
| `khatma_type` | `weekly` / `monthly` / `yearly` / `special` / `separate` / `sub` / `specific` |
| `khatma_date` | تاريخ بدء الختمة (YYYY-MM-DD) |
| `rotation_start_date` | تاريخ بداية أول دورة (YYYY-MM-DD) — قد يختلف عن `khatma_date` |
| `expires_at` | تاريخ انتهاء الدورة (يُعاد حسابه في `mapManagedKhatma`) |
| `division` | `juz` / `hizb` / `quarter` |
| `selection_mode` | `all` / `custom` |
| `status` | `active` / `closed` |
| `deleted_at` | NULL = غير محذوف |
| `archived_at` | NULL = غير مؤرشف |
| `shared_creator_group_id` | إذا مشترك مع مجموعة منشئين |
| `created_by_user_id` | منشئ الختمة |
| `rotation_duration_years` | عدد سنوات الخطة الدورية (افتراضي 5) |

**علاقات:**
- `created_by_user_id` → `users.id`
- `group_id` → `managed_reader_groups.id`
- `shared_creator_group_id` → `managed_creator_groups.id`

---

### جدول `managed_khatma_participants`

| الحقل | الوظيفة |
|-------|---------|
| `id` | مثل `mpart_abc123` |
| `khatma_id` | الختمة التي ينتمي إليها |
| `participant_name` | اسم القارئ في هذه الختمة |
| `phone` | رقم الجوال (مُطبَّع: يبدأ بـ 0) |
| `access_code` | كود 10 أرقام فريد داخل الختمة |
| `reader_profile_id` | رابط لـ `managed_reader_profiles.id` (اختياري) |
| `start_juz` | الجزء الأول المخصص له |
| `parts_count` | عدد الأجزاء المخصصة له |
| `notes` | ملاحظات |

**متى يُنشأ:** عند إضافة قارئ للختمة  
**علاقة مهمة:** `reader_profile_id` يربطه بدفتر القراء العالمي

---

### جدول `managed_khatma_units`

| الحقل | الوظيفة |
|-------|---------|
| `id` | معرّف الوحدة |
| `khatma_id` | الختمة |
| `unit_number` | رقم الجزء (1–30 لـ juz) |
| `label` | "الجزء الأول"، "الجزء الثاني"... |
| `status` | `available` / `assigned` / `reading` / `completed` |
| `participant_id` | مُعيَّن لـ `managed_khatma_participants.id` |
| `reading_at` | تاريخ بدء القراءة |
| `completed_at` | تاريخ الإكمال |

**متى يُنشأ:** عند إنشاء الختمة (دُفعة واحدة لكل الوحدات)  
**مشاكل شائعة:** `participant_id = NULL` = الجزء غير مُعيَّن لأحد (حتى لو المشارك موجود)

---

### جدول `managed_reader_profiles`

**migration:** `005_add_managed_reader_profiles.sql` + `015_add_reader_registry_fields.sql`

| الحقل | الوظيفة |
|-------|---------|
| `id` | مثل `mrp_abc123` |
| `created_by_user_id` | المنشئ الذي أضاف هذا القارئ |
| `reader_name` | اسم القارئ |
| `phone` | رقم الجوال |
| `access_code` | كود الدخول (فريد لكل منشئ) |
| `serial_code` | مثل `R-000001` (فريد عالمياً، يُولَّد تلقائياً) |
| `country` | الدولة (اختياري) |
| `group_id` | ينتمي لمجموعة قراء |
| `start_juz` | الجزء الافتراضي |
| `parts_count` | عدد الأجزاء الافتراضي |
| `status` | `active` / `deleted` |

---

### جدول `managed_reader_groups`

| الحقل | الوظيفة |
|-------|---------|
| `id` | مثل `rg_abc123` |
| `created_by_user_id` | المنشئ |
| `name` | اسم المجموعة |
| `rotation_type` | `monthly` / `weekly` / `yearly` |
| `rotation_start_date` | تاريخ بداية التدوير |
| `rotation_duration_years` | عدد السنوات (افتراضي 5) |

---

### جدول `managed_creator_groups`

| الحقل | الوظيفة |
|-------|---------|
| `id` | مجموعة منشئين |
| `name` | الاسم |
| `created_by_user_id` | المالك دائماً (owner) |

**علاقة:** → `managed_creator_group_members` (user_id لكل منشئ في المجموعة)

---

### جدول `khatmas` (الختمات العادية)

للمالك فقط. يشبه `managed_khatmas` لكن بدون نظام المشاركين المتقدم.

| أهم الحقول | الوظيفة |
|-----------|---------|
| `owner_key` | مفتاح سري للمالك بدلاً من تسجيل الدخول |
| `admin_code` | كود للمنشئ للوصول للإدارة |

---

## 6. علاقات البيانات

### كيف يرتبط القارئ العالمي بمشارك الختمة

```
managed_reader_profiles (دفتر القراء العالمي)
    id = "mrp_abc"
    reader_name = "محمد أحمد"
    access_code = "1234567890"
    serial_code = "R-000042"
    phone = "0501234567"
         │
         │ (reader_profile_id)
         ▼
managed_khatma_participants (مشاركون في ختمة معينة)
    id = "mpart_xyz"
    khatma_id = "mkhatma_..."
    participant_name = "محمد أحمد"
    access_code = "1234567890"   ← نفس الكود من الملف الشخصي
    reader_profile_id = "mrp_abc"  ← الرابط للملف الشخصي
         │
         │ (participant_id)
         ▼
managed_khatma_units (أجزاء مُعيَّنة)
    participant_id = "mpart_xyz"
    unit_number = 5
    status = "assigned"
```

**مهم:** القارئ يمكن أن يكون في `managed_reader_profiles` بدون أن يكون في أي ختمة (أو العكس إذا أُضيف يدوياً للختمة بدون ربط بالملف الشخصي).

---

### الفرق بين المعرّفات

| المعرّف | مكانه | الاستخدام |
|---------|--------|-----------|
| `reader_profile_id` | `managed_reader_profiles.id` | معرّف عالمي للقارئ في دفتر القراء |
| `participant_id` | `managed_khatma_participants.id` | معرّف القارئ داخل ختمة محددة |
| `access_code` | في كلا الجدولين | كود الدخول — يُستخدم في بوابة القارئ وفي إكمال القراءة |
| `serial_code` | `managed_reader_profiles.serial_code` | `R-XXXXXX` — للعرض والبحث فقط، لا يُستخدم لإكمال القراءة |
| `phone` | في كلا الجدولين | للبحث في بوابة القارئ |

---

### كيف تظهر الأجزاء في بوابة القارئ

```
الخطوة 1: البحث
POST /api/reader-portal {identity: "1234567890"}
    ↓
readerPortal() يبحث في managed_khatma_participants
بشروط: access_code = ? OR phone = ? OR participant_name = ?
    ↓
يجد: mpart_xyz في ختمة mkhatma_abc

الخطوة 2: جلب أجزائه
getManagedKhatmaParticipantView(DB, "mkhatma_abc", participantRow)
    ↓
SQL: SELECT * FROM managed_khatma_units
     WHERE khatma_id = 'mkhatma_abc'
     AND participant_id IN ('mpart_xyz')
    ↓
يُرجع: الأجزاء المُعيَّنة له فقط
```

**لماذا أحياناً يكون القارئ مضافاً بلا أجزاء؟**
- المشارك موجود في `managed_khatma_participants` (مثلاً `mpart_xyz`)
- لكن لا يوجد أي صف في `managed_khatma_units` حيث `participant_id = 'mpart_xyz'`
- الحل: المنشئ يجب أن **يُعيّن الأجزاء يدوياً** للقارئ من لوحة الإدارة

**كيف تفحص من قاعدة البيانات:**
```sql
-- هل للقارئ أجزاء مُعيَّنة؟
SELECT u.unit_number, u.status, u.participant_id
FROM managed_khatma_units u
WHERE u.participant_id = 'mpart_xyz';

-- ما هو participant_id للقارئ؟
SELECT id, participant_name, access_code
FROM managed_khatma_participants
WHERE access_code = '1234567890';
```

---

## 7. منطق التدوير والتواريخ

### أنواع الختمات

#### الدورية (Periodic)

| النوع | `khatma_type` | مدة الدورة |
|-------|--------------|-----------|
| أسبوعية | `weekly` | 7 أيام |
| شهرية | `monthly` | نهاية الشهر الهجري |
| سنوية | `yearly` | سنة ميلادية كاملة |

#### غير الدورية (Non-periodic)

| النوع | `khatma_type` | نهاية الختمة |
|-------|--------------|------------|
| خاصة | `special` | يدوي |
| منفصلة | `separate` | يدوي |
| فرعية | `sub` | يدوي |
| محددة | `specific` | يدوي |

---

### الحقول الزمنية

| الحقل | المكان | المعنى |
|-------|--------|-------|
| `khatma_date` | `managed_khatmas` | التاريخ الرسمي لبدء الختمة (يُعلَن للقراء) |
| `rotation_start_date` | `managed_khatmas` | تاريخ بدء الدورة الأولى (يساوي `khatma_date` في الغالب) |
| `expires_at` | `managed_khatmas` | نهاية الدورة الحالية — **يُعاد حسابه في كل GET** |
| `created_at` | `managed_khatmas` | تاريخ الإنشاء في النظام |
| `archived_at` | `managed_khatmas` | تاريخ الأرشفة (NULL = نشطة) |

---

### الفرق بين نهاية الدورة ونهاية الختمة

- **نهاية الدورة** (`expiresAt`): تنتهي الدورة الحالية (الأسبوع الأول، الشهر الهجري الأول...). تُعاد تلقائياً في الدورة القادمة.
- **نهاية الختمة**: يُغلق المنشئ الختمة يدوياً (`toggle-close`) أو تكتمل 100%.

---

### أين توجد دوال الحساب

| الدالة | الملف | السطر | الغرض |
|--------|-------|-------|-------|
| `computeRotationPeriodEnd()` | `[[path]].js` | 46 | حساب نهاية الدورة (backend) — يُرجع `Date` |
| `hijriMonthEndDateServer()` | `[[path]].js` | 30 | نهاية الشهر الهجري (server) |
| `mapManagedKhatma()` | `[[path]].js` | 882 | يستدعي `computeRotationPeriodEnd` ويُضمّن النتيجة في `expiresAt` |
| `computeCurrentPeriodEnd()` | `app.js` | 1225 | حساب نهاية الدورة (frontend) — يُرجع `Date` |
| `computeCurrentPeriodIndex()` | `app.js` | 1257 | رقم الدورة الحالية (0 = الأولى) |
| `formatPeriodEnd()` | `app.js` | 1291 | تنسيق التاريخ للعرض مع عدد الأيام المتبقية |
| `khatmaHasStarted()` | `app.js` | 1338 | هل بدأت الختمة؟ |
| `parseDateOnlyLocal()` | `app.js` | ~1305 | يُحوّل "YYYY-MM-DD" إلى تاريخ محلي (لا UTC) |
| `startOfLocalDay()` | `app.js` | ~1310 | منتصف ليل اليوم بالتوقيت المحلي |
| `countdownHtml()` | `app.js` | 3523 | HTML للعد التنازلي في بطاقة الإدارة |

---

### منطق كل نوع (Backend)

#### أسبوعية (`weekly`)

```js
// في computeRotationPeriodEnd (سطر 56–65)
const start = new Date(rotationStartDate); // UTC midnight
const idx = Math.max(0, Math.floor((now - start) / (7 * 86400000)));
// idx = 0 للختمات المستقبلية أو في الأسبوع الأول
const end = new Date(start);
end.setUTCDate(start.getUTCDate() + (idx + 1) * 7 - 1);
// نهاية اليوم = 23:59:59 بتوقيت السعودية = 20:59:59 UTC
end.setUTCHours(20, 59, 59, 999);
```

**مثال:** start = 2026-06-27 → end = 2026-07-03T20:59:59Z = السعودية: 3 يوليو 23:59

#### شهرية (`monthly`)

```js
// في computeRotationPeriodEnd (سطر 49–55)
const refDate = (!isNaN(start) && start > now) ? start : now;
// إذا الختمة مستقبلية: استخدم start، وإلا: استخدم اليوم
return hijriMonthEndDateServer(refDate);
// يُرجع آخر يوم من الشهر الهجري الحالي عند الساعة 20:59:59 UTC
```

**مثال:** start = 2026-06-16 (مستقبلية) → نهاية الشهر الهجري لشهر يونيو 2026

#### سنوية (`yearly`)

```js
// في computeRotationPeriodEnd (سطر 66–83)
const start = new Date(rotationStartDate);
let idx = 0;
const ref = new Date(start);
// عدّ السنوات الكاملة الماضية منذ البداية
while (true) {
  ref.setUTCFullYear(ref.getUTCFullYear() + 1);
  if (ref <= now) idx++;
  else break;
}
const end = new Date(start);
end.setUTCFullYear(start.getUTCFullYear() + idx + 1);
end.setUTCDate(end.getUTCDate() - 1); // يوم قبل نفس تاريخ السنة القادمة
end.setUTCHours(20, 59, 59, 999);
```

**مثال:** start = 2026-06-08 → end = 2027-06-07T20:59:59Z = السعودية: 7 يونيو 2027 23:59

---

### منطق النوع في Frontend

#### أسبوعية

```js
// في computeCurrentPeriodEnd (سطر 1235–1243)
const start = parseDateOnlyLocal(rotationStartDate); // منتصف ليل محلي
const idx = computeCurrentPeriodIndex(rotationStartDate, 'weekly');
const end = new Date(start);
end.setDate(start.getDate() + (idx + 1) * 7 - 1);
// يُعيد تاريخاً محلياً — يعرضه formatPeriodEnd كـ "3 يوليو"
```

**ملاحظة:** Frontend يستخدم التوقيت المحلي للمتصفح. Backend يستخدم UTC. كلاهما يُعطي نفس **اليوم** لكن مع فارق طبيعي في الوقت (UTC+3 يُضيف 3 ساعات).

---

### مشاكل Timezone التي أُصلحت

| المشكلة | السبب | الإصلاح |
|---------|-------|---------|
| **Weekly** يُعطي July 7 بدلاً من July 3 | `start + 7*86400000 - 1s` = UTC midnight يُترجَم لـ Saudi 02:59 | استبدل بـ `setUTCDate()` + `setUTCHours(20,59,59,999)` |
| **Yearly** يُعطي "غير محدد" | لم يكن هناك منطق yearly في `computeRotationPeriodEnd` | أُضيف فرع yearly كامل |
| **Monthly** كانت تستخدم `today` لختمات مستقبلية | `refDate = now` دائماً | `refDate = (!isNaN(start) && start > now) ? start : now` |

---

### أمثلة عملية

| النوع | تاريخ البداية | نهاية الدورة الأولى (Saudi) |
|-------|-------------|--------------------------|
| أسبوعية | 2026-06-08 | 2026-06-14 23:59 |
| أسبوعية | 2026-06-27 | 2026-07-03 23:59 |
| شهرية | 2026-06-16 | ~2026-07-14 23:59 (نهاية الشهر الهجري) |
| سنوية | 2026-06-08 | 2027-06-07 23:59 |

---

## 8. دفتر القراء (Reader Registry)

### `serial_code`

- شكله: `R-000001`، `R-000042`، إلخ
- فريد عالمياً في جدول `managed_reader_profiles`
- يُولَّد تلقائياً عند إنشاء القارئ بـ: `'R-' || PRINTF('%06d', COUNT(*) + 1)`
- غير قابل للتعديل يدوياً (يجب الحذر)
- **لا يُستخدم لإكمال القراءة** — يُستخدم للعرض والبحث فقط
- عند البحث بـ serial_code في بوابة القارئ: يرى القارئ ختماته لكن **لا يستطيع** الضغط على "تمت القراءة"

### `access_code`

- 10 أرقام (مثل `1234567890`)
- فريد لكل منشئ (UNIQUE constraint: `created_by_user_id + access_code`)
- يُستخدم للبحث في بوابة القارئ **وللتحقق عند إكمال القراءة**

### كيف يتم توليد `serial_code`

```sql
-- عند إنشاء قارئ جديد (في upsertManagedReaders)
UPDATE managed_reader_profiles
SET serial_code = 'R-' || PRINTF('%06d', (
  SELECT COUNT(*) + 1
  FROM managed_reader_profiles AS m2
  WHERE m2.status != 'deleted'
    AND (m2.created_at < managed_reader_profiles.created_at
      OR (m2.created_at = managed_reader_profiles.created_at
          AND m2.id < managed_reader_profiles.id))
))
WHERE serial_code IS NULL AND status != 'deleted';
```

هذا الـ backfill موجود أيضاً في migration `015_add_reader_registry_fields.sql`.

### مشاكل شائعة في دفتر القراء

| المشكلة | السبب | الفحص |
|---------|-------|-------|
| serial_code لا يظهر | migration 015 لم يُطبَّق | `npx wrangler d1 execute toallah_db --remote --command "SELECT serial_code FROM managed_reader_profiles LIMIT 5"` |
| country لا يُحفظ | migration 015 لم يُطبَّق أو حقل country غير موجود | نفس الأمر أعلاه، أضف `country` للنتيجة |
| القارئ لا يظهر في البحث | `status = 'deleted'` | `SELECT * FROM managed_reader_profiles WHERE reader_name = 'الاسم'` |

---

## 9. بوابة القارئ (Reader Portal)

### كيف يسجّل القارئ دخوله

1. يذهب لـ `#/reader-login`
2. يُدخل أياً من: كود الدخول (access_code) / رقم الجوال / الاسم الكامل / serial_code
3. الهوية تُحفَظ في `localStorage.reader_portal_identity` للاستخدام القادم
4. `POST /api/reader-portal {identity: "..."}` يُرسَل للسيرفر

### ترتيب البحث في السيرفر

```
1. هل identity يطابق نمط R-XXXXXX؟
   → يبحث في managed_reader_profiles.serial_code
   → view-only: لا يُعطي صلاحية إكمال القراءة

2. هل identity كود 10 أرقام صالح؟
   → يبحث في managed_khatma_participants.access_code

3. هل identity رقم جوال (≥9 أرقام)؟
   → يبحث في managed_khatma_participants.phone (بعد تطبيع الرقم)

4. هل identity اسم (≥2 حروف)؟
   → يبحث في managed_khatma_participants.participant_name (تطابق تام)
```

### إذا عنده ختمة واحدة

- يُعرض له مباشرة محتوى الختمة (أجزاؤه، حالتها)
- لا يُعاد التوجيه تلقائياً — القائمة تظهر مع بطاقة واحدة

### إذا عنده أكثر من ختمة

- تُعرض قائمة ببطاقات، كل بطاقة ختمة واحدة
- يضغط على ختمة → يذهب لـ `#/reader-khatma/{id}`

### كيف تعمل صفحة `reader-khatma`

**الدالة:** `setupReaderKhatma(khatmaId)` سطر 1917 في `app.js`

```
1. يُعيد إرسال POST /api/reader-portal لجلب بيانات الختمة المحددة
2. يجد الختمة من النتائج (khatmas.find(k => k.id === khatmaId))
3. يتحقق من khatmaHasStarted(rotationStartDate) — هل بدأت؟
   - لم تبدأ → يعرض "الختمة لم تبدأ بعد. تبدأ في: ..."
   - بدأت لكن لا أجزاء → يعرض "أنت مضاف ولكن لم تُعيَّن لك أجزاء بعد."
   - بدأت وعنده أجزاء → يعرض الأجزاء مع أزرار الحالة
```

### كيف يعمل زر "تمت القراءة"

1. القارئ يضغط "تمت القراءة" على جزء
2. يُطلب منه إدخال كوده للتحقق (access_code أو phone)
3. `POST /api/managed-khatmas/{id}/units/{num}/complete {identity: "..."}`
4. السيرفر يتحقق: هل `identity` يطابق `access_code` أو `phone` للمشارك المُعيَّن لهذا الجزء؟
5. إذا نجح: `managed_khatma_units.status = 'completed'`، `completed_at = now()`

### لماذا serial_code لا يُستخدم لتأكيد الإكمال

- `serial_code` (`R-XXXXXX`) هو للعرض والبحث فقط
- التحقق عند الإكمال يتطلب `access_code` (10 أرقام) أو `phone`
- هذا لأن serial_code عام وقد يُشارَك، بينما access_code سري

### أين أفحص إذا قال القارئ: "لا تظهر ختمتي"

```sql
-- 1. تحقق من وجوده كمشارك
SELECT id, khatma_id, participant_name, access_code, phone
FROM managed_khatma_participants
WHERE access_code = 'XXXXXXXXXX' OR phone = '05XXXXXXXX';

-- 2. هل الختمة محذوفة؟
SELECT id, title, deleted_at, status
FROM managed_khatmas
WHERE id = 'mkhatma_...';

-- 3. هل تطابق الاسم صحيح؟
SELECT participant_name FROM managed_khatma_participants
WHERE participant_name LIKE '%الاسم%';
```

### أين أفحص إذا قال القارئ: "لا تظهر أجزائي"

```sql
-- هل له أجزاء مُعيَّنة؟
SELECT u.unit_number, u.status, u.participant_id
FROM managed_khatma_units u
WHERE u.participant_id = 'mpart_...'
ORDER BY u.unit_number;

-- ما هو participant_id بدقة؟
SELECT id FROM managed_khatma_participants
WHERE access_code = 'XXXXXXXXXX' AND khatma_id = 'mkhatma_...';
```

**السبب الأكثر شيوعاً:** الوحدات لا تحتوي على `participant_id` — المشارك مُضاف لكن الأجزاء لم تُعيَّن.

### أين أفحص إذا قال: "لا أستطيع إتمام القراءة"

```sql
-- هل الجزء مُعيَّن له؟
SELECT unit_number, status, participant_id
FROM managed_khatma_units
WHERE khatma_id = 'mkhatma_...' AND unit_number = X;

-- هل access_code الذي يُدخله يطابق المُعيَّن؟
SELECT access_code, phone FROM managed_khatma_participants
WHERE id = 'mpart_...';
```

---

## 10. المشاركة مع منشئي الختمات

### كيف يشارك المالك ختمة مع منشئ

1. المالك يذهب لصفحة الختمة
2. يضغط "مشاركة مع مجموعة منشئين"
3. `POST /api/managed-khatmas/{id}/admin/share {creatorGroupId: "mcg_..."}`
4. السيرفر يُضبط `managed_khatmas.shared_creator_group_id = 'mcg_...'`

### ما هو `shared_creator_group_id`

حقل في `managed_khatmas`. عندما يكون مُعيَّناً:
- كل منشئ عضو في مجموعة `managed_creator_groups` ذات المعرّف هذا
- يرى الختمة في قائمته (`listManagedKhatmas`)
- تُحسَب في إحصائياته (`dashboardStats`)

### كيف تظهر الختمة في قائمة المنشئ

في `listManagedKhatmas`:

```sql
WHERE deleted_at IS NULL
  AND (
    mk.created_by_user_id IN (:memberIds)       -- ختمات أعضاء مجموعته
    OR (mk.shared_creator_group_id IS NOT NULL
        AND mk.shared_creator_group_id IN (:userGroupIds)) -- الختمات المشتركة معه
  )
```

### الفرق بين الختمة التي أنشأها المنشئ والمشتركة معه

| الفئة | `created_by_user_id` | `shared_creator_group_id` |
|-------|---------------------|--------------------------|
| الختمة الخاصة | = user.id | NULL |
| الختمة المشتركة | ≠ user.id (owner أو منشئ آخر) | mcg_... |

**مهم:** المنشئ يرى الختمات المشتركة لكنه **لا يملكها** — قد تكون هناك قيود على التعديل.

### أين أفحص إذا لم تظهر في الإحصائيات

```sql
-- تحقق من أن shared_creator_group_id مضبوط
SELECT id, title, shared_creator_group_id
FROM managed_khatmas
WHERE id = 'mkhatma_...';

-- تحقق من أن المنشئ عضو في المجموعة
SELECT * FROM managed_creator_group_members
WHERE user_id = 'user_...' AND group_id = 'mcg_...';
```

---

## 11. Dashboard و Monitor

### الفرق بين Dashboard و Monitor

| الوجهة | Route | Setup | الهدف |
|--------|-------|-------|-------|
| **Dashboard** | `#/dashboard` | `setupDashboard()` سطر 2637 | ملخص إحصائي بصري (charts، top readers) |
| **Monitor** | `#/managed-monitor` | `setupManagedMonitor()` سطر 2254 | جدول تفصيلي لكل الختمات وتقدم كل مشارك |

---

### Dashboard — ما يحسبه

**API:** `GET /api/dashboard-stats`  
**الدالة:** `dashboardStats()` سطر 2229

| المقياس | المصدر في DB |
|---------|------------|
| عدد الختمات (كل/نشطة/مؤرشفة) | `COUNT` من `managed_khatmas` |
| الختمات بالنوع (weekly/monthly/yearly) | `SUM(CASE WHEN khatma_type = '...')` |
| الوحدات (كل/مكتملة/جاري/متاحة) | `COUNT` من `managed_khatma_units JOIN managed_khatmas` |
| عدد القراء | `COUNT` من `managed_reader_profiles WHERE status != 'deleted'` |
| عدد المجموعات | `COUNT` من `managed_reader_groups WHERE status != 'deleted'` |
| أفضل القراء (Top 10) | `GROUP BY participant_name ORDER BY COUNT(*) DESC` في `managed_khatma_units` |
| الاتجاه الشهري | `GROUP BY strftime('%Y-%m', completed_at)` آخر 6 أشهر |

**نطاق الإحصائيات:**
- **owner:** كل الختمات
- **creator:** ختمات أعضاء مجموعته + الختمات المشتركة معه

---

### Monitor — ما يعرضه

- **دالة:** `setupManagedMonitor()` سطر 2254
- يعرض جدولاً بكل الختمات مع تفاصيل كل مشارك وعدد أجزائه المكتملة
- مُجمَّع من نفس جداول `managed_khatmas` + `managed_khatma_units` + `managed_khatma_participants`

---

## 12. PWA — التطبيق التقدمي

### Manifest

**الملف:** `public/manifest.webmanifest`

```json
{
  "name": "إلى الله",
  "display": "standalone",
  "start_url": "/?source=pwa",
  "theme_color": "#0f5f45",
  "icons": [
    { "src": "/icons/icon-192x192.png", "sizes": "192x192", "purpose": "any" },
    { "src": "/icons/maskable-192x192.png", "purpose": "maskable" }
  ]
}
```

---

### Service Worker

**الملف:** `public/service-worker.js`  
**Cache Name:** `toallah-pwa-v1`

| نوع الملف | الاستراتيجية |
|----------|-------------|
| `/api/*` | **لا تخزين أبداً** (Network only) |
| Navigation (HTML pages) | **Network First** + fallback لـ `index.html` |
| App Shell (index.html, app.js, styles.css...) | **Cache First** |
| `/icons/*` | **Cache First + Cache on Fetch** |
| باقي الملفات | **Network only** |

---

### تثبيت على Android

1. افتح الموقع في Chrome
2. ظهر banner "إضافة إلى الشاشة الرئيسية" تلقائياً أو من قائمة Chrome → "تثبيت التطبيق"
3. يستخدم `icons/maskable-512x512.png` كأيقونة

### تثبيت على iPhone (Add to Home Screen)

1. افتح في Safari
2. زر المشاركة → "إضافة إلى الشاشة الرئيسية"
3. يستخدم `apple-touch-icon.png`

---

### ما الذي يُكاش وما لا يُكاش

| يُكاش | لا يُكاش |
|-------|---------|
| `index.html` | `/api/*` (دائماً شبكة) |
| `app.js` | Google Fonts (خارجي) |
| `styles.css` | أي ملف غير في APP_SHELL |
| `manifest.webmanifest` | |
| `apple-touch-icon.png` | |
| `/icons/icon-192x192.png` | |
| `/icons/icon-512x512.png` | |

---

### كيف أفحص مشاكل PWA

```
Chrome DevTools → Application → Service Workers
→ تحقق من: Activated and running

Chrome DevTools → Application → Cache Storage
→ تحقق من: toallah-pwa-v1 يحتوي على الملفات

إذا الموقع يعرض نسخة قديمة:
1. DevTools → Application → Service Workers → "Unregister"
2. Shift+Ctrl+R (Hard Reload)
3. أو: DevTools → Application → Storage → "Clear site data"
```

---

## 13. النشر والتشغيل

### مهم جداً: Push وحده لا يكفي!

المشروع **لا يستخدم CI/CD تلقائي**. Push إلى Git لا يُنشر تلقائياً على Cloudflare Pages.  
**النشر يدوي دائماً.**

```
git push origin main     ← يُحدّث GitHub فقط
npx wrangler pages deploy ← يُنشر على Cloudflare (ضروري!)
```

---

### أوامر الفحص

```powershell
# فحص صياغة JavaScript
node --check '.\public\app.js'
node --check '.\functions\api\[[path]].js'

# فحص مشاكل whitespace في Git
git diff --check

# حالة الملفات
git status --short

# فحص diff
git diff 'functions/api/[[path]].js'
```

---

### أوامر Commit وPush

```powershell
# إضافة الملفات (اذكر الملفات بالاسم، لا git add -A)
git add 'functions/api/[[path]].js'
git add public/app.js

# Commit
git commit -m "وصف التغيير"

# Push
git push origin main
```

---

### أوامر النشر على Cloudflare Pages

```powershell
# النشر (يُرفع كل محتوى مجلد public/)
npx wrangler pages deploy .\public --project-name toallah
```

**بعد النشر:** تحقق من Dashboard Cloudflare أو بزيارة الموقع.

---

### أوامر D1 Database

```powershell
# تشغيل استعلام مباشر على DB البعيد
npx wrangler d1 execute toallah_db --remote --command "SELECT COUNT(*) FROM managed_khatmas"

# تطبيق migration جديد
npx wrangler d1 migrations apply toallah_db --remote

# تطبيق migration محلياً (للاختبار)
npx wrangler d1 migrations apply toallah_db --local

# رؤية قائمة الـ migrations المُطبَّقة
npx wrangler d1 migrations list toallah_db --remote

# تشغيل dev server محلي
npx wrangler pages dev
```

---

### أوامر التشخيص

```powershell
# جلب آخر 10 ختمات مُدارة
npx wrangler d1 execute toallah_db --remote --command "SELECT id, title, khatma_type, khatma_date, rotation_start_date, expires_at FROM managed_khatmas WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 10"

# البحث عن قارئ بالاسم
npx wrangler d1 execute toallah_db --remote --command "SELECT id, reader_name, access_code, serial_code, phone FROM managed_reader_profiles WHERE reader_name LIKE '%الاسم%'"

# أجزاء مُعيَّنة لمشارك معين
npx wrangler d1 execute toallah_db --remote --command "SELECT unit_number, status, participant_id FROM managed_khatma_units WHERE khatma_id = 'mkhatma_...' AND participant_id IS NOT NULL ORDER BY unit_number"

# فحص صحة قاعدة البيانات
npx wrangler d1 execute toallah_db --remote --command "SELECT COUNT(*) as users FROM users; SELECT COUNT(*) as khatmas FROM managed_khatmas WHERE deleted_at IS NULL; SELECT COUNT(*) as readers FROM managed_reader_profiles WHERE status != 'deleted'"
```

---

## 14. دليل المشاكل (Troubleshooting)

| المشكلة | أين أفحص | السبب المحتمل | الحل |
|---------|----------|--------------|------|
| **الموقع لا يعرض آخر نسخة** | Chrome DevTools → Network → فحص `app.js` | Service Worker يقدّم نسخة قديمة من cache | افتح DevTools → Application → Service Workers → Unregister ثم Shift+Ctrl+R |
| **Service Worker يعرض نسخة قديمة** | DevTools → Application → Cache Storage | `CACHE_NAME = "toallah-pwa-v1"` لم يتغير بعد نشر جديد | غيّر اسم الـ cache في `service-worker.js` إلى `toallah-pwa-v2` ثم أعد النشر |
| **القارئ لا يرى الختمة** | `managed_khatma_participants` | access_code أو phone خاطئ، أو الختمة `deleted_at IS NOT NULL` | `SELECT * FROM managed_khatma_participants WHERE access_code = 'XXXX'` |
| **القارئ لا يرى الأجزاء** | `managed_khatma_units` | `participant_id IS NULL` — لم تُعيَّن أجزاء | أعد تعيين الأجزاء من لوحة الإدارة |
| **زر تمت القراءة لا يعمل** | `managed_khatma_units.participant_id` + `managed_khatma_participants.access_code` | الكود المُدخَل لا يطابق المُعيَّن للجزء | تحقق من access_code في الجدولين |
| **"الختمة لم تبدأ بعد" خطأ** | `khatma_date` في `managed_khatmas` | الكود يتحقق من `khatmaHasStarted(khatmaDate)` | تحقق من تاريخ `khatma_date` هل هو في المستقبل فعلاً؟ |
| **تاريخ النهاية خاطئ** | `mapManagedKhatma()` سطر 882 في `[[path]].js` | خلل في `computeRotationPeriodEnd()` أو قيمة `rotation_start_date` خاطئة | `SELECT rotation_start_date, expires_at FROM managed_khatmas WHERE id = '...'` |
| **الأسبوعية تنتهي في غير اليوم الصحيح** | `computeRotationPeriodEnd` فرع weekly سطر 56 | `rotation_start_date` يختلف عن `khatma_date` | `SELECT khatma_date, rotation_start_date FROM managed_khatmas WHERE id = '...'` |
| **الشهرية تعرض تاريخاً غير منطقي** | `hijriMonthEndDateServer()` سطر 30 | الحساب الهجري يعتمد على `Intl.DateTimeFormat` | تحقق من `rotation_start_date` وتأكد أن الحساب يستخدم `start` لا `today` للختمات المستقبلية |
| **السنوية تعرض "غير محدد"** | `mapManagedKhatma()` سطر 890 | `rotation_start_date` = NULL في DB | `UPDATE managed_khatmas SET rotation_start_date = khatma_date WHERE khatma_type = 'yearly' AND rotation_start_date IS NULL` |
| **الختمة المشتركة لا تظهر للمنشئ** | `shared_creator_group_id` في `managed_khatmas` | الحقل NULL أو المنشئ ليس عضواً في المجموعة | `SELECT shared_creator_group_id FROM managed_khatmas WHERE id = '...'` + `SELECT * FROM managed_creator_group_members WHERE user_id = '...'` |
| **Dashboard لا يحسب الختمات المشتركة** | `dashboardStats()` سطر 2229 | نفس سبب الختمة المشتركة | تحقق من `userGroupIds` و`memberIds` في الدالة |
| **serial_code لا يظهر** | `managed_reader_profiles.serial_code` | migration 015 لم يُطبَّق | `npx wrangler d1 migrations apply toallah_db --remote` |
| **country لا يُحفظ** | `managed_reader_profiles.country` | migration 015 لم يُطبَّق | نفس الأمر أعلاه |
| **migration فشل** | `npx wrangler d1 migrations list` | migration طُبِّق جزئياً أو هناك خطأ SQL | افحص رسالة الخطأ؛ يمكن تشغيل SQL يدوياً بـ `--command` |
| **Deploy نجح لكن الموقع لم يتغير** | Cloudflare Dashboard | Service Worker يُقدّم cache قديم | انظر مشكلة "الموقع لا يعرض آخر نسخة" |
| **D1 فيه بيانات غير متوقعة** | wrangler execute مباشرة | نسخ احتياطي بيانات قديمة أو اختبار | استخدم `GET /api/system-backup` لأخذ نسخة قبل أي تعديل |
| **خطأ 500 من API** | `[[path]].js` → `catch (error)` آخر الملف | استثناء غير متوقع | راجع Cloudflare Workers Logs من Dashboard |
| **login_attempts فيه بيانات كثيرة** | جدول `login_attempts` | محاولات تسجيل دخول فاشلة | يُنظَّف تلقائياً كل ساعة؛ أو `DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')` |

---

## 15. Smoke Test بعد أي نشر

قم بهذه الاختبارات بالترتيب بعد كل نشر جديد:

### ☐ 1. الصفحة الرئيسية
- [ ] تفتح الموقع → يظهر الـ home page بشكل صحيح
- [ ] الشعار، الألوان، الخط العربي تظهر صحيحاً

### ☐ 2. تسجيل دخول Owner
- [ ] `#/login` → تُدخل بيانات المالك
- [ ] تنتقل للوحة التحكم
- [ ] `#/owner` يُعرض مع قائمة المستخدمين

### ☐ 3. تسجيل دخول Creator
- [ ] تسجيل دخول بحساب creator
- [ ] تظهر قائمة الختمات (`#/managed-khatmas`)
- [ ] لا تظهر `#/owner` ولا `#/khatmas` (الختمات العادية)

### ☐ 4. إنشاء قارئ في دفتر القراء
- [ ] `#/managed-readers` → إضافة قارئ جديد
- [ ] يظهر `serial_code` بشكل `R-XXXXXX`
- [ ] حفظ `country`

### ☐ 5. إنشاء ختمة أسبوعية
- [ ] `#/managed-create` → نوع = أسبوعية، تاريخ بداية = اليوم أو قريباً
- [ ] بعد الإنشاء، افتح الختمة → تظهر `expiresAt` صحيحة (= start + 6 أيام)
- [ ] تاريخ الانتهاء في بطاقة الإدارة = start + 6 أيام 23:59

### ☐ 6. إنشاء ختمة شهرية
- [ ] نوع = شهرية → تاريخ الانتهاء = نهاية الشهر الهجري الحالي/القادم

### ☐ 7. إنشاء ختمة سنوية
- [ ] نوع = سنوية → تاريخ الانتهاء = start + سنة - 1 يوم

### ☐ 8. ربط أجزاء يدوياً
- [ ] افتح ختمة → لوحة الإدارة → عيّن جزءاً لقارئ
- [ ] تأكد من ظهور اسم القارئ على الجزء

### ☐ 9. بوابة القارئ
- [ ] `#/reader-login` → أدخل كود أو جوال القارئ
- [ ] تظهر الختمة مع الأجزاء المُعيَّنة
- [ ] إذا لم تظهر أجزاء → رسالة واضحة
- [ ] إذا الختمة مستقبلية → "لم تبدأ بعد. تبدأ في..."

### ☐ 10. إتمام القراءة
- [ ] في بوابة القارئ → اضغط "تمت القراءة" على جزء
- [ ] أدخل الكود للتحقق
- [ ] يتغير status الجزء لـ `completed`

### ☐ 11. Dashboard
- [ ] `#/dashboard` يُحمَّل بالإحصائيات الصحيحة
- [ ] أعداد الختمات/القراء منطقية
- [ ] رسوم بيانية تظهر

### ☐ 12. المشاركة مع منشئ
- [ ] من لوحة المالك → شارك ختمة مع مجموعة منشئين
- [ ] سجّل دخول بحساب المنشئ → تظهر الختمة المشتركة

### ☐ 13. PWA
- [ ] في Chrome → DevTools → Application → Service Workers → "Activated and running"
- [ ] Cache Storage يحتوي على `toallah-pwa-v1`
- [ ] `/api/` غير مخزَّن في cache
- [ ] على Android: ظهور "إضافة إلى الشاشة الرئيسية"

---

## 16. ملاحظات صيانة مستقبلية

### 1. إحصائيات القارئ الشخصية (غير مُنفَّذة)

**الهدف:** عرض عدد الختمات التي أكملها القارئ وعدد الأجزاء:
- كل 30 جزء مكتمل = ختمة مكتملة واحدة
- عرض: "أكملت X ختمة" في بوابة القارئ

**أين تُنفَّذ:** `readerPortal()` في `[[path]].js` + `setupReaderKhatma()` في `app.js`

**المصدر:** `managed_khatma_units WHERE participant_id IN (...) AND status = 'completed'`

---

### 2. تحسين رسالة القارئ المضاف بلا أجزاء

**الحالة الحالية:** تُعرض "لا توجد أجزاء مُعيَّنة لك في هذه الختمة."  
**المقترح:** "أنت مضاف في هذه الختمة، لكن لم تُعيَّن لك أجزاء بعد. يُرجى مراجعة منسق الختمة."

**أين تُنفَّذ:** `setupReaderKhatma()` سطر 1917 في `app.js` — قسم عرض الأجزاء الفارغة.

---

### 3. توحيد Dashboard و Monitor

**الحالة الحالية:** صفحتان منفصلتان بمعلومات متداخلة  
**المقترح:** دمج أو ربط أفضل بين `#/dashboard` و`#/managed-monitor`

---

### 4. تحسين نظام التقارير

**الحالة الحالية:** `setupReports()` (سطر 2408) يُعرض للمالك فقط  
**المقترح:** إتاحة تقارير أساسية للمنشئين أيضاً

---

### 5. تحسين النسخ الاحتياطي التلقائي

**الحالة الحالية:** النسخ يدوي عبر `GET /api/system-backup`  
**المقترح:** جدولة نسخ احتياطية تلقائية أو تنبيهات دورية

---

### 6. البحث بالاسم الجزئي في بوابة القارئ

**الحالة الحالية:** البحث بالاسم يتطلب تطابقاً تاماً (`participant_name = ?`)  
**المقترح:** استخدام `LIKE '%name%'` مع تحسينات أمانية

---

### 7. تطبيع `rotation_start_date` تلقائياً

**الحالة الحالية:** إذا أنشأ المنشئ ختمة ولم يُرسل `rotationStartDate` صراحةً، استُخدم `khatmaDate` (بعد إصلاح session الحالية)  
**المقترح:** التحقق من أن جميع الختمات القديمة عندها `rotation_start_date` صحيح:

```sql
-- فحص الختمات الدورية بدون rotation_start_date
SELECT id, title, khatma_type, khatma_date, rotation_start_date
FROM managed_khatmas
WHERE khatma_type IN ('weekly', 'monthly', 'yearly')
  AND deleted_at IS NULL
  AND (rotation_start_date IS NULL OR rotation_start_date = '');

-- إصلاح (إذا لزم):
UPDATE managed_khatmas
SET rotation_start_date = khatma_date
WHERE khatma_type IN ('weekly', 'monthly', 'yearly')
  AND deleted_at IS NULL
  AND (rotation_start_date IS NULL OR rotation_start_date = '')
  AND khatma_date IS NOT NULL AND khatma_date != '';
```

---

### 8. تحسين تجربة تسجيل القراء الجماعي

**الحالة الحالية:** يمكن رفع CSV لاستيراد قراء دفعة واحدة (`importManagedCsvIntoForm`)  
**المقترح:** تحسين تنسيق CSV وإضافة validation أفضل

---

### 9. صلاحيات أكثر مرونة للمنشئين

**الحالة الحالية:** creator إما يرى كل شيء أو لا شيء من ختمة مشتركة  
**المقترح:** صلاحيات أكثر دقة (عرض فقط vs. تعديل)

---

### 10. Cache Busting للـ Service Worker

**الحالة الحالية:** عند نشر نسخة جديدة، المستخدم قد يرى نسخة قديمة حتى يُحدَّث SW  
**المقترح:** تغيير `CACHE_NAME` في `service-worker.js` مع كل نشر (مثلاً: استخدام timestamp)

---

*نهاية الوثيقة*

---

**آخر تحديث:** يونيو 2026  
**المشروع:** إلى الله (ToAllah)  
**الكود المرجعي:** `functions/api/[[path]].js` + `public/app.js`
