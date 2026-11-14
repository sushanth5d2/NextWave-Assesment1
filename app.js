// ====================================================================
// NextWave Interview Scheduler — PostgreSQL Data Client & Shared Logic
// ====================================================================

const API_BASE = '/api';
const DB_VERSION = 'v4_nextwave_postgresql';

// Clear legacy grit keys if version bumped
if (localStorage.getItem('nextwave_db_version') !== DB_VERSION) {
  ['grit_tracks_db', 'grit_enrollments_db', 'grit_slots_db', 'grit_pipeline_db', 'grit_users_db', 'grit_user', 'grit_db_version'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('nextwave_db_version', DB_VERSION);
}

// Global status initialization (no floating pill)
async function initPgStatusBadge() {
  // Floating pill disabled as requested
}
document.addEventListener('DOMContentLoaded', initPgStatusBadge);

// --- Auth Helpers ---
function getUser() {
  const u = localStorage.getItem('nextwave_user');
  return u ? JSON.parse(u) : null;
}

function getCurrentUser() {
  return getUser();
}

function setUser(user) {
  localStorage.setItem('nextwave_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('nextwave_user');
  window.location.href = 'index.html';
}

function requireAuth(allowedRoles) {
  const user = getUser();
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!user || !roles.includes(user.role)) {
    const redirectRole = roles[0] || 'student';
    window.location.href = 'login.html?role=' + redirectRole;
    return null;
  }
  return user;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

// ==========================================
// DATE & TIME FORMATTING UTILITIES
// ==========================================
function formatDisplayDate(dateVal, format = 'long') {
  if (!dateVal || dateVal === '—' || dateVal === 'Upcoming' || dateVal === 'Scheduled') {
    return dateVal || 'Upcoming';
  }
  try {
    let clean = String(dateVal).trim();
    if (clean.includes('T')) {
      clean = clean.split('T')[0];
    }
    const parts = clean.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        if (format === 'short') {
          return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }); // e.g. "Nov 21, 2026"
        }
        if (format === 'weekday') {
          return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }); // e.g. "Sat, Nov 21, 2026"
        }
        // default 'long'
        return d.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }); // e.g. "Saturday, November 21, 2026"
      }
    }
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      if (format === 'short') {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (format === 'weekday') {
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
  } catch (e) {}
  return String(dateVal);
}

function formatDisplayTime(startTime, endTime) {
  if (!startTime || startTime === '—') return '—';
  const normalize = (t) => {
    if (!t || t === '—') return '';
    let s = String(t).trim();
    if (/am|pm/i.test(s)) return s.toUpperCase();
    const match = s.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = match[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    }
    return s;
  };

  const sNorm = normalize(startTime);
  const eNorm = normalize(endTime);
  if (eNorm && eNorm !== sNorm) {
    return `${sNorm} – ${eNorm}`;
  }
  return sNorm;
}

function formatInterviewSchedule(dateVal, startTime, endTime) {
  const d = formatDisplayDate(dateVal, 'weekday');
  const t = formatDisplayTime(startTime, endTime);
  if (d === 'Upcoming' || d === '—') return 'Upcoming';
  if (t && t !== '—') {
    return `${d} · ${t}`;
  }
  return d;
}

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

// --- Registered Users DB & Auth ---
async function apiLogin(email, password, role) {
  try {
    const res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    return await res.json();
  } catch (e) {
    // Local fallback
    const users = getUsers();
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
    if (!u) return { success: false, message: 'Invalid email address or password.' };
    return { success: true, user: u };
  }
}

async function apiRegister(userData) {
  try {
    const res = await fetch(API_BASE + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    return await res.json();
  } catch (e) {
    // Local fallback
    const users = getUsers();
    users.push(userData);
    saveUsers(users);
    return { success: true, user: userData };
  }
}

async function apiResetPassword(email, newPassword) {
  try {
    const res = await fetch(API_BASE + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword })
    });
    return await res.json();
  } catch (e) {
    const users = getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { success: false, message: 'No registered user found.' };
    users[idx].password = newPassword;
    saveUsers(users);
    return { success: true, message: 'Password updated successfully!' };
  }
}

function getUsers() {
  const u = localStorage.getItem('nextwave_users_db');
  return u ? JSON.parse(u) : [];
}

function saveUsers(users) {
  localStorage.setItem('nextwave_users_db', JSON.stringify(users));
}

async function fetchUsersFromPg() {
  try {
    const res = await fetch(API_BASE + '/users');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.users) {
        localStorage.setItem('nextwave_users_db', JSON.stringify(data.users));
        return data.users;
      }
    }
  } catch (e) {
    console.warn('API offline, reading local users');
  }
  return getUsers();
}

