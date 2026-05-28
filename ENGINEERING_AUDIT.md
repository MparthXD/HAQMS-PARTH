# HAQMS Engineering Audit Report
**Auditor:** Senior Staff-Level Engineering Review  
**Date:** 2026-05-27  
**Scope:** Full-stack audit — Backend (Node/Express/Prisma), Frontend (Next.js), Database (PostgreSQL), DevOps

---

## Overview

HAQMS (Hospital Appointment & Queue Management System) is a deliberately imperfect Node.js/Next.js monorepo designed as a candidate assessment environment. After a thorough, file-by-file inspection of every route, middleware, schema, context, and page, this report documents **17 meaningful findings** spanning critical security vulnerabilities, backend correctness bugs, database performance anti-patterns, and frontend reliability failures.

The codebase intentionally encodes bugs across every layer. This audit treats it as a real production system and prioritizes findings accordingly, distinguishing between **genuine production-grade risks** and **deliberate demo artefacts** where appropriate.

---

## Architecture Summary

```
HAQMS-PARTH/
├── backend/                   Node.js + Express REST API
│   ├── src/
│   │   ├── index.js           App bootstrap, middleware, global error handler
│   │   ├── middleware/auth.js  JWT auth + RBAC middleware
│   │   └── routes/            auth, doctors, patients, appointments, queue, reports
│   └── prisma/
│       ├── schema.prisma      PostgreSQL schema (5 models, 3 enums)
│       └── seed.js            Deterministic seed with intentional null medicalHistory
├── frontend/                  Next.js 14 App Router
│   └── src/
│       ├── app/               dashboard, login, queue, home pages
│       ├── components/        Navbar (common)
│       └── context/           AuthContext (auth state + API base URL)
└── docker-compose.yml         PostgreSQL 15 only
```

**Key architectural observations:**
- No separation between business logic and route handlers (all logic inline in routes)
- No API versioning (`/api/v1/...`)
- No shared validation layer (each route validates independently or not at all)
- No service layer — routes call Prisma directly
- 1,167-line monolithic dashboard component (all roles in one file)
- AuthContext doubles as a service client (hardcoded base URL)

---

## Critical Issues

