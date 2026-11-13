# NextWave Interview Scheduler — PostgreSQL Architecture & Clearance System

A modern, role-gated Interview Clearance System built for **NextWave** with an end-to-end **PostgreSQL** relational database backend.

---

## 🚀 Quick Start (Node.js & PostgreSQL)

1. Install dependencies & start the server:
   ```bash
   cd grit-interview-scheduler
   npm install
   npm start
   ```
2. Open **`http://localhost:8080/index.html`** in your browser.

*(Optional)* To connect to an external production PostgreSQL database, provide the `DATABASE_URL` environment variable:
```bash
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/nextwave_db"
npm start
```
*Note: If no external PostgreSQL database is running, the system automatically runs an in-memory PostgreSQL engine (`pg-mem`) executing the exact same `schema.sql` migrations and queries.*

---

## 🐘 PostgreSQL Schema & Relational Tables

The database schema is defined in [`schema.sql`](file:///d:/NxTwave/grit-interview-scheduler/schema.sql) and includes:
1. `users` — Students, faculty evaluators, and campus administrators with domain specializations.
2. `track_categories` — Technical tracks, prerequisite skills, badge tiers, and descriptions curated by Admins.
3. `student_enrollments` — Student enrollment records in track categories with skill clearance tracking.
4. `availability_slots` — 30-minute interview availability windows published by faculty evaluators.
5. `interview_bookings` — Reserved clearance interview sessions with conflict-locked slot status.
6. `interview_evaluations` — Evaluator rubrics (Technical Depth, Communication, Problem Solving) and notes.
7. `student_badges` — Certified Track Badges awarded to students upon passing the live defense.
8. `malpractice_audit_logs` — Immutable audit trail of academic dishonesty reviews and badge nullifications.

---

## ⚡ Key Features Implemented

### 1. Course & Track Category Management (Admin)
- Admin can publish new Course Categories in `admin.html` with Title, Domain Area, Badge Tier (Novice to Grand Master), Icon, Description, and Prerequisite Skills stored directly in PostgreSQL.
- Newly published categories are immediately available in the Student Course Catalog.

### 2. Domain-Specific Interviewer Assignment (Admin)
- Admin can register new evaluators and assign them to specific technical domains (e.g. *Full Stack Development*, *AI Models*, *Cyber Security*).
- Domain specializations are displayed across the interviewer capacity roster and on interview booking slots.

### 3. Student Course Catalog & 1-Click Enrollment (Student)
- Students can browse the course categories catalog under **"Explore & Enroll Courses"** in `student.html`.
- Enrolling immediately displays the track under the student's **"My Tracks & Badges"** active dashboard.

### 4. Level Clearance Interview Booking Flow
- 3-step booking stepper: Select Slot → Review Details → Confirmed ✓.
- Syncs across portals via PostgreSQL: booking releases and slot reservations update the Interviewer's queue and Admin's pipeline in real-time.

### 5. Evaluation Outcome Decision Recording
- Interviewers evaluate candidates and submit **Pass (Award Badge & Milestone)**, **Fail (Cooldown)**, or **Retake**, complete with rubric feedback.

### 6. Student Dashboard: Before vs After Result Screens
- Built-in side-by-side comparison screen illustrating how the student dashboard transforms upon receiving the interview result.

---

## 🔐 Credentials

- **Admin Access:** `admin@niat.edu` / `admin123`
- **Interviewer Access:** `kavita@niat.edu` / `password123` or register new
- **Student Access:** `rohan@niat.edu` / `password123` or register new
- **Forgot Password Workflow:** Built-in password reset modal on `login.html` updating PostgreSQL

---

## 📑 Artifacts

- **Visual Walkthrough & Screenshots:** [`Prototype_Screenshots.md`](file:///C:/Users/sushanth/.gemini/antigravity/brain/84b43efe-8f21-4a65-bd99-449007671683/Prototype_Screenshots.md)
- **2-Page Design Document:** [`NextWave_Interview_Scheduling_Writeup.md`](file:///C:/Users/sushanth/.gemini/antigravity/brain/84b43efe-8f21-4a65-bd99-449007671683/NextWave_Interview_Scheduling_Writeup.md)