async function toggleUserBlock(userId) {
  try {
    const res = await fetch(API_BASE + '/users/' + encodeURIComponent(userId) + '/toggle-block', {
      method: 'PATCH'
    });
    return await res.json();
  } catch (e) {
    console.warn('API offline');
    return { success: false, message: 'Server unreachable' };
  }
}

async function deleteUser(userId) {
  try {
    const res = await fetch(API_BASE + '/users/' + encodeURIComponent(userId), {
      method: 'DELETE'
    });
    return await res.json();
  } catch (e) {
    console.warn('API offline');
    return { success: false, message: 'Server unreachable' };
  }
}

// ==========================================
// COURSE & TRACK CATEGORIES (PostgreSQL Backed)
// ==========================================
async function fetchTracksFromPg() {
  try {
    const res = await fetch(API_BASE + '/tracks');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.tracks) {
        localStorage.setItem('nextwave_tracks_db', JSON.stringify(data.tracks));
        return data.tracks;
      }
    }
  } catch (e) {
    console.warn('Could not fetch tracks from PostgreSQL, using local cache');
  }
  return getTracks();
}

function getTracks() {
  const t = localStorage.getItem('nextwave_tracks_db');
  if (t) return JSON.parse(t);

  const initialTracks = [
    {
      id: 'track-fs',
      name: 'Full Stack Development',
      domain: 'AI Product Mastery',
      badgeTier: 'Novice',
      icon: '🌐',
      description: 'Master modern frontend UI engineering, robust backend microservices, SQL databases, and applied Gen AI development.',
      skills: ['Computational Thinking', 'UI Engineering', 'Server Side Engineering', 'SQL', 'Applied Gen AI Development', 'CS Fundamentals'],
      enrolledCount: 14,
      isCore: true
    },
    {
      id: 'track-da',
      name: 'Data Analytics & Intelligence',
      domain: 'Data & Systems',
      badgeTier: 'Specialist',
      icon: '📊',
      description: 'Harness Python, advanced SQL, exploratory data analysis, business intelligence modeling, and machine learning foundations.',
      skills: ['Python Foundations', 'SQL Queries', 'Statistical Analysis', 'Pandas & EDA', 'Data Visualization', 'ML Foundations'],
      enrolledCount: 11,
      isCore: true
    },
    {
      id: 'track-cloud',
      name: 'Cloud & DevOps Architecture',
      domain: 'AI Systems Mastery',
      badgeTier: 'Specialist',
      icon: '☁️',
      description: 'Architect scalable cloud infrastructure, containerized deployments, automated CI/CD pipelines, and infrastructure-as-code.',
      skills: ['Linux Internals', 'Networking Protocols', 'AWS Core Architecture', 'Docker Containerization', 'CI/CD Workflows', 'Terraform'],
      enrolledCount: 9,
      isCore: true
    },
    {
      id: 'track-aimodels',
      name: 'AI Models & LLM Engineering',
      domain: 'AI Models Mastery',
      badgeTier: 'Expert',
      icon: '🧠',
      description: 'Train, fine-tune, and deploy transformer architectures, retrieval augmented generation (RAG) agents, and deep neural networks.',
      skills: ['PyTorch Foundations', 'Transformer Architecture', 'LLM Fine-Tuning', 'Vector Databases & RAG', 'Agentic Systems', 'Model Benchmarking'],
      enrolledCount: 7,
      isCore: false
    },
    {
      id: 'track-cyber',
      name: 'Cyber Security & Cloud Defense',
      domain: 'Security & Infrastructure',
      badgeTier: 'Specialist',
      icon: '🛡️',
      description: 'Secure enterprise cloud workloads, perform threat modeling, penetrate test API endpoints, and defend networks.',
      skills: ['Network Security', 'Cryptography', 'Cloud IAM Security', 'Vulnerability Assessment', 'Incident Response'],
      enrolledCount: 8,
      isCore: false
    }
  ];

  localStorage.setItem('nextwave_tracks_db', JSON.stringify(initialTracks));
  return initialTracks;
}

function saveTracks(tracks) {
  localStorage.setItem('nextwave_tracks_db', JSON.stringify(tracks));
}

