// ====================================================================
// NextWave Interview Scheduling — PostgreSQL Database Engine & Data Access
// ====================================================================

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { newDb } = require('pg-mem');

let pool = null;
let isInMemory = false;

async function getPool() {
  if (pool) return pool;

  // Supports Vercel Postgres (POSTGRES_URL) as well as standard DATABASE_URL / Supabase / Neon
  const connectionString = process.env.POSTGRES_URL || 
                           process.env.DATABASE_URL || 
                           process.env.POSTGRES_PRISMA_URL || 
                           process.env.POSTGRES_URL_NON_POOLING;

  if (connectionString) {
    try {
      const isRemote = !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');
      const realPool = new pg.Pool({
        connectionString,
        ssl: isRemote ? { rejectUnauthorized: false } : false
      });
      // Test connectivity
      await realPool.query('SELECT 1');
      console.log('🐘 Connected to external PostgreSQL database');
      pool = realPool;
      isInMemory = false;
      return pool;
    } catch (err) {
      console.warn('⚠️ Could not connect to external PostgreSQL, falling back to PostgreSQL In-Memory Engine:', err.message);
    }
  }

  // PostgreSQL In-Memory Engine via pg-mem
  console.log('🐘 Initializing PostgreSQL Engine (pg-mem)...');
  const memDb = newDb();
  
  // Register standard date / uuid functions if needed
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => 'uuid-' + Math.random().toString(36).substring(2, 10)
  });

  const { Pool } = memDb.adapters.createPg();
  pool = new Pool();
  isInMemory = true;
  return pool;
}

async function query(text, params = []) {
  const p = await getPool();
  return p.query(text, params);
}

