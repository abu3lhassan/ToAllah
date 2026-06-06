# v5.1 Fix

هذه النسخة تصلح عدم توافق الواجهة مع API في v5:

- الحجز
- جاري القراءة
- تمت القراءة
- إعادة الإتاحة
- حذف الختمة
- إغلاق/إعادة فتح الختمة

## إعادة ضبط قاعدة D1

> ملاحظة: هذا يمسح الختمات التجريبية الحالية لأننا ما زلنا في مرحلة الاختبار.

```powershell
npx wrangler d1 execute khatmat_darb_alzahra --remote --file=./schema.sql
```

## النشر

```powershell
npx wrangler pages deploy public --project-name khatmat-darb-alzahra
```

## الاختبار

```text
https://khatmat-darb-alzahra.pages.dev/api/health
https://khatmat-darb-alzahra.pages.dev/api/khatmas
```
