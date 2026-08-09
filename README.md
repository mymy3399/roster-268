# ทำเนียบรุ่น 268

เว็บทำเนียบรายชื่อแบบ PWA ใช้ Node.js, Express และ SQLite รองรับการค้นหา
การส่งคำขอแก้ไขข้อมูล และขั้นตอนอนุมัติโดยผู้ดูแล

## โครงสร้าง

```text
directory268/
├── data/                    # ข้อมูลตั้งต้น ข้อมูลสำรอง และฐานข้อมูล runtime
├── lib/
│   ├── admin-auth.js        # session และ rate limit สำหรับผู้ดูแล
│   ├── database.js          # schema, migration และ seed SQLite
│   ├── storage.js           # สำรอง JSON และจัดการรูปที่แอปสร้าง
│   └── validation.js        # validation ข้อมูลและรูปภาพ
├── public/
│   ├── app.js               # การทำงานของหน้าเว็บ
│   ├── js/security.js       # DOM rendering, escaping และ URL validation
│   ├── styles.css           # รูปแบบหน้าเว็บ
│   └── sw.js                # service worker
├── test/                    # automated tests
├── index.html               # โครง HTML หลัก
└── server.js                # Express routes และการประกอบระบบ
```

`data/database.sqlite*`, รูปบุคคล และข้อมูลรายชื่อเป็นข้อมูล runtime/ข้อมูลอ่อนไหว
ไม่ควรเผยแพร่หรือรวมใน static routes เพิ่มเติม

## เริ่มใช้งาน

```bash
npm ci
ADMIN_PIN=เปลี่ยนเป็นรหัสจริง npm start
```

เปิด `http://localhost:3000` ค่า `ADMIN_PIN` ต้องเป็นตัวเลข 5–12 หลัก และจำเป็นต้อง
กำหนดผ่าน environment เมื่อรันด้วย `NODE_ENV=production`

หรือใช้ Docker:

```bash
ADMIN_PIN=เปลี่ยนเป็นรหัสจริง docker compose up --build -d
```

## ทดสอบ

```bash
npm test
curl http://localhost:3000/api/people
```

## API หลัก

- `GET /api/people` — รายชื่อทั้งหมด
- `GET /api/edits` — การแก้ไขที่อนุมัติแล้ว
- `GET /api/edits/:no` — ข้อมูลแก้ไขและ version ของบุคคล
- `POST /api/edit-requests/:no` — ส่งคำขอแก้ไขแบบ versioned
- `POST /api/admin/login` และ `POST /api/admin/logout` — session ผู้ดูแล
- `GET /api/admin/edit-requests` — คำขอที่รออนุมัติ
- `POST /api/admin/edit-requests/:id/approve` — อนุมัติคำขอ
- `POST /api/admin/edit-requests/:id/reject` — ปฏิเสธคำขอ
- `POST /api/admin/edit-requests/:id/revert` — คืนค่ารายการที่อนุมัติ

API ที่แก้ไขข้อมูลตรวจ field allowlist, ความยาวข้อความ, รูปแบบเบอร์โทร อายุ
ชนิดและขนาดรูปภาพ รวมถึง optimistic version เพื่อป้องกันข้อมูลจากอุปกรณ์เก่าทับข้อมูลใหม่
# roster-268