// Embedded complete PostgreSQL schema fallback (ensures Vercel serverless has 0 file dependencies)
const EMBEDDED_SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS student_enrollments (
  id VARCHAR(50) PRIMARY KEY,
  student_email VARCHAR(255) NOT NULL,
  track_id VARCHAR(50) NOT NULL,
  skills_cleared_count INT DEFAULT 6,
  is_eligible BOOLEAN DEFAULT TRUE,
  enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_slots_interviewer ON availability_slots(interviewer_email);
CREATE INDEX IF NOT EXISTS idx_slots_date ON availability_slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_bookings_student ON interview_bookings(student_email);
CREATE INDEX IF NOT EXISTS idx_badges_student ON student_badges(student_email);
`;

function cleanSqlStatements(rawSql) {
  const cleanSql = rawSql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');

  return cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Initialize tables from schema.sql or embedded fallback and seed initial records
async function initDb() {
  const p = await getPool();
  let sql = '';
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      sql = fs.readFileSync(schemaPath, 'utf8');
    }
  } catch (err) {
    console.warn('⚠️ Could not load schema.sql from disk, using embedded schema fallback:', err.message);
  }

  if (!sql) {
    sql = EMBEDDED_SCHEMA_SQL;
  }

  const statements = cleanSqlStatements(sql);

  for (const stmt of statements) {
    try {
      await p.query(stmt);
    } catch (err) {
      console.error('Error applying statement in schema.sql:', stmt.slice(0, 50), err.message);
    }
  }

  console.log('✅ PostgreSQL Schema verified.');
  await seedInitialData();
}

async function seedInitialData() {
  // 1. Master Admin
  const adminCheck = await query('SELECT * FROM users WHERE email = $1', ['admin@niat.edu']);
  if (adminCheck.rows.length === 0) {
    await query(`
      INSERT INTO users (id, name, email, password_hash, role, niat_id, domain_specialization)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, ['usr-admin', 'Campus Admin', 'admin@niat.edu', 'admin123', 'admin', 'NIAT-ADM-01', 'Operations Lead']);
  }

  // 2. Initial Faculty Interviewers
  const faculty = [
    { id: 'usr-kavita', name: 'Dr. Kavita Rao', email: 'kavita@niat.edu', password: 'password123', role: 'interviewer', domain: 'Full Stack Development, AI Product Mastery', isBlocked: false },
    { id: 'usr-anand', name: 'Dr. Anand Varma', email: 'anand@niat.edu', password: 'password123', role: 'interviewer', domain: 'Cyber Security & Cloud Defense, Cloud & DevOps Architecture', isBlocked: false },
    { id: 'usr-vikram', name: 'Prof. Vikram Sen', email: 'vikram@niat.edu', password: 'password123', role: 'interviewer', domain: 'Data Analytics & Intelligence, AI Models & LLM Engineering', isBlocked: false },
    { id: 'usr-rajesh', name: 'Prof. Rajesh Nair', email: 'rajesh@niat.edu', password: 'password123', role: 'interviewer', domain: 'Full Stack Development, Cloud & DevOps Architecture', isBlocked: false },
    { id: 'usr-meera', name: 'Dr. Meera Iyer', email: 'meera@niat.edu', password: 'password123', role: 'interviewer', domain: 'AI Models & LLM Engineering, Data Analytics & Intelligence, Full Stack Development', isBlocked: false }
  ];

  for (const f of faculty) {
    const fCheck = await query('SELECT * FROM users WHERE email = $1', [f.email]);
    if (fCheck.rows.length === 0) {
      await query(`
        INSERT INTO users (id, name, email, password_hash, role, domain_specialization, is_blocked)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [f.id, f.name, f.email, f.password, f.role, f.domain, f.isBlocked]);
    }
  }

  // 3. Track Categories
  const tracks = [
    {
      id: 'track-fs',
      title: 'Full Stack Development',
      domain: 'AI Product Mastery',
      badge_tier: 'Novice',
      icon: '🌐',
      description: 'Master modern frontend UI engineering, robust backend microservices, SQL databases, and applied Gen AI development.',
      skills: ['Computational Thinking', 'UI Engineering', 'Server Side Engineering', 'SQL', 'Applied Gen AI Development', 'CS Fundamentals'],
      enrolled_count: 14,
      is_core: true
    },
    {
      id: 'track-da',
      title: 'Data Analytics & Intelligence',
      domain: 'Data & Systems',
      badge_tier: 'Specialist',
      icon: '📊',
      description: 'Harness Python, advanced SQL, exploratory data analysis, business intelligence modeling, and machine learning foundations.',
      skills: ['Python Foundations', 'SQL Queries', 'Statistical Analysis', 'Pandas & EDA', 'Data Visualization', 'ML Foundations'],
      enrolled_count: 11,
      is_core: true
    },
    {
      id: 'track-cloud',
      title: 'Cloud & DevOps Architecture',
      domain: 'AI Systems Mastery',
      badge_tier: 'Specialist',
      icon: '☁️',
      description: 'Architect scalable cloud infrastructure, containerized deployments, automated CI/CD pipelines, and infrastructure-as-code.',
      skills: ['Linux Internals', 'Networking Protocols', 'AWS Core Architecture', 'Docker Containerization', 'CI/CD Workflows', 'Terraform'],
      enrolled_count: 9,
      is_core: true
    },
    {
      id: 'track-aimodels',
      title: 'AI Models & LLM Engineering',
      domain: 'AI Models Mastery',
      badge_tier: 'Expert',
      icon: '🧠',
      description: 'Train, fine-tune, and deploy transformer architectures, retrieval augmented generation (RAG) agents, and deep neural networks.',
      skills: ['PyTorch Foundations', 'Transformer Architecture', 'LLM Fine-Tuning', 'Vector Databases & RAG', 'Agentic Systems', 'Model Benchmarking'],
      enrolled_count: 7,
      is_core: false
    },
    {
      id: 'track-cyber',
      title: 'Cyber Security & Cloud Defense',
      domain: 'Security & Infrastructure',
      badge_tier: 'Specialist',
      icon: '🛡️',
      description: 'Secure enterprise cloud workloads, perform threat modeling, penetrate test API endpoints, and defend networks.',
      skills: ['Network Security', 'Cryptography', 'Cloud IAM Security', 'Vulnerability Assessment', 'Incident Response'],
      enrolled_count: 8,
      is_core: false
    }
  ];

  for (const t of tracks) {
    const tCheck = await query('SELECT * FROM track_categories WHERE id = $1', [t.id]);
    if (tCheck.rows.length === 0) {
      await query(`
        INSERT INTO track_categories (id, title, domain_area, badge_tier, icon, description, skills, enrolled_count, is_core, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      `, [t.id, t.title, t.domain, t.badge_tier, t.icon, t.description, t.skills, t.enrolled_count, t.is_core]);
    }
  }

  // 4. Initial Students
  const students = [
    { id: 'usr-rohan', name: 'Rohan Varma', email: 'rohan@niat.edu', password: 'password123', niat_id: 'NIAT2024-4102' },
    { id: 'usr-priya', name: 'Priya Sen', email: 'priya@niat.edu', password: 'password123', niat_id: 'NIAT2024-4103' },
    { id: 'usr-aarav', name: 'Aarav Mehta', email: 'aarav@niat.edu', password: 'password123', niat_id: 'NIAT2024-4104' },
    { id: 'usr-sneha', name: 'Sneha Patel', email: 'sneha@niat.edu', password: 'password123', niat_id: 'NIAT2024-4105' }
  ];

  for (const s of students) {
    const sCheck = await query('SELECT * FROM users WHERE email = $1', [s.email]);
    if (sCheck.rows.length === 0) {
      await query(`
        INSERT INTO users (id, name, email, password_hash, role, niat_id)
        VALUES ($1, $2, $3, $4, 'student', $5)
      `, [s.id, s.name, s.email, s.password, s.niat_id]);
    }
  }

  // 5. Initial Slots
  const slotsCheck = await query('SELECT COUNT(*) as count FROM availability_slots');
  if (parseInt(slotsCheck.rows[0].count, 10) === 0) {
    const sampleSlots = [
      { id: 'slot-1', intId: 'usr-kavita', name: 'Dr. Kavita Rao', email: 'kavita@niat.edu', date: '2026-11-20', start: '10:00 AM', end: '10:45 AM', domain: 'Full Stack Development', booked: false },
      { id: 'slot-2', intId: 'usr-kavita', name: 'Dr. Kavita Rao', email: 'kavita@niat.edu', date: '2026-11-20', start: '02:00 PM', end: '02:45 PM', domain: 'Full Stack Development', booked: false },
      { id: 'slot-3', intId: 'usr-rajesh', name: 'Prof. Rajesh Nair', email: 'rajesh@niat.edu', date: '2026-11-21', start: '11:00 AM', end: '11:45 AM', domain: 'Full Stack Development', booked: false },
      { id: 'slot-4', intId: 'usr-anand', name: 'Dr. Anand Varma', email: 'anand@niat.edu', date: '2026-11-21', start: '03:00 PM', end: '03:45 PM', domain: 'Cyber Security & Cloud Defense', booked: false },
      { id: 'slot-5', intId: 'usr-anand', name: 'Dr. Anand Varma', email: 'anand@niat.edu', date: '2026-11-22', start: '11:00 AM', end: '11:45 AM', domain: 'Cloud & DevOps Architecture', booked: false },
      { id: 'slot-6', intId: 'usr-vikram', name: 'Prof. Vikram Sen', email: 'vikram@niat.edu', date: '2026-11-22', start: '10:00 AM', end: '10:45 AM', domain: 'Data Analytics & Intelligence', booked: false },
      { id: 'slot-7', intId: 'usr-meera', name: 'Dr. Meera Iyer', email: 'meera@niat.edu', date: '2026-11-23', start: '02:00 PM', end: '02:45 PM', domain: 'AI Models & LLM Engineering', booked: false },
      { id: 'slot-8', intId: 'usr-meera', name: 'Dr. Meera Iyer', email: 'meera@niat.edu', date: '2026-11-23', start: '04:00 PM', end: '04:45 PM', domain: 'Full Stack Development', booked: false }
    ];

    for (const slot of sampleSlots) {
      await query(`
        INSERT INTO availability_slots (id, interviewer_id, interviewer_name, interviewer_email, slot_date, start_time, end_time, domain, is_booked)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [slot.id, slot.intId, slot.name, slot.email, slot.date, slot.start, slot.end, slot.domain, slot.booked]);
    }
  }

  // 6. Initial Pipeline / Bookings
  const pipelineCheck = await query('SELECT COUNT(*) as count FROM interview_bookings');
  if (parseInt(pipelineCheck.rows[0].count, 10) === 0) {
    const initialPipeline = [
      { id: 'book-1', student_name: 'Aarav Mehta', student_email: 'aarav@niat.edu', student_id: 'NIAT2024-4104', track_id: 'track-fs', track_name: 'Full Stack Development', interviewer_name: 'Dr. Kavita Rao', interviewer_email: 'kavita@niat.edu', date: '2026-11-20', start: '10:00 AM', end: '10:45 AM', status: 'Booked', attempt: '1st', notes: 'Scheduled live defense.' },
      { id: 'book-2', student_name: 'Sneha Patel', student_email: 'sneha@niat.edu', student_id: 'NIAT2024-4105', track_id: 'track-da', track_name: 'Data Analytics & Intelligence', interviewer_name: 'Prof. Vikram Sen', interviewer_email: 'vikram@niat.edu', date: '2026-11-18', start: '11:00 AM', end: '11:45 AM', status: 'Passed', attempt: '1st', notes: 'Strong SQL and model optimization proficiency.' },
      { id: 'book-3', student_name: 'Rohan Varma', student_email: 'rohan@niat.edu', student_id: 'NIAT2024-4102', track_id: 'track-fs', track_name: 'Full Stack Development', interviewer_name: '—', interviewer_email: '', date: '—', start: '—', end: '—', status: 'Not Booked', attempt: '1st', notes: '' },
      { id: 'book-4', student_name: 'Priya Sen', student_email: 'priya@niat.edu', student_id: 'NIAT2024-4103', track_id: 'track-fs', track_name: 'Full Stack Development', interviewer_name: '—', interviewer_email: '', date: '—', start: '—', end: '—', status: 'Not Booked', attempt: '1st', notes: '' }
    ];

    for (const b of initialPipeline) {
      await query(`
        INSERT INTO interview_bookings (id, student_name, student_email, student_id, track_id, track_name, interviewer_name, interviewer_email, interview_date, start_time, end_time, status, attempt, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [b.id, b.student_name, b.student_email, b.student_id, b.track_id, b.track_name, b.interviewer_name, b.interviewer_email, b.date, b.start, b.end, b.status, b.attempt, b.notes]);
    }

    // Award badge for Sneha Patel
    await query(`
      INSERT INTO student_badges (id, student_email, track_id, badge_tier, status)
      VALUES ($1, $2, $3, $4, $5)
    `, ['bdg-1', 'sneha@niat.edu', 'track-da', 'Specialist', 'ACTIVE']);
  }

  // 7. Seed demo student enrollments
  const enrollmentsCheck = await query('SELECT COUNT(*) as count FROM student_enrollments');
  if (parseInt(enrollmentsCheck.rows[0].count, 10) === 0) {
    const sampleEnrollments = [
      { id: 'enr-aarav-fs', email: 'aarav@niat.edu', trackId: 'track-fs', skills: 6, eligible: true },
      { id: 'enr-priya-fs', email: 'priya@niat.edu', trackId: 'track-fs', skills: 6, eligible: true },
      { id: 'enr-rohan-fs', email: 'rohan@niat.edu', trackId: 'track-fs', skills: 6, eligible: true },
      { id: 'enr-sneha-da', email: 'sneha@niat.edu', trackId: 'track-da', skills: 6, eligible: true }
    ];
    for (const e of sampleEnrollments) {
      await query(`
        INSERT INTO student_enrollments (id, student_email, track_id, skills_cleared_count, is_eligible)
        VALUES ($1, $2, $3, $4, $5)
      `, [e.id, e.email, e.trackId, e.skills, e.eligible]);
    }
  }

  console.log('🌱 NextWave initial data seeded in PostgreSQL.');
}

module.exports = {
  getPool,
  query,
  initDb,
  isInMemory: () => isInMemory
};
