# PWA Patch - درب الزهراء

هذا باتش آمن لتحويل الموقع إلى PWA بدون تغيير منطق الختمات أو API أو قاعدة البيانات.

## 1) انسخ الملفات الجديدة
انسخ محتوى هذا الباتش فوق مجلد مشروعك الحالي.

## 2) أضف وسوم PWA إلى `public/index.html`
ضع هذا المقطع داخل `<head>` بعد meta description أو قبل روابط الخطوط:

```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0f5f45">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="درب الزهراء">
```

## 3) سجل Service Worker
ضع هذا المقطع قبل `</body>` في `public/index.html`:

```html
<script>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }
</script>
```

## 4) انشر بدون تشغيل schema.sql

```powershell
npx wrangler pages deploy public --project-name khatmat-darb-alzahra
```

## 5) الحفظ على الجوال

Android Chrome: القائمة > Add to Home screen / Install app.

iPhone Safari: Share > Add to Home Screen.