### CRIT-01 — SQL Injection via `$queryRawUnsafe`
**Severity:** 🔴 Critical  
**File:** [`backend/src/routes/doctors.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/doctors.js) — Lines 16–34

**Root Cause:**  
The `GET /api/doctors` endpoint builds a raw SQL `WHERE` clause using direct string interpolation of user-supplied `search` and `specialization` query parameters, then executes it with Prisma's `$queryRawUnsafe()`. This is a textbook, exploitable SQL injection vulnerability.

```javascript
conditions.push(`name ILIKE '%${search}%'`);
conditions.push(`specialization = '${specialization}'`);
const doctors = await prisma.$queryRawUnsafe(query);
```

**Why It Matters:**  
An attacker can extract the entire `User` table (including hashed passwords, emails, roles) with a single crafted request:
```
GET /api/doctors?search=House%' UNION SELECT id,email,password,name,role,'09:00','17:00',0,id FROM "User" --
```
The backend even logs the query to stdout (`console.log('[SQL-DEBUG] Executing Query: ...')`), confirming the injection worked. In a medical system, this means complete patient record exfiltration and credential harvesting.

**Reproduction Steps:**
1. Log in as any authenticated user
2. `GET /api/doctors?search=House%25' UNION SELECT id,email,password,name,role,'09:00','17:00',0,id FROM "User" --`
3. Response contains the full User table rows

**Recommended Fix:**  
Replace `$queryRawUnsafe` with Prisma's type-safe ORM query builder:
```javascript
const doctors = await prisma.doctor.findMany({
  where: {
    AND: [
      search ? { name: { contains: search, mode: 'insensitive' } } : {},
      specialization && specialization !== 'All' ? { specialization } : {},
    ],
  },
});
```

---

### CRIT-02 — Broken Access Control: `authorizeAdminOnlyLegacy` Grants Access to Everyone
**Severity:** 🔴 Critical  
**File:** [`backend/src/middleware/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/middleware/auth.js) — Lines 51–61  
**Also affects:** [`backend/src/routes/patients.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/patients.js) — `DELETE /api/patients/:id`

**Root Cause:**  
The `authorizeAdminOnlyLegacy` middleware has its role-check commented out with the note *"Junior developer commented it out because it was causing issues during testing."* The function only checks that `req.user` is truthy (i.e., any authenticated user), then calls `next()`.

```javascript
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
  // TODO: Implement actual admin role verification here
  // if (req.user.role !== 'ADMIN') { ... }  ← COMMENTED OUT
  next(); // Every authenticated user passes through
};
```

**Why It Matters:**  
Any receptionist or doctor can permanently delete any patient record. In a HIPAA-regulated hospital system, unauthorized deletion of medical records is a legal and compliance catastrophe, and completely undermines the RBAC model.

**Reproduction Steps:**
1. Log in as a RECEPTIONIST (`reception1@haqms.com / password123`)
2. `DELETE /api/patients/:id` with the JWT token — succeeds with 200

**Recommended Fix:**
```javascript
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};
```

---

### CRIT-03 — JWT Expiration Intentionally Disabled
**Severity:** 🔴 Critical  
**File:** [`backend/src/middleware/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/middleware/auth.js) — Line 17

**Root Cause:**  
The `authenticate` middleware calls `jwt.verify()` with `{ ignoreExpiration: true }`. Combined with tokens issued with a 365-day expiry in `auth.js`, this means a stolen or compromised token is valid for **one year and cannot be revoked** even if the user changes their password.

```javascript
const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
```

**Why It Matters:**  
If a doctor's device is stolen, the attacker has 365 days of unrestricted access to all patient records with no mechanism to revoke access. This violates every healthcare data security standard (HIPAA, ISO 27001).

**Recommended Fix:**
```javascript
// auth.js — use short-lived tokens
{ expiresIn: '8h' }  // Shift-length token

// middleware/auth.js — remove ignoreExpiration
const decoded = jwt.verify(token, JWT_SECRET); // respects exp claim
```
Also implement a token refresh flow for UX continuity.

---

### CRIT-04 — Hardcoded JWT Secret with Insecure Fallback
**Severity:** 🔴 Critical  
**Files:** [`backend/src/middleware/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/middleware/auth.js) L3, [`backend/src/routes/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/auth.js) L4

**Root Cause:**  
Both the auth route and the middleware define the JWT secret with an insecure hardcoded fallback:
```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-secret-key-12345!!!';
```
If `JWT_SECRET` is ever missing from the environment (e.g., a misconfigured deployment), the application silently falls back to a publicly known string. Anyone who reads this source code (which is in a GitHub repo) can forge valid JWTs for any role.

**Why It Matters:**  
Privilege escalation from zero to ADMIN requires only knowing the hardcoded secret and forging a JWT with `{ role: 'ADMIN' }`.

**Recommended Fix:**  
Fail hard at startup if the secret is missing:
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
```

---

## High Priority Issues

### HIGH-01 — Sensitive Data Leaked in API Error Responses
**Severity:** 🟠 High  
**Files:** Multiple routes + [`backend/src/index.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/index.js) L50–56

**Root Cause:**  
Multiple locations return raw error details to the client:
- `doctors.js`: Returns `{ error: 'Database execution failure', sqlMessage: error.message }` — directly leaks the SQL query structure
- `auth.js` login: Returns `{ errorStack: error.stack }` — leaks file paths, function names, Prisma internals
- `auth.js` register: Returns `{ databaseError: error.message }` — leaks uniqueness constraint names
- `middleware/auth.js`: Returns `{ error: 'Invalid token.', details: error.message }` — leaks JWT implementation details
- Global error handler in `index.js`: Returns full stack trace to the client (even with the `NODE_ENV` check, the `error.message` always leaks)

**Why It Matters:**  
Stack traces reveal server-side file paths, database schema names, ORM internals, and implementation details that dramatically reduce the cost of reconnaissance for an attacker.

**Recommended Fix:**  
Log full details server-side. Return generic messages client-side:
```javascript
// Standard pattern
catch (error) {
  console.error('[ERROR]', error);
  res.status(500).json({ error: 'An internal error occurred.' });
}
```

---

### HIGH-02 — Auth Response Returns Password Hash to Client
**Severity:** 🟠 High  
**File:** [`backend/src/routes/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/auth.js) — Lines 42–45

**Root Cause:**  
The register endpoint returns the entire user object from `prisma.user.create()` including the `password` field (bcrypt hash):
```javascript
res.status(201).json({ message: 'User registered successfully', user }); // user includes password hash
```

**Why It Matters:**  
Even bcrypt hashes are sensitive — they can be subjected to offline brute-force or rainbow table attacks. Exposing them in API responses is a security anti-pattern, especially in a medical system.

**Recommended Fix:**
```javascript
const { password: _, ...safeUser } = user;
res.status(201).json({ message: 'User registered successfully', user: safeUser });
```

---

### HIGH-03 — Sensitive Data Logged in Plaintext
**Severity:** 🟠 High  
**File:** [`backend/src/routes/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/auth.js) — Lines 14, 57

**Root Cause:**  
Two log statements capture and print plaintext secrets to stdout:
```javascript
// Registration — logs full body including cleartext password
console.log('[DEBUG] Registering user with payload:', JSON.stringify(req.body));

// Login — logs cleartext password directly
console.log(`[AUTH] Login attempt for email: ${req.body.email} with password: ${req.body.password}`);
```

**Why It Matters:**  
In any environment where logs are shipped to an aggregation service (Datadog, CloudWatch, Splunk), plaintext passwords would be stored indefinitely in log systems that are typically less secured than the database. This is a GDPR/HIPAA violation.

**Recommended Fix:**  
Remove both log statements entirely. If request tracing is needed, log only the email:
```javascript
console.log(`[AUTH] Login attempt for email: ${req.body.email}`);
```

---

### HIGH-04 — Race Condition in Queue Token Generation (No Atomic Increment)
**Severity:** 🟠 High  
**File:** [`backend/src/routes/queue.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/queue.js) — Lines 50–81

**Root Cause:**  
Token numbers are generated by a read-then-write pattern: fetch the current max token, then create a new token with `max + 1`. A deliberate `setTimeout(350ms)` widens the race window. Two concurrent check-ins for the same doctor will both read `max = N`, both compute `N+1`, and both insert — creating duplicate token numbers.

```javascript
const maxTokenResult = await prisma.queueToken.aggregate({ _max: { tokenNumber: true } });
const nextTokenNumber = currentMax + 1;
await new Promise(resolve => setTimeout(resolve, 350)); // artificial race window
await prisma.queueToken.create({ data: { tokenNumber: nextTokenNumber, ... } });
```

**Why It Matters:**  
In a real hospital, two patients called with the same token number causes confusion at the queue display, potential medical mix-ups, and complete loss of queue ordering. The `setTimeout` is the smoking gun — it's explicitly widening the window for demonstration purposes.

**Recommended Fix:**  
Use a database-level atomic increment with a raw query or a Prisma transaction:
```sql
-- Option A: Raw SQL atomic increment
INSERT INTO "QueueToken" (tokenNumber, ...) 
SELECT COALESCE(MAX(tokenNumber), 0) + 1, ... 
FROM "QueueToken" WHERE "doctorId" = $1 AND "createdAt" >= $2
```
Or use a Prisma `$transaction` with serializable isolation:
```javascript
await prisma.$transaction(async (tx) => {
  const max = await tx.queueToken.aggregate({ ... });
  return tx.queueToken.create({ data: { tokenNumber: max._max.tokenNumber + 1, ... } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

---

### HIGH-05 — Memory Leak: `setInterval` Never Cleared in Queue Monitor
**Severity:** 🟠 High  
**File:** [`frontend/src/app/queue/page.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/app/queue/page.js) — Lines 47–55

**Root Cause:**  
A `setInterval` is created in `useEffect` but the cleanup function (`return () => clearInterval(intervalId)`) is missing. Every time the Queue page mounts, a new 3-second polling interval is registered. Navigation away from and back to the page accumulates intervals.

```javascript
useEffect(() => {
  const intervalId = setInterval(() => {
    fetchQueueData();
  }, 3000);
  // Missing: return () => clearInterval(intervalId);
}, []);
```

**Why It Matters:**  
After 10 navigations to the queue page, there are 10 parallel intervals firing simultaneously every 3 seconds — 10x the DB load. React also logs "Can't perform a state update on an unmounted component" errors, which can cascade into crashes. On a hospital kiosk that runs 24/7, this causes continuous memory growth.

**Recommended Fix:**
```javascript
useEffect(() => {
  fetchQueueData();
  const intervalId = setInterval(fetchQueueData, 3000);
  return () => clearInterval(intervalId); // Always clean up
}, []);
```

---

### HIGH-06 — Frontend Application Crash on Null `medicalHistory`
**Severity:** 🟠 High  
**File:** [`frontend/src/app/dashboard/page.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/app/dashboard/page.js) — Line 899

**Root Cause:**  
The doctor's patient history panel calls `.toUpperCase()` directly on `medicalHistory`, which is nullable in the schema and intentionally null for patients like Bruce Wayne, Clark Kent, and Diana Prince:
```javascript
{selectedPatientHistory.medicalHistory.toUpperCase()}
// TypeError: Cannot read properties of null (reading 'toUpperCase')
```

**Why It Matters:**  
Clicking any patient with `null` medical history crashes the entire React component tree. In a hospital context, this means a doctor's dashboard becomes unusable mid-shift, potentially delaying patient care. The seed data is deliberately set up to trigger this for ~30% of patients.

**Reproduction Steps:**
1. Log in as doctor1
2. Go to Appointments tab → click "Bruce Wayne" or "Clark Kent"
3. Application throws and the page goes blank

**Recommended Fix:**
```javascript
{selectedPatientHistory.medicalHistory?.toUpperCase() ?? 'No medical history recorded.'}
```

---

### HIGH-07 — N+1 Query Problem in Appointments Endpoint
**Severity:** 🟠 High  
**File:** [`backend/src/routes/appointments.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/appointments.js) — Lines 22–46

**Root Cause:**  
The `GET /api/appointments` endpoint fetches all appointments, then for *each* appointment executes two additional DB queries — one for patient, one for doctor. With N appointments, this results in `1 + 2N` database round-trips.

```javascript
const appointments = await prisma.appointment.findMany({ where });
for (const app of appointments) {
  const patient = await prisma.patient.findUnique({ where: { id: app.patientId } });
  const doctor = await prisma.doctor.findUnique({ where: { id: app.doctorId } });
  // ...
}
```

**Why It Matters:**  
With 50 appointments, this is 101 queries. With 500 appointments (a realistic busy hospital day), it's 1,001 queries. Each `await` serializes the execution, so the response time scales linearly. Prisma provides a declarative `include` that collapses this into a single JOIN query.

**Recommended Fix:**
```javascript
const appointments = await prisma.appointment.findMany({
  where,
  orderBy: { appointmentDate: 'asc' },
  include: {
    patient: { select: { id: true, name: true, phoneNumber: true, age: true, medicalHistory: true } },
    doctor: { select: { id: true, name: true, specialization: true } },
  },
});
res.json({ success: true, count: appointments.length, appointments });
```

---

## Medium Priority Issues

### MED-01 — Reports Endpoint: O(N×5) Sequential DB Queries per Doctor
**Severity:** 🟡 Medium  
**File:** [`backend/src/routes/reports.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/reports.js) — Lines 17–70

**Root Cause:**  
The `GET /api/reports/doctor-stats` endpoint:
1. Fetches all doctors (1 query)
2. For each doctor, executes **5 sequential queries** (count total, count completed, count cancelled, count queue, fetch all completed appointments for revenue)
3. Adds a deliberate 80ms `setTimeout` between each doctor

With 5 doctors: `1 + (5×5) + 5×80ms = 26 queries + ~400ms artificial delay`. This scales catastrophically.

**Recommended Fix:**  
Use a single Prisma `groupBy` + aggregation query, or a raw SQL CTE that computes all stats in one pass.

---

### MED-02 — In-Memory Pagination in Patients Endpoint
**Severity:** 🟡 Medium  
**File:** [`backend/src/routes/patients.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/patients.js) — Lines 16–46

**Root Cause:**  
The patients endpoint loads **all rows** from the database into memory, then applies filtering and pagination with JavaScript array operations:
```javascript
const allPatients = await prisma.patient.findMany({ orderBy: { createdAt: 'desc' } });
// Then filter in-memory, then slice for pagination
const paginatedResult = filteredPatients.slice(offset, offset + limit);
```

**Why It Matters:**  
This doesn't scale. With 100,000 patients, the server loads the entire dataset into RAM on every request. A hospital with years of patient history will cause OOM crashes.

**Recommended Fix:**  
Push filtering and pagination to the database:
```javascript
const patients = await prisma.patient.findMany({
  where: {
    AND: [
      search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ]
      } : {},
      gender && gender !== 'All' ? { gender: { equals: gender, mode: 'insensitive' } } : {},
    ],
  },
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * limit,
  take: limit,
});
```

---

### MED-03 — Missing Database Indexes on High-Frequency Query Columns
**Severity:** 🟡 Medium  
**File:** [`backend/prisma/schema.prisma`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/prisma/schema.prisma)

**Root Cause:**  
The schema comments itself document the missing indexes. None of these are present:
- `Doctor.department` and `Doctor.specialization` — used in filter queries
- `Appointment.doctorId` (FK) and `Appointment.status` — used in worklist queries
- `Appointment.(doctorId, status)` composite — used for doctor-filtered status queries
- `QueueToken.status` — used in every queue display query
- `QueueToken.(doctorId, createdAt)` composite — used in daily token aggregation
- `QueueToken.(doctorId, tokenNumber)` — missing uniqueness constraint enabling the race condition

**Recommended Fix:**  
```prisma
model Doctor {
  @@index([department])
  @@index([specialization])
}

model Appointment {
  @@index([doctorId, status])
  @@index([patientId])
}

model QueueToken {
  @@index([status])
  @@index([doctorId, createdAt])
}
```

---

### MED-04 — Doctor Availability Not Enforced at Booking Time
**Severity:** 🟡 Medium  
**File:** [`backend/src/routes/appointments.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/appointments.js) — Lines 73–88

**Root Cause:**  
The duplicate-booking check only matches at the exact millisecond level:
```javascript
const existingBooking = await prisma.appointment.findFirst({
  where: { doctorId, appointmentDate: appDate, status: { not: 'CANCELLED' } },
});
```
If two appointments are booked for `10:00:00` vs `10:00:01`, both succeed. No slot-based or hour-window check exists. Doctor availability hours (`availableFrom`/`availableTo`) in the Doctor model are never consulted.

**Recommended Fix:**  
Check for appointments within a configurable time window (e.g., 30 minutes), and validate the booking time falls within the doctor's available hours.

---

### MED-05 — DOM-Based Selection Used for Walk-In Check-In Form
**Severity:** 🟡 Medium  
**File:** [`frontend/src/app/dashboard/page.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/dashboard/page.js) — Lines 777–784

**Root Cause:**  
The walk-in check-in widget reads values by directly querying the DOM with `document.getElementById()` rather than using controlled React state:
```javascript
const pId = document.getElementById('walkin-patient').value;
const dId = document.getElementById('walkin-doctor').value;
```

**Why It Matters:**  
This is a React anti-pattern. It breaks React's rendering guarantees, is not testable, is not SSR-safe, and makes the component's behavior unpredictable. If the component re-renders or the IDs change, this silently returns null and produces confusing errors.

**Recommended Fix:**  
Use controlled state:
```javascript
const [walkinPatientId, setWalkinPatientId] = useState('');
const [walkinDoctorId, setWalkinDoctorId] = useState('');
```

---

### MED-06 — Unrestricted CORS
**Severity:** 🟡 Medium  
**File:** [`backend/src/index.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/index.js) — Line 19

**Root Cause:**
```javascript
app.use(cors()); // Allows ALL origins, ALL methods, ALL headers
```

**Why It Matters:**  
Any website on the internet can make authenticated cross-origin requests to the API if the user has a valid token. In production, a malicious site could trigger state-changing requests (CSRF-adjacent).

**Recommended Fix:**
```javascript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

---

## Low Priority Issues

### LOW-01 — Hardcoded API Base URL Duplicated Across Frontend
**Severity:** 🔵 Low  
**Files:** [`frontend/src/context/AuthContext.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/context/AuthContext.js) L18, [`frontend/src/app/queue/page.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/app/queue/page.js) L16

**Root Cause:**  
`http://localhost:5000/api` is hardcoded in two separate files. The queue page bypasses `AuthContext` entirely and hardcodes it locally as a comment acknowledges.

**Recommended Fix:**  
Use a Next.js environment variable:
```javascript
// .env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api

// Usage
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
```

---

### LOW-02 — JWT Stored in LocalStorage (XSS Vulnerable)
**Severity:** 🔵 Low (Contextual — assessment environment)  
**File:** [`frontend/src/context/AuthContext.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/context/AuthContext.js) — Lines 60–61

**Root Cause:**  
The JWT is persisted in `localStorage`, which is accessible to any JavaScript running on the page (including injected scripts from XSS attacks).

**Why It Matters:**  
If any third-party script or XSS vulnerability exists, the JWT can be exfiltrated and replayed by an attacker. Best practice is to use `HttpOnly` cookies (inaccessible to JS) managed by a server-side session endpoint.

---

### LOW-03 — No Rate Limiting on Auth Endpoints
**Severity:** 🔵 Low  
**File:** [`backend/src/index.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/index.js)

**Root Cause:**  
`POST /api/auth/login` and `POST /api/auth/register` have no rate limiting. A brute-force attack can attempt unlimited password guesses.

**Recommended Fix:**
```bash
npm install express-rate-limit
```
```javascript
import rateLimit from 'express-rate-limit';
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth', authLimiter);
```

---

### LOW-04 — No Password Strength Validation on Registration
**Severity:** 🔵 Low  
**File:** [`backend/src/routes/auth.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/routes/auth.js) — Lines 18–21

**Root Cause:**  
Registration only checks that `email`, `password`, and `name` are non-empty. A one-character password like `"a"` is accepted and hashed.

---

### LOW-05 — `unhandledRejection` Does Not Exit Process
**Severity:** 🔵 Low  
**File:** [`backend/src/index.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/backend/src/index.js) — Lines 67–71

**Root Cause:**
```javascript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Intentionally do not exit process
});
```
The comment is honest — this is intentional for demo purposes. In production, unhandled rejections should crash the process so the orchestrator (Kubernetes, PM2) can restart it in a clean state rather than running in an undefined/corrupted state.

---

### LOW-06 — `Link` Component Missing Import in Dashboard
**Severity:** 🔵 Low  
**File:** [`frontend/src/app/dashboard/page.js`](file:///c:/Users/HP/Documents/HAQMS-PARTH/frontend/src/app/dashboard/page.js) — Line 905

**Root Cause:**  
Line 905 uses `<Link href={...}>` but `Link` is not imported in the dashboard file (the imports only include `useState`, `useEffect`, `useAuth`, `Navbar`, `useRouter`, and lucide icons). This causes a runtime `ReferenceError: Link is not defined`.

**Recommended Fix:**
```javascript
import Link from 'next/link';
```

---

## Security Findings Summary

| # | Finding | Severity | OWASP Category |
|---|---------|---------|----------------|
| CRIT-01 | SQL Injection via `$queryRawUnsafe` | 🔴 Critical | A03: Injection |
| CRIT-02 | Broken RBAC — admin check commented out | 🔴 Critical | A01: Broken Access Control |
| CRIT-03 | JWT expiration disabled | 🔴 Critical | A07: Identification Failures |
| CRIT-04 | Hardcoded JWT secret with fallback | 🔴 Critical | A02: Cryptographic Failures |
| HIGH-01 | Stack traces / DB errors leaked in responses | 🟠 High | A05: Security Misconfiguration |
| HIGH-02 | Password hash returned in register response | 🟠 High | A02: Cryptographic Failures |
| HIGH-03 | Plaintext passwords logged to stdout | 🟠 High | A09: Logging Failures |
| MED-06 | Wildcard CORS allows any origin | 🟡 Medium | A05: Security Misconfiguration |
| LOW-02 | JWT in localStorage (XSS risk) | 🔵 Low | A07: Identification Failures |
| LOW-03 | No rate limiting on auth endpoints | 🔵 Low | A04: Insecure Design |

---

## Performance Findings Summary

| # | Finding | Severity | Impact |
|---|---------|---------|--------|
| HIGH-04 | Race condition in queue token generation | 🟠 High | Duplicate tokens, medical safety |
| HIGH-07 | N+1 queries in appointments endpoint | 🟠 High | Response time O(N) → O(1) |
| HIGH-05 | setInterval memory leak in queue page | 🟠 High | Memory growth, server overload |
| MED-01 | Sequential DB loops in reports endpoint | 🟡 Medium | O(N×5) queries |
| MED-02 | In-memory pagination in patients endpoint | 🟡 Medium | OOM at scale |
| MED-03 | Missing DB indexes | 🟡 Medium | Full table scans |

---

## Database Findings Summary

| # | Finding | Severity |
|---|---------|---------|
| MED-03 | Missing indexes on department, specialization, status, doctorId | 🟡 Medium |
| MED-04 | No slot-based availability check; millisecond duplicate check is trivially bypassable | 🟡 Medium |
| HIGH-04 | No unique constraint on (doctorId, tokenNumber, date) — race condition | 🟠 High |
| HIGH-07 | N+1 queries instead of `include` joins | 🟠 High |
| MED-01 | O(N×5) sequential queries in reports | 🟡 Medium |

---

## Frontend Findings Summary

| # | Finding | Severity |
|---|---------|---------|
| HIGH-06 | Null-pointer crash on `medicalHistory.toUpperCase()` | 🟠 High |
| HIGH-05 | `setInterval` memory leak (missing cleanup) | 🟠 High |
| MED-05 | DOM querySelector for form values instead of React state | 🟡 Medium |
| LOW-01 | Hardcoded API URL duplicated in 2 files | 🔵 Low |
| LOW-06 | `Link` used in dashboard but not imported | 🔵 Low |

---

## Recommended Next Steps

### Immediate (Before Any Production Deployment)
1. **Fix SQL injection** — Replace `$queryRawUnsafe` with Prisma ORM queries (CRIT-01)
2. **Restore admin authorization check** — Uncomment the role check in `authorizeAdminOnlyLegacy` (CRIT-02)
3. **Fix JWT configuration** — Remove `ignoreExpiration`, set 8h expiry, fail hard on missing secret (CRIT-03, CRIT-04)
4. **Strip sensitive data from error responses** — Remove stack traces, DB messages, password hashes (HIGH-01, HIGH-02)
5. **Remove plaintext password logging** (HIGH-03)

### Short-Term (Sprint 1)
6. Fix `setInterval` memory leak in queue page (HIGH-05)
7. Fix null crash on `medicalHistory` (HIGH-06)
8. Replace N+1 queries with Prisma `include` (HIGH-07)
9. Fix queue token race condition with atomic transaction (HIGH-04)
10. Add missing database indexes (MED-03)

### Medium-Term (Sprint 2)
11. Replace in-memory pagination with database-level pagination (MED-02)
12. Refactor reports endpoint to use aggregation query (MED-01)
13. Move API URL to Next.js environment variable (LOW-01)
14. Add rate limiting to auth endpoints (LOW-03)
15. Implement proper CORS allowlist (MED-06)
16. Replace DOM selectors with React controlled state (MED-05)

---

## Prioritized Action Plan

```
Priority 1 (Security — Do Now):
  [ ] CRIT-01: Replace $queryRawUnsafe with Prisma ORM
  [ ] CRIT-02: Restore authorizeAdminOnlyLegacy role check
  [ ] CRIT-03: Remove ignoreExpiration, reduce token TTL to 8h
  [ ] CRIT-04: Fail at startup if JWT_SECRET missing
  [ ] HIGH-01: Sanitize all error responses
  [ ] HIGH-02: Exclude password from register response
  [ ] HIGH-03: Remove plaintext password log statements

Priority 2 (Reliability — This Sprint):
  [ ] HIGH-04: Fix race condition with Prisma transaction
  [ ] HIGH-05: Add clearInterval cleanup to queue page
  [ ] HIGH-06: Add optional chaining to medicalHistory render
  [ ] HIGH-07: Replace N+1 with Prisma include
  [ ] LOW-06: Import Link in dashboard page

Priority 3 (Performance & Architecture — Next Sprint):
  [ ] MED-01: Rewrite reports endpoint with single aggregation
  [ ] MED-02: Replace in-memory pagination with DB-level pagination
  [ ] MED-03: Add missing schema indexes
  [ ] MED-04: Implement slot-based booking validation
  [ ] MED-05: Replace getElementById with React state
  [ ] MED-06: Restrict CORS to known origins
  [ ] LOW-01: Move API URL to NEXT_PUBLIC_API_BASE_URL
  [ ] LOW-03: Add express-rate-limit to auth routes
```

---

## Suggested Git Commits

```bash
# Security fixes
git commit -m "fix(security): replace $queryRawUnsafe with Prisma ORM in doctors route"
git commit -m "fix(security): restore admin role check in authorizeAdminOnlyLegacy middleware"
git commit -m "fix(security): remove ignoreExpiration from JWT verify, set 8h token TTL"
git commit -m "fix(security): fail hard at startup when JWT_SECRET env var is missing"
git commit -m "fix(security): sanitize error responses - remove stack traces and db messages"
git commit -m "fix(security): exclude password hash from registration response"
git commit -m "fix(security): remove plaintext password logging in auth routes"

# Bug fixes
git commit -m "fix(frontend): add optional chaining for nullable medicalHistory field"
git commit -m "fix(frontend): add clearInterval cleanup to prevent queue page memory leak"
git commit -m "fix(frontend): replace DOM getElementById with React controlled state"
git commit -m "fix(frontend): import Link component in dashboard page"

# Performance
git commit -m "perf(api): replace N+1 loop with Prisma include in appointments endpoint"
git commit -m "perf(api): replace in-memory pagination with database-level skip/take"
git commit -m "perf(api): rewrite reports endpoint using groupBy aggregation"
git commit -m "perf(db): add missing indexes for department, status, doctorId columns"
git commit -m "perf(db): add composite index on (doctorId, status) for appointment queries"

# Architecture
git commit -m "feat(config): move hardcoded API URL to NEXT_PUBLIC_API_BASE_URL env var"
git commit -m "feat(security): add express-rate-limit to authentication endpoints"
git commit -m "feat(security): restrict CORS to configured allowed origins"
git commit -m "fix(queue): atomize token generation with Prisma serializable transaction"
```

---

## Suggested Interview Talking Points

### Security
- *"I identified a live SQL injection in the doctors search route that could exfiltrate the entire User table including credentials via a UNION SELECT attack. The root cause is using `$queryRawUnsafe` with string interpolation instead of Prisma's parameterized query builder."*
- *"The RBAC implementation has a commented-out admin guard that was disabled during testing and never re-enabled. Any authenticated user — including receptionists — can delete any patient record. This is a broken access control vulnerability, OWASP A01."*
- *"JWT expiry is disabled at the middleware level with `ignoreExpiration: true`, making token revocation impossible. Combined with a 365-day TTL and a hardcoded fallback secret visible in source, this is a cascading authentication failure."*

### Performance
- *"The appointments endpoint has a classic N+1 query problem. For 50 appointments it executes 101 database round-trips. Replacing the loop with Prisma's `include` collapses this to a single JOIN — a 100x improvement."*
- *"The reports endpoint runs 5 sequential database queries per doctor inside a for-loop, plus an artificial 80ms sleep. This is O(N×5) + blocking delays. A single `groupBy` aggregation query resolves this in one round-trip regardless of doctor count."*
- *"The queue monitor has a `setInterval` with no cleanup function. Each page mount registers a new polling interval that is never cancelled, causing cumulative memory growth and parallel DB polling."*

### Frontend
- *"There's a hard null-pointer crash when a doctor clicks a patient with no medical history. `null.toUpperCase()` throws a TypeError that crashes the React component tree. The fix is a single optional chaining operator: `medicalHistory?.toUpperCase() ?? 'None recorded'`."*
- *"The walk-in check-in form uses `document.getElementById` to read select values instead of React controlled state. This is an anti-pattern that breaks React's rendering model, prevents testing, and fails in SSR environments."*

### Architecture
- *"The dashboard is a 1,167-line monolithic component handling three completely different user roles (admin, receptionist, doctor). This violates the Single Responsibility Principle and makes the component untestable and unmaintainable. Each role's workflow should be a separate component."*
- *"The API base URL is hardcoded in two different files with no environment variable abstraction. Deploying to staging vs production requires manual find-and-replace across multiple files."*

---

## Suggested Walkthrough / Demo Points for Assessment Video

### 1. Demonstrate the SQL Injection (CRIT-01)
- Open the Physician Registry tab as Admin
- Paste the UNION SELECT payload into the search box
- Show the User table leaking into the UI response including hashed passwords
- Explain parameterized queries and the `$queryRawUnsafe` vs `prisma.doctor.findMany` fix

### 2. Demonstrate Broken RBAC (CRIT-02)
- Log in as a Receptionist
- Open DevTools Network tab
- Send `DELETE /api/patients/:id` with the Bearer token
- Show that patient deletion succeeds despite not being admin
- Point to the commented-out middleware check

### 3. Trigger the Frontend Crash (HIGH-06)
- Log in as Doctor1 (Dr. Gregory House)
- Go to the Appointments tab
- Click on "Bruce Wayne" (null medicalHistory patient)
- Show the TypeError crash in the console
- Show the fix with optional chaining

### 4. Demonstrate the Race Condition (HIGH-04)
- Open two browser tabs both logged in as receptionist
- Simultaneously click "Check In" for the same patient + doctor in both tabs
- Show both tokens get number N+1 (same token number)
- Explain read-then-write vs atomic DB increment

### 5. Demonstrate the Memory Leak (HIGH-05)
- Open the Queue Monitor page, note the Polls counter
- Navigate to Dashboard and back 5 times
- Show the counter incrementing 5x faster per cycle
- Show Chrome DevTools memory timeline growing over time
- Explain `clearInterval` cleanup function

### 6. Demonstrate N+1 Queries (HIGH-07)
- Open Network tab in DevTools
- Trigger the appointments endpoint load
- Show the timing (many sequential DB roundtrips visible as latency)
- Show the console logs "[N+1 DB QUERY] Fetching Patient..."
- Explain Prisma `include` as the fix

### 7. Show the Performance Regression in Reports (MED-01)
- As Admin, click "Load Doctor System Audit Report"
- Point out the loading message "Event loop is locked..."
- When it loads, point to the `timeTakenMs` metric shown in the UI
- Explain sequential O(N×5) queries and Promise.all vs aggregation as fixes

---

## Production Readiness Assessment

| Category | Rating | Notes |
|----------|--------|-------|
| Security | ❌ Not Ready | 4 critical vulnerabilities; cannot be deployed |
| Authentication | ❌ Not Ready | JWT expiration disabled, secret fallback |
| Authorization | ❌ Not Ready | Admin check commented out |
| API Design | ⚠️ Partial | No versioning, inconsistent response shapes |
| Error Handling | ⚠️ Partial | Leaks internals; needs sanitization |
| Database | ⚠️ Partial | Missing indexes, N+1 queries, race conditions |
| Frontend | ⚠️ Partial | Memory leak, crash bug, anti-patterns |
| Performance | ⚠️ Partial | O(N) queries, in-memory pagination |
| DevOps | ⚠️ Partial | No health checks, no secrets management |
| Testing | ❌ None | Zero test coverage across backend and frontend |
| Documentation | ✅ Good | README and comments are thorough |

**Overall Assessment:** This codebase demonstrates functional system design with intentionally introduced vulnerabilities and anti-patterns at every layer. The architecture is coherent but not production-ready. The primary blockers are the four critical security issues which must be resolved before any real patient data could ever be handled. The performance issues (N+1, in-memory pagination, reports sequential queries) are correctness bugs that become operational failures at scale.

**Estimate to Production-Ready:** ~3–4 focused engineering sprints addressing security first, then reliability, then performance and architecture refactoring.
