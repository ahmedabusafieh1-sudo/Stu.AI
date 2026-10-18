# Stu.Ai - مساعد الدراسة الذكي | Production-grade Educational AI Assistant

تطبيق ويب تعليمي دراسي متكامل مبني لخدمة الطلاب باللغتين العربية والإنجليزية، يقرأ ويحلل الصور والملفات، يشرح المفاهيم ويحل المسائل خطوة بخطوة، يعيد الشرح ويبسطه، وينشئ اختبارات تفاعلية محكمة ومصححة آلياً مع عزو حقيقي للمصادر.

---

## 🌟 الميزات المكتملة (Completed Features)

1. **المساعد الدراسي التفاعلي (Educational Persona)**:
   - شرح الدروس (الفكرة، الشرح خطوة بخطوة، تعريف المصطلحات، مثال عملي، نقاط الاختبار، سؤال فهم).
   - حل المسائل (المعطيات، المطلوب، القانون، توحيد الوحدات، التعويض، والتحقق من منطقية الناتج).
   - أزرار التحكم السريع: "أعد الشرح بطريقة مختلفة"، "بسّط أكثر"، "أعطني مثالاً"، "لخّص"، "كوّن كويز".
   - دعم كامل لمعادلات KaTeX الرياضية والجداول وقوائم الخطوات.

2. **قراءة المصادر بالكامل والتتبع (Document Manifest Pipeline)**:
   - فحص البصمة السحرية (Magic Bytes) ومنع الملفات التنفيذية والأرشيفات غير الآمنة.
   - دعم الصور (JPEG, PNG, WebP)، وPDF، وWord (DOCX)، وPowerPoint (PPTX)، وExcel (XLSX)، وCSV، وTXT، وMD.
   - كشف صيغ HEIC مع تقديم إرشاد واضح للمستخدم.
   - تقسيم المستندات الطويلة إلى وحدات متتابعة مرقمة (`source_units`) وحفظ الفهرس والحقائق والمعادلات.
   - استشهاد وتدقيق حقيقي للمراجع `[اسم الملف، صفحة X]` مقابل سجل المصادر الفعلي ومنع تلفيق أرقام الصفحات.

3. **بحث Google المباشر (Google Search Grounding)**:
   - تفعيل صريح للبحث الخارجي مع عرض المصادر والروابط والعناوين الحقيقية من Google.

4. **الإملاء الصوتي ومراجعة النص (Reviewed Voice Dictation)**:
   - تسجيل صوتي عبر المتصفح (MediaRecorder) بمؤشر نبضي ومدة تصل لدقيقتين مع إيقاف تلقائي.
   - تفريغ صوتي دقيق عبر Gemini يدعم العربية والمصطلحات الإنجليزية.
   - إدراج التفريغ كمسودة في حقل الكتابة ليقوم الطالب بمراجعته وتعديله قبل الإرسال (دون إرسال تلقائي).

5. **نظام الاختبارات التفاعلية (Interactive Quiz System)**:
   - كويز اختيار من متعدد (MCQ)، مقالي، أو مختلط بعدد وصعوبة ونطاق مخصص.
   - توليد مخرجات مهيكلة JSON والتحقق منها بمخططات Zod.
   - حجب الإجابات الصحيحة والتفسيرات عن المتصفح قبل التسليم لمنع الغش.
   - تصحيح موضوعي فوري للـ MCQ وتصحيح ذكي للأسئلة المقالية عبر معايير تقييم (Rubric) توضح أنه "تقييم آلي تقديري".
   - عرض النتيجة، التفسيرات، مراجع المصدر، والموضوعات التي تحتاج مراجعة.
   - زر "اشرح أخطائي في المحادثة" لشرح نقاط الضعف تفاعلياً.

6. **الحسابات والأمان (Security & Authentication)**:
   - جلسات خادم محفوظة في قاعدة البيانات مع كوكيز HttpOnly وSecure وحماية CSRF.
   - تشفير كلمات المرور باستخدام Scrypt عالي الذاكرة والتعقيد.
   - تفعيل الحساب برمز تحقق 6 أرقام مع بصمة HMAC وصلاحية 10 دقائق وحد 5 محاولات.
   - منع الحسابات غير المفعلة من استخدام المحادثات أو الرفع أو الذكاء الاصطناعي.
   - استعادة كلمة المرور برابط أحادي الاستخدام وإلغاء الجلسات القديمة فور التغيير.
   - عزل تام للبيانات: لا يمكن لمستخدم الوصول لمحادثات أو مرفقات مستخدم آخر.

