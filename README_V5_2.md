# khatmat-darb-alzahra-cloudflare-v5-2

هذه نسخة إصلاح Cloudflare v5.2.

## الحساب الافتراضي
- اسم المستخدم: `abu3lzahra`
- كلمة المرور: `1234`

بعد تسجيل الدخول يظهر رابط **الإدارة** للمالك فقط.

## أهم الإصلاحات
- إصلاح الحجز.
- إصلاح جاري القراءة.
- إصلاح تمت القراءة.
- إصلاح إعادة الإتاحة.
- إصلاح حذف الختمة من كرت إدارة الختمة.
- إضافة رابط إدارة خاص لكل ختمة: `#/khatma/<id>/manage`.
- إخفاء الإدارة من صفحة المشاركة العامة.
- إضافة تسجيل دخول.
- إضافة لوحة إدارة مستخدمين للمالك فقط.
- إنشاء مستخدمين جدد.
- إعادة تعيين كلمة مرور المستخدمين.
- تفعيل/تعطيل المستخدمين.

## أوامر النشر

```powershell
cd C:\Users\Ali\Desktop\khatmat-darb-alzahra-cloudflare-v5-2
npm install
npx wrangler d1 execute khatmat_darb_alzahra --remote --file=./schema.sql
npx wrangler pages deploy public --project-name khatmat-darb-alzahra
```

ملاحظة: أمر schema.sql يمسح بيانات الاختبار الحالية ويعيد إنشاء الجداول مع حساب المالك.
