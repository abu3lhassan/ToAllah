# درب الزهراء للختمات - Cloudflare D1 Version

هذه النسخة مبنية على v0.6 المعتمدة، وتم تحويل التخزين من LocalStorage إلى Cloudflare D1 عبر API.

## الملفات المهمة

- `public/index.html` واجهة الموقع.
- `public/app.js` منطق الواجهة ويستدعي `/api`.
- `functions/api/[[path]].js` API يعمل كـ Cloudflare Pages Functions.
- `schema.sql` و `migrations/0001_init.sql` جداول D1.
- `wrangler.toml` إعداد Cloudflare Pages + D1.
- `worker/` نسخة Worker API منفصلة اختيارية إذا أردت نشر API مستقل.

## الأوامر المختصرة

1. تثبيت Wrangler إن لم يكن مثبتًا:

```powershell
npm install -g wrangler
wrangler login
```

2. إنشاء قاعدة D1:

```powershell
wrangler d1 create khatmat_darb_alzahra
```

انسخ `database_id` وضعه مكان:

```text
PUT_YOUR_D1_DATABASE_ID_HERE
```

في ملف `wrangler.toml`.

3. تطبيق الجداول:

```powershell
wrangler d1 execute khatmat_darb_alzahra --file=./schema.sql --remote
```

أو باستخدام migrations:

```powershell
wrangler d1 migrations apply khatmat_darb_alzahra --remote
```

4. تجربة محلية:

```powershell
wrangler pages dev public --d1 DB=khatmat_darb_alzahra
```

5. نشر Pages:

```powershell
wrangler pages deploy public --project-name khatmat-darb-alzahra
```

بعد النشر، تأكد من ربط D1 Binding باسم `DB` من إعدادات Cloudflare Pages إذا لم يلتقطها Wrangler تلقائيًا.

## الصلاحيات الحالية

- المشارك يدخل بالرابط ويحجز جزءًا أو يغير حالته إلى جاري القراءة أو تمت القراءة.
- إرجاع الجزء المكتمل إلى متاح يحتاج رمز الإدارة.
- إغلاق الختمة، إعادة فتحها، وحذفها يحتاج رمز الإدارة.
- رمز الإدارة يتولد عند إنشاء الختمة ويظهر لصاحبها فقط في نفس الجلسة.

## ملاحظات

- لا توجد Firebase.
- لا توجد حسابات مستخدمين بعد.
- الحذف في هذه النسخة Soft Delete: لا يظهر للمستخدمين لكنه يبقى في القاعدة.
- حاسبة زكاة الفطرة بقيت محلية في الواجهة لأنها لا تحتاج قاعدة بيانات.


## ملاحظات مهمة في هذه النسخة

- صفحة **ختماتي** تعرض الختمات التي أنشأها نفس المتصفح فقط عبر `ownerKey` محلي محفوظ في المتصفح.
- الرابط العام للختمة يفتح لأي مشارك، لكن القائمة العامة لا تعرض ختمات الآخرين.
- الإغلاق والحذف وإعادة فتح الختمة تحتاج رمز الإدارة.
- تم تنظيف بيانات النسخ المحلية القديمة من LocalStorage حتى لا تظهر ختمات تجريبية قديمة.

## تجربة محلية قبل النشر

1. ثبت Wrangler إن لم يكن مثبتًا:

```powershell
npm install -g wrangler
```

2. من مجلد المشروع:

```powershell
wrangler d1 execute khatmat_darb_alzahra --local --file=./schema.sql
wrangler pages dev public --d1 DB=khatmat_darb_alzahra
```

افتح الرابط الذي يظهر غالبًا مثل:

```text
http://localhost:8788
```

لو أردت مسح قاعدة التجربة المحلية وإعادة البداية، احذف مجلد `.wrangler` داخل المشروع ثم أعد تنفيذ أمر `d1 execute --local`.


## تصحيح مهم في v3

تم إصلاح مسار API الخاص بـ Cloudflare Pages Functions. في بعض بيئات `wrangler pages dev` يكون `params.path` نصًا وليس قائمة، وهذا كان يمنع إنشاء الختمة ويظهر في الواجهة كرسالة: `تعذر حفظ الختمة` أو `تعذر إنشاء الختمة`.

للتجربة المحلية من الصفر:

```powershell
cd C:\Users\Ali\Desktop\khatmat-darb-alzahra-cloudflare-v4
npm install
npx wrangler d1 execute khatmat_darb_alzahra --local --file=./schema.sql
npx wrangler pages dev public --d1 DB=khatmat_darb_alzahra
```

ثم افتح:

```text
http://localhost:8788
```

لا تفتح `public/index.html` مباشرة في نسخة Cloudflare؛ لأن إنشاء الختمة يحتاج API وD1 عبر Wrangler.


## إصلاح v4

تمت إضافة تهيئة تلقائية آمنة للجداول داخل الـ API نفسه. لذلك حتى لو كانت قاعدة D1 المحلية التي يستخدمها `pages dev` مختلفة عن القاعدة التي نفذ عليها `d1 execute --local`، سيقوم التطبيق بإنشاء الجداول تلقائيًا عند أول طلب.

للتجربة المحلية النظيفة:

```powershell
cd C:\Users\Ali\Desktop\khatmat-darb-alzahra-cloudflare-v4
npm install
npx wrangler pages dev public --d1 DB=khatmat_darb_alzahra
```

ثم افتح:

```text
http://127.0.0.1:8788
```

لم تعد محتاجًا لأمر `d1 execute --local` أثناء التجربة المحلية، لكنه ما زال موجودًا ومفيدًا للنشر أو الفحص اليدوي.


## v5 local note
هذه النسخة تنشئ جداول D1 تلقائيًا عند أول طلب API. للتجربة المحلية شغل فقط:

```powershell
npm install
npx wrangler pages dev public --d1 DB=khatmat_darb_alzahra
```

ثم افتح http://127.0.0.1:8788 وافحص /api/health إذا احتجت.