async function addTrack(trackData) {
  try {
    const res = await fetch(API_BASE + '/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trackData)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        await fetchTracksFromPg();
        return data.track;
      }
    }
  } catch (e) {
    console.warn('API offline, adding locally');
  }

  const tracks = getTracks();
  const newTrack = {
    id: 'track-' + Date.now(),
    name: trackData.title || trackData.name,
    domain: trackData.domainArea || trackData.domain || 'General Track',
    badgeTier: trackData.badgeTier || 'Novice',
    icon: trackData.icon || '🚀',
    description: trackData.description || 'Master key engineering competencies to unlock this Track Badge.',
    skills: Array.isArray(trackData.skills) ? trackData.skills : trackData.skills.split(',').map(s => s.trim()),
    enrolledCount: 0,
    isCore: false
  };
  tracks.push(newTrack);
  saveTracks(tracks);
  return newTrack;
}

async function updateTrack(trackId, trackData) {
  try {
    const res = await fetch(API_BASE + '/tracks/' + encodeURIComponent(trackId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trackData)
    });
    if (res.ok) {
      await fetchTracksFromPg();
      return true;
    }
  } catch (e) {
    console.warn('API offline');
  }
  const tracks = getTracks();
  const idx = tracks.findIndex(t => t.id === trackId);
  if (idx !== -1) {
    tracks[idx] = Object.assign(tracks[idx], trackData);
    saveTracks(tracks);
  }
  return true;
}

async function deleteTrack(trackId) {
  try {
    const res = await fetch(API_BASE + '/tracks/' + encodeURIComponent(trackId), {
      method: 'DELETE'
    });
    if (res.ok) {
      await fetchTracksFromPg();
      return true;
    }
  } catch (e) {
    console.warn('API offline');
  }
  let tracks = getTracks().filter(t => t.id !== trackId);
  saveTracks(tracks);
  return true;
}

async function toggleTrackActive(trackId) {
  try {
    const res = await fetch(API_BASE + '/tracks/' + encodeURIComponent(trackId) + '/toggle', {
      method: 'PATCH'
    });
    if (res.ok) {
      const data = await res.json();
      await fetchTracksFromPg();
      return data;
    }
  } catch (e) {
    console.warn('API offline');
  }
  const tracks = getTracks();
  const t = tracks.find(x => x.id === trackId);
  if (t) {
    t.isActive = !t.isActive;
    saveTracks(tracks);
    return { success: true, isActive: t.isActive };
  }
  return { success: false };
}

async function updateInterviewer(id, data) {
  try {
    const res = await fetch(API_BASE + '/interviewers/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) {
    console.warn('API offline');
    return false;
  }
}

async function toggleInterviewerBlock(id) {
  try {
    const res = await fetch(API_BASE + '/interviewers/' + encodeURIComponent(id) + '/toggle-block', {
      method: 'PATCH'
    });
    localStorage.removeItem('nextwave_slots_db');
    localStorage.removeItem('nextwave_pipeline_db');
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('API offline');
  }
  return { success: false };
}

async function deleteInterviewer(id) {
  try {
    const res = await fetch(API_BASE + '/interviewers/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
    localStorage.removeItem('nextwave_slots_db');
    localStorage.removeItem('nextwave_pipeline_db');
    return res.ok;
  } catch (e) {
    console.warn('API offline');
    return false;
  }
}

// --- Track Enrollments & Skills Progression ---
async function fetchStudentDashboard(studentEmail) {
  try {
    const res = await fetch(API_BASE + '/student/dashboard/' + encodeURIComponent(studentEmail) + '?_t=' + Date.now());
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Dashboard API offline:', e);
  }
  return { success: false, booking: null, badges: [], enrollments: [] };
}

async function enrollStudentInTrack(studentEmail, trackId) {
  try {
    const res = await fetch(API_BASE + '/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentEmail, trackId })
    });
    if (res.ok) {
      await fetchTracksFromPg();
      return await res.json();
    }
  } catch (e) {
    console.warn('Enrollment API offline, saving locally');
  }

  const all = localStorage.getItem('nextwave_enrollments_db');
  const db = all ? JSON.parse(all) : {};
  const emailKey = studentEmail.toLowerCase();
  if (!db[emailKey]) db[emailKey] = [];
  
  if (!db[emailKey].includes(trackId)) {
    db[emailKey].push(trackId);
    localStorage.setItem('nextwave_enrollments_db', JSON.stringify(db));
    
    const tracks = getTracks();
    const t = tracks.find(tr => tr.id === trackId);
    if (t) {
      t.enrolledCount = (t.enrolledCount || 0) + 1;
      saveTracks(tracks);
    }
    return { success: true };
  }
  return { success: false };
}

async function clearStudentSkill(studentEmail, trackId) {
  try {
    const res = await fetch(API_BASE + '/student/clear-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentEmail, trackId })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Clear skill API offline:', e);
  }
  return { success: false, message: 'Server communication error' };
}

function getEnrollments(studentEmail) {
  const all = localStorage.getItem('nextwave_enrollments_db');
  const db = all ? JSON.parse(all) : {};
  const emailKey = studentEmail ? studentEmail.toLowerCase() : '';
  if (db[emailKey]) return db[emailKey];

  // Initial seed demo defaults only for specific demo accounts
  const demoDefaults = {
    'aarav@niat.edu': ['track-fs'],
    'priya@niat.edu': ['track-fs'],
    'rohan@niat.edu': ['track-fs'],
    'sneha@niat.edu': ['track-da']
  };
  return demoDefaults[emailKey] || [];
}

// Domain Qualification Helper: strictly verifies if an evaluator's specialization matches a track
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

// ==========================================
// INTERVIEW SLOTS (PostgreSQL Backed)
// ==========================================
async function fetchSlotsFromPg(interviewerEmail, domainFilter, trackId) {
  try {
    let url = API_BASE + '/slots?_t=' + Date.now();
    if (interviewerEmail) url += '&interviewerEmail=' + encodeURIComponent(interviewerEmail);
    if (domainFilter && domainFilter !== 'all') url += '&domain=' + encodeURIComponent(domainFilter);
    if (trackId) url += '&trackId=' + encodeURIComponent(trackId);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.slots) {
        localStorage.setItem('nextwave_slots_db', JSON.stringify(data.slots));
        return data.slots;
      }
    }
  } catch (e) {
    console.warn('Could not fetch slots from API, using local cache');
  }
  return getSlots();
}