7. **التصميم والهوية البصرية**:
   - ألوان الهوية: الخلفية `#171717`، الشريط الجانبي `#111111`، البطاقات `#232323`، حقل الكتابة `#2B2B2B`.
   - زر القائمة ☰ والشريط الجانبي الفيزيائي يسار الشاشة مع نصوص عربية صحيحة التوجيه.
   - دعم كامل للغة العربية (افتراضياً) مع إمكانية التبديل إلى English من الإعدادات.
   - PWA جاهز مع أيقونة أصلية وService Worker لا يخزن أي محادثات خاصة حفاظاً على الخصوصية.

---

## 🏗️ البنية التقنية (Architecture)

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide React, KaTeX.
- **Backend**: Node.js 22, Express, TypeScript.
- **Database**: PostgreSQL مع Drizzle ORM، مع محرك PGlite مدمج يعمل تلقائياً عند غياب خادم خارجي لضمان التشغيل الفوري.
- **AI Engine**: Google Gen AI SDK (`@google/genai` & `@google/generative-ai`).
- **Storage**: Persistent Storage Abstraction (`./data/storage` أو Replit Storage).

---

## ⚙️ إعداد وتشغيل المشروع (Setup & Run)

### 1. تثبيت الحزم (Install)
```bash
npm install
```

### 2. ضبط المتغيرات (Environment Setup)
انسخ ملف `.env.example` إلى `.env`:
```bash
cp .env.example .env
```
قم بملء المتغيرات:
- `GEMINI_API_KEY`: مفتاح Gemini API من [Google AI Studio](https://aistudio.google.com/).
- `DATABASE_URL`: رابط اتصال PostgreSQL (أو اتركه فارغاً لاستخدام PGlite المدمج تلقائياً).
- `RESEND_API_KEY` أو إعدادات SMTP: لإرسال أكواد التحقق (في بيئة التطوير، تُطبع الأكواد في الطرفية تلقائياً).

### 3. التشغيل في بيئة التطوير (Development)
```bash
# تشغيل الخادم والواجهة
npm run dev
# أو تشغيل الخادم وVite معاً
npm run dev:all
```
افتح المتصفح على: `http://localhost:5173` (أو `http://localhost:3001` للخادم).

### 4. فحص واختبار المشروع (Testing)
```bash
npm test
```
تم التحقق واجتياز 16 اختباراً آلياً للحماية والتحقق واستخراج المستندات والمراجع والكويز.

### 5. البناء والتشغيل للإنتاج (Production Build)
```bash
npm run build
npm start
```

---

## 📁 خريطة المشروع (Project Structure)

```
Stu.AI/
├── public/                 # PWA Manifest, Service Worker, SVGs
├── server/
│   ├── db/                 # Drizzle ORM & Database connection (PostgreSQL / PGlite)
│   ├── middleware/         # Auth, Session verification, CSRF guards
│   ├── routes/
│   │   ├── auth.ts         # Register, OTP, Login, Reset password, Settings
│   │   ├── attachments.ts  # Multi-file upload, magic bytes, streaming content
│   │   ├── chat.ts         # Conversations, SSE streaming, dictation transcribe
│   │   └── quizzes.ts      # Structured quiz generation, grading, mistakes review
│   ├── services/
│   │   ├── auth.ts         # Scrypt hashing, OTP HMAC, email dispatch
│   │   ├── citations.ts    # Document citation verifier
│   │   ├── extractor.ts    # Magic bytes, PDF, DOCX, PPTX, XLSX extractors
│   │   ├── gemini.ts       # Gemini streaming, search grounding, quiz maker
│   │   ├── jobs.ts         # Persistent background worker
│   │   └── storage.ts      # Private persistent storage provider
│   └── index.ts            # Server entry point
├── shared/
│   └── schema.ts           # Drizzle tables and Zod validation schemas
├── src/
│   ├── components/         # TopNav, Sidebar, ChatMessage, ChatInput, QuizModal...
│   ├── context/            # AuthContext, ChatContext
│   ├── i18n/               # Arabic and English translations dictionary
│   ├── App.tsx             # Main responsive layout
│   └── main.tsx            # React root
├── tests/                  # Automated Vitest test suite
├── .env.example            # Environment configuration template
├── package.json
└── vite.config.ts
```
