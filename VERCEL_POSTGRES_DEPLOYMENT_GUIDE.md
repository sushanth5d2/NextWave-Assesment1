# NextWave: Step-by-Step Vercel & PostgreSQL Deployment Guide

This guide walks you through deploying the **NextWave Skilling & Interview Clearance Platform** to **Vercel** with a live, persistent **PostgreSQL** database (Vercel Postgres, Neon, or Supabase).

---

## 🛠️ What Has Already Been Configured For You

The codebase is already pre-configured for Vercel serverless deployment:

1. **`vercel.json`**: Pre-configured with URL rewrites:
   - All `/api/*` routes are handled by the serverless Node/Express backend (`/api/index.js`).
   - All static pages (`index.html`, `student.html`, `interviewer.html`, `admin.html`, `login.html`), styles, and scripts are served via Vercel Edge CDN.
2. **`api/index.js`**: Serverless function entry point exporting the Express application.
3. **`db.js`**: Cloud-ready connection pooling supporting Vercel's native `POSTGRES_URL` as well as standard `DATABASE_URL` with SSL automatically enabled for remote cloud hosts.
4. **Zero-Config Auto-Migration**: On first boot, the system automatically checks your PostgreSQL instance, creates all 8 tables from `schema.sql`, and seeds initial faculty, tracks, and the master administrator account.
5. **`.gitignore`**: Prevents `node_modules` and local environment files from being committed.

---

## 🚀 Step-by-Step Deployment Instructions

### Method 1: Deploy via GitHub & Vercel Dashboard (Recommended)

#### Step 1: Initialize Git and Push to GitHub

Open PowerShell or Command Prompt in `d:\NxTwave\grit-interview-scheduler` and run:

```bash
cd d:\NxTwave\grit-interview-scheduler

# Initialize git repository
git init

# Stage all project files
git add .

# Create initial commit
git commit -m "NextWave production interview scheduling system"

# Rename branch to main
git branch -M main

# Link your GitHub repository (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/nextwave-clearance.git

# Push to GitHub
git push -u origin main
```

---

#### Step 2: Import Project into Vercel

1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New…** $\rightarrow$ **Project**.
3. Under **Import Git Repository**, select your `nextwave-clearance` repository.
4. In the configuration window:
   - **Framework Preset**: Select **Other**.
   - **Root Directory**: `./` (leave default).
   - **Build Command**: Leave empty.
   - **Output Directory**: Leave empty.
5. Do **not** deploy just yet — proceed to Step 3 to add PostgreSQL first.

---

#### Step 3: Add PostgreSQL Database (Vercel Postgres)

1. In the Vercel project creation screen (or under the **Storage** tab in your Vercel Dashboard):
   - Click **Storage** $\rightarrow$ **Create Database** $\rightarrow$ **Postgres** (powered by Neon).
2. Choose a database name (e.g., `nextwave-db`) and select your nearest region (e.g., `Washington, D.C. (iad1)` or `Mumbai, India (bom1)`).
3. Click **Create**.
4. Once created, click **Connect Project** and select your `nextwave-clearance` project.
5. Vercel will automatically inject the following environment variables into your project:
   - `POSTGRES_URL` (Connection pool URL)
   - `POSTGRES_PRISMA_URL`
   - `POSTGRES_URL_NON_POOLING`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_HOST`
   - `POSTGRES_DATABASE`

> [!NOTE]
> **Using an External PostgreSQL (Supabase / Neon / Render / AWS)?**  
> If you already have a PostgreSQL database on Supabase or Neon, go to **Settings** $\rightarrow$ **Environment Variables** in your Vercel project, and add:
> - **Key**: `DATABASE_URL`
> - **Value**: `postgres://user:password@host:5432/dbname?sslmode=require`

---

#### Step 4: Deploy

1. Click **Deploy**.
2. Vercel will build the serverless functions and upload the static assets in under 30 seconds.
3. Once completed, you will receive a live URL: `https://your-project-name.vercel.app`.

---

### Method 2: Deploy Directly via Vercel CLI (Terminal)

If you prefer deploying entirely from your terminal without opening GitHub:

```bash
# 1. Install Vercel CLI globally
npm install -g vercel

# 2. Navigate to project
cd d:\NxTwave\grit-interview-scheduler

# 3. Log in to your Vercel account
vercel login

# 4. Deploy preview
vercel

# 5. Link Vercel Postgres storage
vercel storage connect

# 6. Deploy to production
vercel --prod
```

---

## ✅ Step 5: Verify Your Live Deployment

Once deployed, verify that the application and PostgreSQL connection are working:

### 1. Test PostgreSQL Health Endpoint
Open in your browser:
```
https://your-project.vercel.app/api/health
```
You should see:
```json
{
  "status": "ok",
  "brand": "NextWave",
  "engine": "PostgreSQL",
  "inMemory": false,
  "counts": {
    "tracks": 5,
    "users": 8
  }
}
```
*Note: `"inMemory": false` confirms that queries are hitting your live cloud PostgreSQL database!*

### 2. Verify Portals & Test Credentials
Open your home page `https://your-project.vercel.app` and test the 3 gateways:

| Portal | Test Email | Password | Role / Access |
| :--- | :--- | :--- | :--- |
| **👑 Campus Admin** | `admin@niat.edu` | `admin123` | Full control over tracks, user accounts, pipeline, and malpractice audit log. |
| **👨‍🏫 Faculty Evaluator** | `kavita@niat.edu` | `password123` | Full Stack domain evaluator. Manages 30-min availability slots and records live defense decisions. |
| **🎓 Student Candidate** | `rohan@niat.edu` | `password123` | Active student. Track progression, skill contests, and live clearance booking. |

---

## 🔧 Troubleshooting & Pro-Tips

### Issue 1: "relation ... does not exist"
- **Solution**: The server automatically initializes tables on the first request to `/api/*`. If you connected a database after deployment, trigger a redeployment under **Deployments** $\rightarrow$ **Redeploy** so the database initialization middleware runs.

### Issue 2: SSL Handshake Error with External PostgreSQL
- **Solution**: If using a custom remote database (Supabase, Neon, AWS RDS), ensure `sslmode=require` is appended to your connection string. `db.js` has `ssl: { rejectUnauthorized: false }` enabled automatically for remote connections.

### Issue 3: Serverless Cold Start Timeout
- **Solution**: Vercel Serverless Functions have a default 10-second timeout on the free tier. `db.js` caches the initialized pool and table verification promise so that subsequent requests respond in under 30 milliseconds.