function getSlots() {
  const s = localStorage.getItem('nextwave_slots_db');
  return s ? JSON.parse(s) : [];
}

function saveSlots(slots) {
  localStorage.setItem('nextwave_slots_db', JSON.stringify(slots));
}

// ==========================================
// PIPELINE (PostgreSQL Backed)
// ==========================================
async function fetchPipelineFromPg(track, status, interviewerEmail) {
  try {
    let url = API_BASE + '/pipeline?_t=' + Date.now();
    const params = [];
    if (track && track !== 'all') params.push('track=' + encodeURIComponent(track));
    if (status && status !== 'all') params.push('status=' + encodeURIComponent(status));
    if (interviewerEmail) params.push('interviewerEmail=' + encodeURIComponent(interviewerEmail));
    if (params.length > 0) url += '&' + params.join('&');

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.pipeline) {
        localStorage.setItem('nextwave_pipeline_db', JSON.stringify(data.pipeline));
        return data.pipeline;
      }
    }
  } catch (e) {
    console.warn('Could not fetch pipeline from PostgreSQL, using local cache');
  }
  return getPipeline();
}

function getPipeline() {
  const p = localStorage.getItem('nextwave_pipeline_db');
  return p ? JSON.parse(p) : [];
}

function savePipeline(pipeline) {
  localStorage.setItem('nextwave_pipeline_db', JSON.stringify(pipeline));
}

// Toast notification
function showToast(message, type) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.className = 'toast toast-' + (type || 'info');
  toast.innerHTML = '<span>' + (icons[type] || 'ℹ') + '</span> ' + message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Initials helper
function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ==========================================
// USER ACCOUNTS MANAGEMENT (PostgreSQL Backed)
// ==========================================
async function fetchUsersFromPg() {
  try {
    const res = await fetch(API_BASE + '/users');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.users) {
        return data.users;
      }
    }
  } catch (e) {
    console.warn('Could not fetch users from PostgreSQL:', e);
  }
  return [];
}

async function toggleUserBlock(userId) {
  try {
    const res = await fetch(API_BASE + '/users/' + userId + '/toggle-block', {
      method: 'PATCH'
    });
    localStorage.removeItem('nextwave_slots_db');
    localStorage.removeItem('nextwave_pipeline_db');
    return await res.json();
  } catch (e) {
    console.warn('Toggle user block error:', e);
    return { success: false, message: 'Server communication error' };
  }
}

async function deleteUser(userId) {
  try {
    const res = await fetch(API_BASE + '/users/' + userId, {
      method: 'DELETE'
    });
    localStorage.removeItem('nextwave_slots_db');
    localStorage.removeItem('nextwave_pipeline_db');
    return await res.json();
  } catch (e) {
    console.warn('Delete user error:', e);
    return { success: false, message: 'Server communication error' };
  }
}
