// ====================================================================
// NextWave Interview Scheduling & Clearance System — Node/Express API Server
// ====================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Database Warmup Middleware (Guarantees tables and seed data exist before ANY API route runs on Vercel)
let initPromise = null;
function ensureDbInit() {
  if (!initPromise) {
    initPromise = db.initDb().catch(err => {
      console.error('Failed to initialize PostgreSQL database:', err);
      initPromise = null; // Reset so subsequent requests can retry
      throw err;
    });
  }
  return initPromise;
}

app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await ensureDbInit();
    } catch (err) {
      console.error('DB Warmup Error on', req.path, ':', err.message);
      return res.status(500).json({
        success: false,
        status: 'error',
        message: 'Database initialization error: ' + err.message
      });
    }
  }
  next();
});

// Serve static frontend files from current directory
app.use(express.static(__dirname));

// Date & Time Normalization Helpers
function timeToMinutes(t) {
  if (!t || t === '—') return 9999;
  const match = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return 9999;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function normalizeTimeString(t) {
  if (!t || t === '—') return '—';
  let str = String(t).trim();
  if (/am|pm/i.test(str)) {
    return str.toUpperCase();
  }
  const match = str.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${ampm}`;
  }
  return str;
}

function normalizeDateString(d) {
  if (!d || d === '—' || d === 'Upcoming' || d === 'Scheduled') return d;
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(d).trim();
  if (s.includes('T')) {
    return s.split('T')[0];
  }
  return s;
}

// Strict Domain Matching: Verifies if evaluator specialization matches a course track or domain area
function isInterviewerQualifiedForTrack(interviewerSpecialization, trackTitle, trackDomain) {
  if (!interviewerSpecialization) return false;
  const specLower = interviewerSpecialization.toLowerCase();
  const titleLower = (trackTitle || '').toLowerCase().trim();
  const domainLower = (trackDomain || '').toLowerCase().trim();

  if (titleLower && specLower.includes(titleLower)) return true;
  if (domainLower && specLower.includes(domainLower)) return true;

  const parts = specLower.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (titleLower && (part.includes(titleLower) || titleLower.includes(part))) return true;
    if (domainLower && (part.includes(domainLower) || domainLower.includes(part))) return true;
  }
  return false;
}

// ====================================================================
// HEALTH & DB STATUS
// ====================================================================
app.get('/api/health', async (req, res) => {
  try {
    const tracksRes = await db.query('SELECT count(*) as count FROM track_categories');
    const usersRes = await db.query('SELECT count(*) as count FROM users');
    const isMem = db.isInMemory();
    
    res.json({
      status: 'ok',
      brand: 'NextWave',
      engine: 'PostgreSQL',
      mode: isMem ? 'In-Memory (pg-mem)' : 'Remote PostgreSQL (Persistent)',
      isPersistent: !isMem,
      hasPostgresUrl: !!(process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL),
      server_time: new Date().toISOString(),
      counts: {
        tracks: parseInt(tracksRes.rows[0].count, 10),
        users: parseInt(usersRes.rows[0].count, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ====================================================================
// AUTHENTICATION
// ====================================================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }

  try {
    const result = await db.query(
      'SELECT id, name, email, role, niat_id, domain_specialization, is_blocked FROM users WHERE LOWER(email) = LOWER($1) AND password_hash = $2',
      [email.trim(), password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email address or password.' });
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'This account has been temporarily blocked / suspended by Campus Operations.' });
    }

    // Strict role gating: Ensure account matches the portal role
    if (role && user.role !== role) {
      const roleDisplay = user.role === 'admin' ? 'Campus Operations Admin' : (user.role === 'interviewer' ? 'Faculty Evaluator' : 'Student Candidate');
      return res.status(403).json({
        success: false,
        message: `This account is registered as a ${roleDisplay}. Please sign in via the ${roleDisplay} gateway.`
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        niatId: user.niat_id || '',
        domain: user.domain_specialization || 'Full Stack Development'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, niatId, domain } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'Missing required registration fields' });
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
    }

    const userId = 'usr-' + Date.now();
    const finalNiatId = niatId || ('NIAT2024-' + Math.floor(1000 + Math.random() * 9000));
    const finalDomain = domain || 'Full Stack Development';

    await db.query(`
      INSERT INTO users (id, name, email, password_hash, role, niat_id, domain_specialization)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [userId, name.trim(), email.trim().toLowerCase(), password, role, finalNiatId, finalDomain]);

    res.json({
      success: true,
      user: {
        id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        niatId: finalNiatId,
        domain: finalDomain
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email and new password required' });
  }

  try {
    const updateRes = await db.query(
      'UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)',
      [newPassword, email.trim()]
    );

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'No registered user found with this email address.' });
    }

    res.json({ success: true, message: 'Password updated successfully! You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// TRACKS & COURSE CATEGORIES (CRUD + Toggle Active/Disabled)
// ====================================================================
app.get('/api/tracks', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM track_categories ORDER BY is_core DESC, title ASC');
    const tracks = result.rows.map(r => ({
      id: r.id,
      name: r.title,
      domain: r.domain_area,
      badgeTier: r.badge_tier,
      icon: r.icon,
      description: r.description,
      skills: r.skills,
      enrolledCount: r.enrolled_count,
      isCore: r.is_core,
      isActive: r.is_active !== false
    }));
    res.json({ success: true, tracks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/tracks', async (req, res) => {
  const { title, domainArea, badgeTier, icon, description, skills } = req.body;
  if (!title || !domainArea) {
    return res.status(400).json({ success: false, message: 'Title and Domain Area required' });
  }

  const trackId = 'track-' + Date.now();
  const skillsArray = Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s => s.trim()) : ['Core Competencies']);

  try {
    await db.query(`
      INSERT INTO track_categories (id, title, domain_area, badge_tier, icon, description, skills, enrolled_count, is_core, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, false, true)
    `, [trackId, title.trim(), domainArea.trim(), badgeTier || 'Novice', icon || '🚀', description || '', skillsArray]);

    res.json({
      success: true,
      track: {
        id: trackId,
        name: title.trim(),
        domain: domainArea.trim(),
        badgeTier: badgeTier || 'Novice',
        icon: icon || '🚀',
        description: description || '',
        skills: skillsArray,
        enrolledCount: 0,
        isCore: false,
        isActive: true
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Track Category
app.put('/api/tracks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, domainArea, badgeTier, icon, description, skills } = req.body;
  const skillsArray = Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s => s.trim()) : ['Core Competencies']);

  try {
    await db.query(`
      UPDATE track_categories
      SET title = $1, domain_area = $2, badge_tier = $3, icon = $4, description = $5, skills = $6
      WHERE id = $7
    `, [title.trim(), domainArea.trim(), badgeTier || 'Novice', icon || '🚀', description || '', skillsArray, id]);

    res.json({ success: true, message: 'Track updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Track Category
app.delete('/api/tracks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM track_categories WHERE id = $1', [id]);
    res.json({ success: true, message: 'Track deleted successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Toggle Track Active / Disabled
app.patch('/api/tracks/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const cur = await db.query('SELECT is_active FROM track_categories WHERE id = $1', [id]);
    if (cur.rows.length === 0) return res.status(404).json({ success: false, message: 'Track not found' });
    
    const newStatus = !(cur.rows[0].is_active !== false);
    await db.query('UPDATE track_categories SET is_active = $1 WHERE id = $2', [newStatus, id]);
    res.json({ success: true, isActive: newStatus, message: `Track ${newStatus ? 'enabled' : 'disabled'} successfully!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Student Enrollment in a Track
app.post('/api/enroll', async (req, res) => {
  const { studentEmail, trackId } = req.body;
  if (!studentEmail || !trackId) {
    return res.status(400).json({ success: false, message: 'Student email and track ID required' });
  }

  try {
    const existing = await db.query(
      'SELECT id FROM student_enrollments WHERE LOWER(student_email) = LOWER($1) AND track_id = $2',
      [studentEmail.trim(), trackId]
    );

    if (existing.rows.length === 0) {
      await db.query(`
        INSERT INTO student_enrollments (id, student_email, track_id, skills_cleared_count, is_eligible)
        VALUES ($1, $2, $3, 0, false)
      `, ['enr-' + Date.now(), studentEmail.trim().toLowerCase(), trackId]);

      await db.query('UPDATE track_categories SET enrolled_count = enrolled_count + 1 WHERE id = $1', [trackId]);
    }

    res.json({ success: true, message: 'Enrolled successfully in track!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// INTERVIEWERS & AVAILABILITY SLOTS (Multiple Domains, Block, Remove)
// ====================================================================
app.get('/api/interviewers', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, domain_specialization as domain, is_blocked as "isBlocked" FROM users WHERE role = $1 ORDER BY name ASC',
      ['interviewer']
    );
    res.json({ success: true, interviewers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/interviewers', async (req, res) => {
  const { name, email, password, domain, domains } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password required' });
  }

  const finalDomain = Array.isArray(domains) && domains.length > 0 ? domains.join(', ') : (domain || 'Full Stack Development');

  try {
    const userId = 'usr-' + Date.now();
    await db.query(`
      INSERT INTO users (id, name, email, password_hash, role, domain_specialization, is_blocked)
      VALUES ($1, $2, $3, $4, 'interviewer', $5, false)
    `, [userId, name.trim(), email.trim().toLowerCase(), password, finalDomain]);

    res.json({
      success: true,
      interviewer: {
        id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        domain: finalDomain,
        isBlocked: false
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Interviewer Specializations / Info
app.put('/api/interviewers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, domains, domain } = req.body;
  const finalDomain = Array.isArray(domains) && domains.length > 0 ? domains.join(', ') : (domain || 'Full Stack Development');

  try {
    await db.query(`
      UPDATE users
      SET name = $1, email = $2, domain_specialization = $3
      WHERE id = $4
    `, [name.trim(), email.trim().toLowerCase(), finalDomain, id]);

    res.json({ success: true, message: 'Interviewer specializations updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Toggle Interviewer Block / Unblock
app.patch('/api/interviewers/:id/toggle-block', async (req, res) => {
  const { id } = req.params;
  try {
    const cur = await db.query('SELECT is_blocked FROM users WHERE id = $1', [id]);
    if (cur.rows.length === 0) return res.status(404).json({ success: false, message: 'Interviewer not found' });
    
    const newStatus = !(cur.rows[0].is_blocked === true);
    await db.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [newStatus, id]);
    res.json({ success: true, isBlocked: newStatus, message: `Interviewer ${newStatus ? 'blocked' : 'unblocked'} successfully!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Remove Interviewer (Cascading deletion of slots and reassignment of bookings)
app.delete('/api/interviewers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const cur = await db.query('SELECT email, name FROM users WHERE id = $1', [id]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Interviewer not found' });
    }
    const email = cur.rows[0].email.toLowerCase();

    // 1. Delete all availability slots created by this interviewer
    await db.query('DELETE FROM availability_slots WHERE LOWER(interviewer_email) = $1', [email]);

    // 2. Revert any student bookings scheduled with this removed interviewer
    await db.query(`
      UPDATE interview_bookings 
      SET status = 'Not Booked', interview_date = '—', start_time = '—', end_time = '—', 
          interviewer_name = '—', interviewer_email = '', slot_id = NULL,
          notes = 'Assigned evaluator removed by admin. Please select an available faculty evaluator.'
      WHERE LOWER(interviewer_email) = $1 AND status = 'Booked'
    `, [email]);

    // 3. Delete from users table
    await db.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      message: `Evaluator ${cur.rows[0].name} and all availability slots removed successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fetch Available Slots (Only from active, unblocked, existing interviewers matching domain)
app.get('/api/slots', async (req, res) => {
  const { interviewerEmail, domain, track, trackId } = req.query;
  try {
    let sql = `
      SELECT s.*, u.domain_specialization as interviewer_domain, u.name as interviewer_name 
      FROM availability_slots s
      JOIN users u ON LOWER(s.interviewer_email) = LOWER(u.email)
      WHERE u.role = 'interviewer' 
        AND (u.is_blocked IS NULL OR u.is_blocked = false)
    `;
    const params = [];

    if (interviewerEmail) {
      params.push(interviewerEmail.toLowerCase());
      sql += ` AND LOWER(s.interviewer_email) = $${params.length}`;
    }

    const result = await db.query(sql, params);
    let slots = result.rows.map(r => ({
      ...r,
      slot_date: normalizeDateString(r.slot_date),
      start_time: normalizeTimeString(r.start_time),
      end_time: normalizeTimeString(r.end_time)
    }));

    // If a track / domain filter is specified, strictly filter slots by evaluator qualification
    let targetTrackTitle = '';
    let targetTrackDomain = '';
    if (trackId) {
      const tc = await db.query('SELECT title, domain_area FROM track_categories WHERE id = $1', [trackId]);
      if (tc.rows.length > 0) {
        targetTrackTitle = tc.rows[0].title;
        targetTrackDomain = tc.rows[0].domain_area;
      }
    }
    if (!targetTrackTitle && (track || domain)) {
      const filterStr = (track || domain).trim();
      const tc = await db.query('SELECT title, domain_area FROM track_categories WHERE LOWER(title) = LOWER($1) OR LOWER(id) = LOWER($1) OR LOWER(domain_area) = LOWER($1)', [filterStr]);
      if (tc.rows.length > 0) {
        targetTrackTitle = tc.rows[0].title;
        targetTrackDomain = tc.rows[0].domain_area;
      } else {
        targetTrackTitle = filterStr;
      }
    }

    if (targetTrackTitle || targetTrackDomain) {
      slots = slots.filter(s => {
        const spec = s.interviewer_domain || s.domain || '';
        return isInterviewerQualifiedForTrack(spec, targetTrackTitle, targetTrackDomain);
      });
    }

    // Sort strictly chronologically by date and real time
    slots.sort((a, b) => {
      const dateDiff = new Date(a.slot_date) - new Date(b.slot_date);
      if (dateDiff !== 0) return dateDiff;
      return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    });

    res.json({ success: true, slots });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/slots', async (req, res) => {
  const { interviewerId, interviewerName, interviewerEmail, slotDate, startTime, endTime, domain } = req.body;
  if (!interviewerEmail || !slotDate || !startTime || !endTime) {
    return res.status(400).json({ success: false, message: 'Missing slot details' });
  }

  try {
    const cleanDate = normalizeDateString(slotDate);
    const cleanStart = normalizeTimeString(startTime);
    const cleanEnd = normalizeTimeString(endTime);

    // Duplicate check: reject if slot with same date and time already exists for this interviewer
    const existing = await db.query(`
      SELECT id FROM availability_slots 
      WHERE LOWER(interviewer_email) = $1 AND slot_date = $2 AND start_time = $3
    `, [interviewerEmail.toLowerCase(), cleanDate, cleanStart]);

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `An availability slot on ${cleanDate} at ${cleanStart} already exists in your schedule. Duplicate slots are not allowed.`
      });
    }

    const slotId = 'slot-' + Date.now() + '-' + Math.floor(Math.random() * 100);

    await db.query(`
      INSERT INTO availability_slots (id, interviewer_id, interviewer_name, interviewer_email, slot_date, start_time, end_time, domain, is_booked)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
    `, [slotId, interviewerId || 'usr-int', interviewerName, interviewerEmail.toLowerCase(), cleanDate, cleanStart, cleanEnd, domain || 'Full Stack Development']);

    res.json({
      success: true,
      message: 'New interview clearance slot published successfully!',
      slot: {
        id: slotId,
        interviewer_name: interviewerName,
        interviewer_email: interviewerEmail.toLowerCase(),
        slot_date: cleanDate,
        start_time: cleanStart,
        end_time: cleanEnd,
        domain: domain || 'Full Stack Development',
        is_booked: false
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/slots/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM availability_slots WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Slot deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// BOOKING & OUTCOME RECORDING (STUDENT & INTERVIEWER)
// ====================================================================
app.post('/api/bookings', async (req, res) => {
  const {
    studentName, studentEmail, studentId, trackId, trackName,
    slotId, interviewerName, interviewerEmail, interviewDate, startTime, endTime
  } = req.body;

  if (!studentEmail || !interviewDate || !startTime) {
    return res.status(400).json({ success: false, message: 'Missing booking details' });
  }

  try {
    // 1. Validate slot availability and verify evaluator is active & unblocked
    if (slotId) {
      const slotCheck = await db.query(`
        SELECT s.id, s.is_booked, s.domain as slot_domain, 
               u.domain_specialization, u.name as interviewer_name, u.email as interviewer_email, u.is_blocked 
        FROM availability_slots s
        JOIN users u ON LOWER(s.interviewer_email) = LOWER(u.email)
        WHERE s.id = $1
      `, [slotId]);

      if (slotCheck.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'This slot is no longer available because the evaluator account was removed.' });
      }

      if (slotCheck.rows[0].is_booked) {
        return res.status(400).json({ success: false, message: 'This slot has already been reserved by another candidate.' });
      }

      if (slotCheck.rows[0].is_blocked) {
        return res.status(400).json({ success: false, message: 'This evaluator is temporarily suspended / unavailable.' });
      }

      // Domain Specialization Guard: Validate that the evaluator is qualified to evaluate this track!
      const targetTrack = trackName || trackId || '';
      let targetTrackDomain = '';
      if (trackId) {
        const tc = await db.query('SELECT title, domain_area FROM track_categories WHERE id = $1', [trackId]);
        if (tc.rows.length > 0) {
          targetTrackDomain = tc.rows[0].domain_area;
        }
      }

      const evaluatorSpec = slotCheck.rows[0].domain_specialization || slotCheck.rows[0].slot_domain || '';
      if (!isInterviewerQualifiedForTrack(evaluatorSpec, targetTrack, targetTrackDomain)) {
        return res.status(400).json({
          success: false,
          message: `Evaluation Domain Mismatch: ${slotCheck.rows[0].interviewer_name} specializes in (${evaluatorSpec}), which does not match "${targetTrack}". Please select an evaluator assigned to this track.`
        });
      }

      await db.query('UPDATE availability_slots SET is_booked = true WHERE id = $1', [slotId]);
    }

    // 2. Check existing booking for this student and THIS SPECIFIC TRACK
    const existing = await db.query(
      'SELECT id FROM interview_bookings WHERE LOWER(student_email) = LOWER($1) AND (track_id = $2 OR track_name = $3)',
      [studentEmail.trim(), trackId || '', trackName || '']
    );

    const cleanDate = normalizeDateString(interviewDate);
    const cleanStart = normalizeTimeString(startTime);
    const cleanEnd = normalizeTimeString(endTime);

    let bookingId;
    if (existing.rows.length > 0) {
      bookingId = existing.rows[0].id;
      await db.query(`
        UPDATE interview_bookings
        SET slot_id = $1, interviewer_name = $2, interviewer_email = $3,
            interview_date = $4, start_time = $5, end_time = $6, status = 'Booked',
            notes = 'Scheduled slot.'
        WHERE id = $7
      `, [slotId, interviewerName, interviewerEmail, cleanDate, cleanStart, cleanEnd, bookingId]);
    } else {
      bookingId = 'book-' + Date.now();
      await db.query(`
        INSERT INTO interview_bookings (id, slot_id, student_name, student_email, student_id, track_id, track_name, interviewer_name, interviewer_email, interview_date, start_time, end_time, status, attempt, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Booked', '1st', 'Scheduled slot.')
      `, [bookingId, slotId, studentName, studentEmail.toLowerCase(), studentId, trackId || 'track-fs', trackName, interviewerName, interviewerEmail, cleanDate, cleanStart, cleanEnd]);
    }

    res.json({
      success: true,
      message: 'Interview booked successfully!',
      bookingId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cancel Booking (Specific to track / booking)
app.post('/api/bookings/cancel', async (req, res) => {
  const { bookingId, studentEmail, trackId, slotId } = req.body;
  try {
    if (slotId) {
      await db.query('UPDATE availability_slots SET is_booked = false WHERE id = $1', [slotId]);
    }
    if (bookingId) {
      await db.query('UPDATE availability_slots SET is_booked = false WHERE id IN (SELECT slot_id FROM interview_bookings WHERE id = $1)', [bookingId]);
      await db.query(
        "UPDATE interview_bookings SET status = 'Not Booked', interview_date = '—', start_time = '—', end_time = '—', interviewer_name = '—', notes = '' WHERE id = $1",
        [bookingId]
      );
    } else if (studentEmail && trackId) {
      await db.query('UPDATE availability_slots SET is_booked = false WHERE id IN (SELECT slot_id FROM interview_bookings WHERE LOWER(student_email) = LOWER($1) AND (track_id = $2 OR track_name = $2))', [studentEmail, trackId]);
      await db.query(
        "UPDATE interview_bookings SET status = 'Not Booked', interview_date = '—', start_time = '—', end_time = '—', interviewer_name = '—', notes = '' WHERE LOWER(student_email) = LOWER($1) AND (track_id = $2 OR track_name = $2)",
        [studentEmail.toLowerCase(), trackId]
      );
    } else if (studentEmail) {
      await db.query(
        "UPDATE interview_bookings SET status = 'Not Booked', interview_date = '—', start_time = '—', end_time = '—', interviewer_name = '—', notes = '' WHERE LOWER(student_email) = LOWER($1)",
        [studentEmail.toLowerCase()]
      );
    }
    res.json({ success: true, message: 'Booking cancelled.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Record Outcome (Interviewer Evaluates)
app.post('/api/evaluations', async (req, res) => {
  const {
    bookingId, studentEmail, studentName, trackId, trackName,
    interviewerEmail, interviewerName, decision, scoreTech, scoreComm, scoreProb, feedbackNotes
  } = req.body;

  if (!decision || !studentEmail) {
    return res.status(400).json({ success: false, message: 'Decision and student email required' });
  }

  try {
    // 1. Resolve reviewer full name so feedback never displays '—'
    let resolvedInterviewerName = interviewerName;
    if ((!resolvedInterviewerName || resolvedInterviewerName === '—') && interviewerEmail) {
      const uRes = await db.query('SELECT name FROM users WHERE LOWER(email) = LOWER($1)', [interviewerEmail.toLowerCase()]);
      if (uRes.rows.length > 0) resolvedInterviewerName = uRes.rows[0].name;
    }
    if (!resolvedInterviewerName || resolvedInterviewerName === '—') {
      resolvedInterviewerName = (trackName && trackName.includes('Data')) ? 'Prof. Vikram Sen' :
                                (trackName && trackName.includes('Cloud')) ? 'Prof. Rajesh Nair' : 'Dr. Kavita Rao';
    }

    // 2. Insert evaluation record
    const evalId = 'eval-' + Date.now();
    await db.query(`
      INSERT INTO interview_evaluations (id, booking_id, interviewer_email, decision, score_technical, score_communication, score_problem_solving, feedback_notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [evalId, bookingId || 'b-default', interviewerEmail || '', decision, scoreTech || 4, scoreComm || 4, scoreProb || 4, feedbackNotes || '']);

    // 3. Map decision to booking status
    const statusMap = {
      'PASS': 'Passed',
      'FAIL': 'Failed',
      'RETAKE': 'Retake'
    };
    const finalStatus = statusMap[decision] || 'Passed';
    const resolvedInterviewerEmail = interviewerEmail || 'kavita@niat.edu';

    await db.query(`
      UPDATE interview_bookings
      SET status = $1, notes = $2,
          interviewer_name = $3,
          interviewer_email = $4
      WHERE id = $5 OR (LOWER(student_email) = LOWER($6) AND (track_id = $7 OR track_name = $8))
    `, [finalStatus, feedbackNotes || '', resolvedInterviewerName, resolvedInterviewerEmail, bookingId, studentEmail.toLowerCase(), trackId || '', trackName || '']);

    // 4. If passed, grant Track Badge in student_badges table
    if (decision === 'PASS') {
      const badgeId = 'bdg-' + Date.now();
      await db.query(`
        INSERT INTO student_badges (id, student_email, track_id, badge_tier, status)
        VALUES ($1, $2, $3, 'Certified Badge', 'ACTIVE')
      `, [badgeId, studentEmail.toLowerCase(), trackId || 'track-fs']);
    }

    res.json({ success: true, message: `Interview outcome recorded as ${finalStatus} by ${resolvedInterviewerName}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// STUDENT DASHBOARD AGGREGATED DATA & SKILLS PROGRESSION
// ====================================================================
app.get('/api/student/dashboard/:email', async (req, res) => {
  const email = req.params.email.toLowerCase();

  try {
    const bookings = await db.query(
      'SELECT * FROM interview_bookings WHERE LOWER(student_email) = $1 ORDER BY booked_at DESC',
      [email]
    );

    const badges = await db.query(`
      SELECT sb.*, COALESCE(tc.title, sb.track_id) as badge_name, tc.icon as badge_icon, tc.domain_area as domain
      FROM student_badges sb
      LEFT JOIN track_categories tc ON sb.track_id = tc.id
      WHERE LOWER(sb.student_email) = $1 AND sb.status = 'ACTIVE'
    `, [email]);

    badges.rows.forEach(b => {
      if (!b.credential_id) {
        const numPart = b.id ? b.id.replace(/\D/g, '').slice(-4) : '';
        b.credential_id = 'NXW-CERT-2026-' + (numPart && numPart.length >= 2 ? numPart.padStart(4, '0') : '8899');
      }
    });

    const enrollments = await db.query(`
      SELECT se.id, se.track_id as "trackId", se.skills_cleared_count as "skillsCleared", 
             se.is_eligible as "isEligible", tc.title as "trackTitle", tc.icon as "trackIcon", 
             tc.badge_tier as "badgeTier", tc.skills, tc.domain_area as "domain"
      FROM student_enrollments se 
      JOIN track_categories tc ON se.track_id = tc.id 
      WHERE LOWER(se.student_email) = $1
      ORDER BY se.enrolled_at ASC
    `, [email]);

    const formattedBookings = bookings.rows.map(b => {
      let intName = (b.interviewer_name && b.interviewer_name !== '—') ? b.interviewer_name.trim() : '';
      if (!intName) {
        if (b.status === 'Passed' || b.status === 'Booked') {
          intName = (b.track_name && b.track_name.includes('Data')) ? 'Prof. Vikram Sen' :
                    (b.track_name && b.track_name.includes('Cloud')) ? 'Prof. Rajesh Nair' : 'Dr. Kavita Rao';
        } else {
          intName = '—';
        }
      }
      return {
        ...b,
        interviewer_name: intName,
        interview_date: normalizeDateString(b.interview_date),
        start_time: normalizeTimeString(b.start_time),
        end_time: normalizeTimeString(b.end_time)
      };
    });

    // Find active booked booking first, or latest booking
    const activeBooking = formattedBookings.find(b => b.status === 'Booked') || formattedBookings[0] || null;

    res.json({
      success: true,
      booking: activeBooking,
      bookings: formattedBookings,
      badges: badges.rows,
      enrollments: enrollments.rows,
      enrolledTrackIds: enrollments.rows.map(r => r.trackId)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Student Clears a Contest Skill Level
app.post('/api/student/clear-skill', async (req, res) => {
  const { studentEmail, trackId } = req.body;
  if (!studentEmail || !trackId) {
    return res.status(400).json({ success: false, message: 'Student email and track ID required' });
  }

  const email = studentEmail.trim().toLowerCase();

  try {
    // 1. Get track info
    const trackRes = await db.query('SELECT * FROM track_categories WHERE id = $1', [trackId]);
    if (trackRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Track not found' });
    }
    const track = trackRes.rows[0];
    const totalSkills = Array.isArray(track.skills) ? track.skills.length : 6;

    // 2. Get student enrollment
    const enrRes = await db.query(
      'SELECT * FROM student_enrollments WHERE LOWER(student_email) = $1 AND track_id = $2',
      [email, trackId]
    );
    if (enrRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this track' });
    }

    const currentCount = enrRes.rows[0].skills_cleared_count || 0;
    const newCount = Math.min(currentCount + 1, totalSkills);
    const isNowEligible = newCount >= totalSkills;

    // 3. Update enrollment
    await db.query(`
      UPDATE student_enrollments 
      SET skills_cleared_count = $1, is_eligible = $2 
      WHERE LOWER(student_email) = $3 AND track_id = $4
    `, [newCount, isNowEligible, email, trackId]);

    // 4. If student has achieved eligibility, ensure pipeline entry exists
    if (isNowEligible) {
      const userRes = await db.query('SELECT name, niat_id FROM users WHERE LOWER(email) = $1', [email]);
      const studentName = userRes.rows.length > 0 ? userRes.rows[0].name : 'Student';
      const studentId = userRes.rows.length > 0 ? (userRes.rows[0].niat_id || 'NIAT-2026') : 'NIAT-2026';

      const existingBooking = await db.query(
        'SELECT id FROM interview_bookings WHERE LOWER(student_email) = $1 AND track_id = $2',
        [email, trackId]
      );

      if (existingBooking.rows.length === 0) {
        const bookId = 'book-' + Date.now();
        await db.query(`
          INSERT INTO interview_bookings (id, student_name, student_email, student_id, track_id, track_name, interviewer_name, interviewer_email, interview_date, start_time, end_time, status, attempt, notes)
          VALUES ($1, $2, $3, $4, $5, $6, '—', '', '—', '—', '—', 'Not Booked', '1st', 'Cleared contest skill prerequisites.')
        `, [bookId, studentName, email, studentId, trackId, track.title]);
      }
    }

    res.json({
      success: true,
      skillsCleared: newCount,
      totalSkills,
      isEligible: isNowEligible,
      message: isNowEligible 
        ? `🎉 All ${totalSkills} contest skills cleared! You are now eligible to book your live Level Clearance Interview!`
        : `✓ Skill contest cleared! (${newCount}/${totalSkills} skills completed)`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// ADMIN PIPELINE, AUDIT & MALPRACTICE REVOCATION
// ====================================================================
app.get('/api/pipeline', async (req, res) => {
  const { track, status, interviewerEmail } = req.query;

  try {
    let sql = 'SELECT * FROM interview_bookings WHERE 1=1';
    const params = [];

    if (track && track !== 'all') {
      params.push(track);
      sql += ` AND track_name = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    if (interviewerEmail) {
      const userRes = await db.query('SELECT role, domain_specialization FROM users WHERE LOWER(email) = $1', [interviewerEmail.toLowerCase()]);
      if (userRes.rows.length > 0 && userRes.rows[0].role === 'interviewer') {
        const spec = userRes.rows[0].domain_specialization || '';
        params.push(interviewerEmail.toLowerCase());
        const emailIdx = params.length;

        const domains = spec.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        let domainConditions = '';
        if (domains.length > 0) {
          const domainClauses = domains.map(d => {
            params.push(`%${d}%`);
            return `LOWER(track_name) LIKE $${params.length}`;
          });
          domainConditions = ` OR (status = 'Not Booked' AND (${domainClauses.join(' OR ')}))`;
        }

        sql += ` AND (LOWER(interviewer_email) = $${emailIdx}${domainConditions})`;
      }
    }

    sql += ' ORDER BY booked_at DESC';
    const result = await db.query(sql, params);
    
    // Map to frontend pipeline object format
    const pipeline = result.rows.map(r => ({
      bookingId: r.id,
      id: r.student_id,
      name: r.student_name,
      email: r.student_email,
      trackId: r.track_id,
      track: r.track_name,
      status: r.status,
      date: normalizeDateString(r.interview_date),
      time: normalizeTimeString(r.start_time),
      endTime: normalizeTimeString(r.end_time),
      interviewer: r.interviewer_name,
      interviewerEmail: r.interviewer_email,
      attempt: r.attempt,
      notes: r.notes || ''
    }));

    res.json({ success: true, pipeline });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/flag-malpractice', async (req, res) => {
  const { studentEmail, studentName, trackName, trackId, bookingId, adminName, reason } = req.body;
  if ((!studentEmail && !studentName && !bookingId) || !reason) {
    return res.status(400).json({ success: false, message: 'Student email or name and reason required' });
  }

  try {
    const rawEmail = (studentEmail || '').trim().toLowerCase();
    const findingReason = reason.trim();

    // 1. Identify the exact booking record targeted
    let bookingMatch = null;
    if (bookingId) {
      const bRes = await db.query('SELECT * FROM interview_bookings WHERE id = $1', [bookingId]);
      if (bRes.rows.length > 0) bookingMatch = bRes.rows[0];
    }
    if (!bookingMatch && rawEmail) {
      const bRes = await db.query(
        'SELECT * FROM interview_bookings WHERE LOWER(student_email) = $1 AND (track_id = $2 OR LOWER(track_name) = LOWER($3))',
        [rawEmail, trackId || '', trackName || '']
      );
      if (bRes.rows.length > 0) bookingMatch = bRes.rows[0];
    }
    if (!bookingMatch && studentName) {
      const bRes = await db.query(
        'SELECT * FROM interview_bookings WHERE LOWER(student_name) = LOWER($1) AND (track_id = $2 OR LOWER(track_name) = LOWER($3))',
        [studentName.trim(), trackId || '', trackName || '']
      );
      if (bRes.rows.length > 0) bookingMatch = bRes.rows[0];
    }
    if (!bookingMatch && rawEmail) {
      const bRes = await db.query('SELECT * FROM interview_bookings WHERE LOWER(student_email) = $1', [rawEmail]);
      if (bRes.rows.length > 0) bookingMatch = bRes.rows[0];
    }
    if (!bookingMatch && studentName) {
      const bRes = await db.query('SELECT * FROM interview_bookings WHERE LOWER(student_name) = LOWER($1)', [studentName.trim()]);
      if (bRes.rows.length > 0) bookingMatch = bRes.rows[0];
    }

    const resolvedEmail = bookingMatch ? bookingMatch.student_email.toLowerCase() : rawEmail;
    const resolvedName = bookingMatch ? bookingMatch.student_name : (studentName || 'Candidate');
    const resolvedTrackName = bookingMatch ? bookingMatch.track_name : (trackName || 'Technical Track');
    const resolvedTrackId = bookingMatch ? bookingMatch.track_id : (trackId || '');

    // 2. Update status of the targeted booking to 'Flagged'
    if (bookingMatch) {
      await db.query(
        "UPDATE interview_bookings SET status = 'Flagged', notes = $1 WHERE id = $2",
        ['Malpractice Finding: ' + findingReason, bookingMatch.id]
      );
    } else {
      await db.query(
        "UPDATE interview_bookings SET status = 'Flagged', notes = $1 WHERE LOWER(student_email) = $2 AND (track_id = $3 OR LOWER(track_name) = LOWER($4))",
        ['Malpractice Finding: ' + findingReason, resolvedEmail, resolvedTrackId, resolvedTrackName]
      );
    }

    // 3. Revoke ONLY the badge for this course track in student_badges table
    // Delete and revoke so that other track credentials are NOT touched!
    if (resolvedTrackId || resolvedTrackName) {
      await db.query(
        "UPDATE student_badges SET status = 'REVOKED', revocation_reason = $1, revoked_at = CURRENT_TIMESTAMP WHERE LOWER(student_email) = $2 AND (track_id = $3 OR LOWER(track_id) = LOWER($4))",
        [findingReason, resolvedEmail, resolvedTrackId, resolvedTrackName]
      );
      await db.query(
        "DELETE FROM student_badges WHERE LOWER(student_email) = $1 AND (track_id = $2 OR LOWER(track_id) = LOWER($3))",
        [resolvedEmail, resolvedTrackId, resolvedTrackName]
      );
    }

    // 4. Log into malpractice_audit_logs with specific track details
    const auditId = 'log-' + Date.now();
    await db.query(`
      INSERT INTO malpractice_audit_logs (id, student_email, student_name, track_name, flagged_by, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [auditId, resolvedEmail, resolvedName, resolvedTrackName, adminName || 'Campus Admin', findingReason]);

    res.json({
      success: true,
      message: `Malpractice flagged for ${resolvedName} (${resolvedTrackName}). Badge nullified and recorded in audit log.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/audit-logs', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM malpractice_audit_logs ORDER BY flagged_at DESC');
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================================================================
// USER ACCOUNTS MANAGEMENT (Students, Interviewers, Admins)
// ====================================================================
app.get('/api/users', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, email, role, niat_id as "niatId", 
             domain_specialization as domain, is_blocked as "isBlocked", 
             created_at as "createdAt"
      FROM users 
      ORDER BY 
        CASE 
          WHEN role = 'admin' THEN 1 
          WHEN role = 'interviewer' THEN 2 
          ELSE 3 
        END, 
        name ASC
    `);
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Toggle User Block / Unblock
app.patch('/api/users/:id/toggle-block', async (req, res) => {
  const { id } = req.params;
  try {
    const userRes = await db.query('SELECT id, email, is_blocked, role FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];
    if (user.email.toLowerCase() === 'admin@niat.edu') {
      return res.status(403).json({ success: false, message: 'Master Administrator account cannot be blocked.' });
    }

    const newStatus = !(user.is_blocked === true);
    await db.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [newStatus, id]);

    res.json({
      success: true,
      isBlocked: newStatus,
      message: `User ${user.email} is now ${newStatus ? 'blocked' : 'active'}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete User Account
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const userRes = await db.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];
    if (user.email.toLowerCase() === 'admin@niat.edu') {
      return res.status(403).json({ success: false, message: 'Master Administrator account cannot be removed.' });
    }

    const email = user.email.toLowerCase();

    // Clean up dependent tables
    if (user.role === 'interviewer') {
      // Revert any scheduled student bookings so candidates can re-schedule with another faculty member
      await db.query(`
        UPDATE interview_bookings 
        SET status = 'Not Booked', interview_date = '—', start_time = '—', end_time = '—', 
            interviewer_name = '—', interviewer_email = '', slot_id = NULL,
            notes = 'Assigned evaluator removed by admin. Please select an available faculty evaluator.'
        WHERE LOWER(interviewer_email) = $1 AND status = 'Booked'
      `, [email]);
      await db.query('DELETE FROM availability_slots WHERE LOWER(interviewer_email) = $1', [email]);
    } else {
      await db.query('DELETE FROM interview_bookings WHERE LOWER(student_email) = $1', [email]);
      await db.query('DELETE FROM student_enrollments WHERE LOWER(student_email) = $1', [email]);
      await db.query('DELETE FROM student_badges WHERE LOWER(student_email) = $1', [email]);
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      message: `User account ${user.email} and all associated records permanently removed.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start local server if not running inside Vercel serverless functions
if (!process.env.VERCEL) {
  ensureDbInit().then(() => {
    const server = app.listen(PORT, () => {
      console.log(`🚀 NextWave Clearance System Server running at http://localhost:${PORT}`);
      console.log(`🐘 Powered by PostgreSQL Database Engine`);
    });
    server.on('error', err => {
      console.error('Server listen error:', err);
    });
  }).catch(err => {
    console.error('Failed to initialize PostgreSQL database:', err);
  });
}

module.exports = app;
