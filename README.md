# Status Center — mustaqil veb-sayt (Supabase + VS Code)

Bu loyiha endi Claude.ai'ga bog'liq emas — Supabase (haqiqiy backend) bilan ishlaydi va
VS Code'da to'liq ishga tushadi, keyin istagan hostingga (Netlify, Vercel, GitHub Pages) joylashtirish mumkin.

## 1-qadam: Supabase loyihasini yaratish

1. https://supabase.com ga kiring, bepul hisob oching.
2. **"New project"** bosing — nom bering (masalan `status-center`), parol o'rnating, region tanlang.
3. Loyiha tayyor bo'lishini kuting (~1-2 daqiqa).

## 2-qadam: Bazani sozlash (SQL)

1. Chap menyudan **SQL Editor** ni oching.
2. **New query** bosing.
3. Ushbu papkadagi **`schema.sql`** faylining butun mazmunini ko'chirib, shu yerga joylashtiring.
4. **Run** bosing. Xato chiqmasligi kerak — agar chiqsa, xabarni menga yuborsangiz tuzataman.

## 3-qadam: Email tasdiqlashni o'chirish (MUHIM)

Bu ilova login uchun elektron pochta emas, oddiy **username** ishlatadi (orqa fonda soxta email yaratiladi).
Shuning uchun Supabase'ning "emailni tasdiqlash" talabini o'chirish kerak:

1. Chap menyudan **Authentication → Providers → Email** ga o'ting.
2. **"Confirm email"** (yoki "Enable email confirmations") sozlamasini **o'chiring (off)**.
3. Saqlang.

Aks holda, ro'yxatdan o'tgan foydalanuvchi hech qachon kelmaydigan tasdiqlash xatini kutib qoladi va tizimga kira olmaydi.

## 4-qadam: Kalitlarni olish

1. Chap menyudan **Project Settings → API** ga o'ting.
2. **Project URL** va **anon public key** ni nusxalang.
3. Ushbu papkadagi **`config.js`** faylini oching va shu ikki qiymatni joylashtiring:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi....";
```

## 5-qadam: VS Code'da ochish

1. Butun `status-center-web` papkasini VS Code'da oching.
2. **Live Server** kengaytmasini o'rnating (Extensions → "Live Server" qidiring → Install).
3. `index.html` faylini o'ng tugma bilan bosib **"Open with Live Server"** ni tanlang.
4. Brauzerda sayt ochiladi — endi to'liq ishlaydi.

> Eslatma: faylni to'g'ridan-to'g'ri ikki marta bosib (`file://` orqali) ochish ham ko'p hollarda ishlaydi,
> lekin Live Server (yoki har qanday `http://localhost` server) tavsiya etiladi.

## 6-qadam: Sinab ko'rish

1. Saytda **"Create a workspace"** bosing.
2. Tashkilot nomi, kodi, o'z ismingiz, username va parol kiriting → **"Create workspace & sign in"**.
3. Siz avtomatik **manager** sifatida kirasiz.
4. Board bo'limida **"Load sample data"** bosib namunaviy yuklarni qo'shing.
5. Yangi xodim qo'shish uchun: ularga tashkilot kodini bering, ular login ekranida
   **"Join an existing one"** orqali o'z hisobini yaratadi (default rol: updater).
   Users bo'limida manager keyinchalik rolini o'zgartirishi yoki o'chirishi mumkin.

## Nima o'zgardi (avvalgi Claude artifact versiyasiga nisbatan)

- **Haqiqiy autentifikatsiya** — parollar Supabase tomonidan xavfsiz saqlanadi (bcrypt), oddiy SHA-256 emas.
- **Haqiqiy real-time** — endi polling (7 soniyada bir tekshirish) emas, balki Supabase Realtime orqali
  o'zgarish sodir bo'lgan zahoti barcha ochiq oynalarda avtomatik yangilanadi.
- **PostgreSQL baza** — ma'lumotlar professional darajadagi bazada saqlanadi, zaxira nusxalash va eksport qilish oson.
- **Row Level Security (RLS)** — har bir tashkilot faqat o'z ma'lumotlarini ko'radi, buni Postgres darajasida
  qattiq nazorat qilinadi (frontend kodiga ishonib qolinmaydi).
- **Haydovchi havolasi** — endi maxsus, xavfsiz Postgres funksiyasi (`driver_update_load`) orqali ishlaydi;
  faqat to'g'ri token bilan, faqat o'sha bitta yukni yangilash mumkin.
- **Dark mode** — endi brauzerning `localStorage`'ida saqlanadi (bu haqiqiy sayt, Claude artifact emas,
  shuning uchun bu xavfsiz va tabiiy yechim).

## Keyingi qadam: internetga chiqarish (ixtiyoriy)

Sayt tayyor bo'lgach, uni haqiqiy domenga chiqarish uchun eng oson yo'llar:

- **Netlify** yoki **Vercel** — `status-center-web` papkasini GitHub'ga yuklab, ularga bog'lang; ikkalasi ham
  statik saytlarni bepul hostinglaydi, build kerak emas.
- **GitHub Pages** — xuddi shunday, repozitoriy sozlamalaridan yoqiladi.

Har birida jarayonni birga bosqichma-bosqich o'tishga yordam bera olaman — qaysi birini tanlasangiz, ayting.

## Fayllar tuzilishi

```
status-center-web/
├── index.html          — asosiy ilova (login, board, database, users)
├── driver.html          — haydovchi uchun login-siz sahifa
├── config.js             — Supabase URL va kalit (o'zingiz to'ldirasiz)
├── schema.sql             — Supabase SQL Editor'da ishga tushiriladigan baza sxemasi
├── assets/
│   ├── style.css          — umumiy dizayn
│   ├── app.js              — asosiy ilova mantiqi
│   └── driver.js           — haydovchi sahifasi mantiqi
└── README.md               — shu fayl
```
