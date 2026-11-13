-- ====================================================================
-- NextWave Interview Scheduling & Clearance System — PostgreSQL Schema
-- ====================================================================

-- 1. Users Table (Students, Interviewers, Campus Admins)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('student', 'interviewer', 'admin')),
  niat_id VARCHAR(50),
  domain_specialization TEXT,
  is_blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Track & Course Categories Table
CREATE TABLE IF NOT EXISTS track_categories (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  domain_area VARCHAR(100) NOT NULL,
  badge_tier VARCHAR(50) NOT NULL,
  icon VARCHAR(10) NOT NULL DEFAULT '🚀',
  description TEXT,
  skills TEXT[] NOT NULL,
  enrolled_count INT DEFAULT 0,
  is_core BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Student Track Enrollments Table
CREATE TABLE IF NOT EXISTS student_enrollments (
  id VARCHAR(50) PRIMARY KEY,
  student_email VARCHAR(255) NOT NULL,
  track_id VARCHAR(50) NOT NULL,
  skills_cleared_count INT DEFAULT 6,
  is_eligible BOOLEAN DEFAULT TRUE,
  enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Interviewer Availability Slots Table
CREATE TABLE IF NOT EXISTS availability_slots (
  id VARCHAR(50) PRIMARY KEY,
  interviewer_id VARCHAR(50) NOT NULL,
  interviewer_name VARCHAR(255) NOT NULL,
  interviewer_email VARCHAR(255) NOT NULL,
  slot_date DATE NOT NULL,
  start_time VARCHAR(20) NOT NULL,
  end_time VARCHAR(20) NOT NULL,
  domain VARCHAR(100) NOT NULL,
  is_booked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Interview Bookings Table
CREATE TABLE IF NOT EXISTS interview_bookings (
  id VARCHAR(50) PRIMARY KEY,
  slot_id VARCHAR(50),
  student_name VARCHAR(255) NOT NULL,
  student_email VARCHAR(255) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  track_id VARCHAR(50) NOT NULL,
  track_name VARCHAR(255) NOT NULL,
  interviewer_name VARCHAR(255) NOT NULL,
  interviewer_email VARCHAR(255) NOT NULL,
  interview_date VARCHAR(50) NOT NULL,
  start_time VARCHAR(20) NOT NULL,
  end_time VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('Not Booked', 'Booked', 'Passed', 'Failed', 'Retake', 'Flagged')),
  attempt VARCHAR(20) DEFAULT '1st',
  notes TEXT DEFAULT '',
  booked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Interview Evaluations Table
CREATE TABLE IF NOT EXISTS interview_evaluations (
  id VARCHAR(50) PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  interviewer_email VARCHAR(255) NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('PASS', 'FAIL', 'RETAKE')),
  score_technical INT CHECK (score_technical BETWEEN 1 AND 5),
  score_communication INT CHECK (score_communication BETWEEN 1 AND 5),
  score_problem_solving INT CHECK (score_problem_solving BETWEEN 1 AND 5),
  feedback_notes TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Student Track Badges Table
CREATE TABLE IF NOT EXISTS student_badges (
  id VARCHAR(50) PRIMARY KEY,
  student_email VARCHAR(255) NOT NULL,
  track_id VARCHAR(50) NOT NULL,
  badge_tier VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  awarded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  revocation_reason TEXT,
  revoked_at TIMESTAMPTZ
);

-- 8. Academic Integrity / Malpractice Audit Logs Table
CREATE TABLE IF NOT EXISTS malpractice_audit_logs (
  id VARCHAR(50) PRIMARY KEY,
  student_email VARCHAR(255) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  track_name VARCHAR(255) NOT NULL,
  flagged_by VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  action_taken VARCHAR(100) NOT NULL DEFAULT 'Badge Nullified & Status Set to Flagged',
  flagged_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_slots_interviewer ON availability_slots(interviewer_email);
CREATE INDEX IF NOT EXISTS idx_slots_date ON availability_slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_bookings_student ON interview_bookings(student_email);
CREATE INDEX IF NOT EXISTS idx_badges_student ON student_badges(student_email);
