# ระบบจัดตารางวันหยุดออนไลน์

## สิ่งที่ได้
- เปิดออนไลน์ได้
- หลายคนเห็นข้อมูลเดียวกันแบบ realtime
- สร้างตารางแล้วบันทึกขึ้น Firebase
- สลับวันหยุดแล้วทุกคนเห็นทันที
- กะเช้าแลกได้เฉพาะกะเช้า
- กะดึกแลกได้เฉพาะกะดึก
- มีประวัติการแก้ไข/สลับ
- Export CSV ได้

## วิธีติดตั้งแบบสั้น

### 1) สร้าง Firebase Project
ไปที่ Firebase Console แล้วสร้าง Project ใหม่

### 2) เปิด Firestore Database
เลือก Cloud Firestore > Create database

### 3) เปิด Firebase Hosting
เลือก Hosting > Get started

### 4) เพิ่ม Web App
Project settings > Your apps > Add app > Web  
แล้วคัดลอก `firebaseConfig` ไปใส่ในไฟล์ `firebase-config.js`

### 5) ตั้ง Firestore Rules
เอาเนื้อหาในไฟล์ `firestore.rules` ไปใส่ใน Firestore Rules แล้ว Publish

> หมายเหตุ: Rules ตอนนี้ตั้งให้ทุกคนที่มีลิงก์แก้ได้ เหมาะกับการเริ่มใช้งานง่าย ๆ  
> ถ้าต้องการล็อกเฉพาะหัวหน้า/แอดมิน ควรเพิ่ม Firebase Authentication ภายหลัง

### 6) Deploy
ติดตั้ง Firebase CLI ก่อน:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

ตอน init ให้เลือก:
- Use existing project
- Public directory: `.`
- Configure as single-page app: No
