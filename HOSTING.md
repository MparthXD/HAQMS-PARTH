# HAQMS Production Deployment Playbook 🚀

This handbook outlines the step-by-step guides, architectural mappings, and operational checklists required to deploy the **Hospital Appointment and Queue Management System (HAQMS)** to a secure production environment.

```mermaid
graph TD
    Client["🌐 Client Browser (Chrome, Safari, etc.)"]
    
    subgraph "Public Internet"
        NextJS["🚀 Frontend Client (Vercel / Next.js Edge)"]
        ExpressAPI["⚡ Express Backend API (Render / Railway)"]
    end
    
    subgraph "Private Virtual Network"
        PostgresDB[("🐘 PostgreSQL DB (Prisma Schema)")]
    end
    
    Client -->|1. Requests static assets / pages| NextJS
    Client -->|2. Submits API fetches with JWT| ExpressAPI
    ExpressAPI -->|3. Coordinates secure data locks| PostgresDB
```

---

## 🛠️ Option 1: Managed PaaS (Vercel + Render/Railway)
This is the recommended stack for visual performance, seamless serverless delivery, and zero server maintenance.

### Phase 1: Provision the PostgreSQL Database
You can use **Render**, **Railway**, **Supabase**, or **Neon** to spawn a managed Postgres cluster.
1. Sign up on your provider and click **New Database**.
2. Keep the region matched to where you plan to host your backend API to minimize network latency.
3. Note your connection string (e.g., `postgresql://postgres:password@host:port/dbname?sslmode=require`).

---

### Phase 2: Deploy the Express Backend
1. Create a web service from the `backend` subdirectory of your repository.
2. Configure the following build and start parameters:
   * **Build Command**: `npm install && npx prisma generate`
   * **Start Command**: `npm start`
3. Configure your Environment Variables:

| Variable | Recommended Production Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables Express optimization optimizations and turns off verbose error stack traces to clients. |
| `PORT` | `5000` (or leave default if assigned dynamically by host) | The port where Express listens. |
| `DATABASE_URL` | *Your actual secure PostgreSQL URI copied from Phase 1* | Tells Prisma how to authenticate with your remote DB. |
| `JWT_SECRET` | *A long, cryptographically strong random key (e.g., 64-char hex)* | Used to sign and verify patient and practitioner session tokens securely. |
| `ALLOWED_ORIGINS` | `https://your-frontend-domain.vercel.app` | Restricts CORS requests specifically to your production frontend client. |

---

### Phase 3: Deploy the Next.js Frontend on Vercel
Vercel is the native home for Next.js apps, providing global edge speed and serverless scaling.
1. Sign in to **Vercel** and import the `frontend` subdirectory of your repository.
2. Select **Next.js** as the framework preset.
3. Add the following environment variable in the dashboard:
   * **`NEXT_PUBLIC_API_BASE_URL`**: `https://your-backend-service.onrender.com/api` (The production URL of the Express API deployed in Phase 2).
4. Click **Deploy**. Vercel will automatically compile, build static routes, and provision a free Let's Encrypt SSL domain for you.

---

## 🐳 Option 2: Self-Hosting via Docker Compose
Perfect for deploying the full-stack system on your own Virtual Private Server (VPS) such as DigitalOcean, AWS EC2, or Hetzner.

### 1. Preparation
Clone the repository to your VPS and ensure both **Docker** and the **Docker Compose V2 plugin** are installed.

```bash
# Verify installations
docker --version
docker compose version
```

### 2. Configure Environment Variables
Inside the root directory, create a production environment file `.env.prod`:

```env
# Database Settings
POSTGRES_USER=postgres
POSTGRES_PASSWORD=generate_a_strong_db_password_here
POSTGRES_DB=haqms_prod

# Backend API Settings
BACKEND_PORT=5000
JWT_SECRET=generate_a_cryptographically_secure_jwt_secret
ALLOWED_ORIGINS=https://yourdomain.com,http://localhost

# Frontend Settings
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com/api
```

### 3. Spin Up the Containers
Build and boot the services in detached background mode using your production profile:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### 4. Setup SSL Reverse Proxy (Nginx/Caddy)
To expose your services securely to the internet, map them behind a reverse proxy with automated SSL. Here is a standard configuration using **Caddy** (highly recommended for zero-maintenance SSL):

Create a `Caddyfile` on your server:
```caddy
# Frontend Client Domain
yourdomain.com {
    reverse_proxy localhost:3000
}

# Backend API Domain
api.yourdomain.com {
    reverse_proxy localhost:5000
}
```

Start Caddy, and it will automatically coordinate SSL certificates, handle port mapping, and force redirect all HTTP traffic to HTTPS securely.

---

## 🐘 Database Operations & Maintenance
When deploying a Prisma-backed application to production, you must execute database migrations and seed standard admin accounts.

> [!CAUTION]
> **Never run `prisma migrate dev` in production.** It requires an interactive environment and can result in destructive operations (such as dropping tables) if there is schema drift.

### Running Migrations Safely
To deploy migrations safely to your production database, use the `prisma migrate deploy` command. It applies pending SQL changes sequentially without querying for user input or resetting databases.

#### Locally (Targeting Production Database):
```bash
# From the /backend directory
DATABASE_URL="your-production-db-connection-string" npx prisma migrate deploy
```

#### On PaaS (Render / Railway):
Configure your deployment pipeline's **Release/Migration Command** to:
```bash
npx prisma migrate deploy
```

---

### Seeding the Production Database
To seed doctors, practitioners, and admin login accounts on startup:

```bash
# From the /backend directory
DATABASE_URL="your-production-db-connection-string" node prisma/seed.js
```

---

## 🛡️ Production Security Checklist
Ensure these checks are completed before sharing your system with clinic staff:

- [ ] **Secret Rotation**: Check that both `JWT_SECRET` and `POSTGRES_PASSWORD` are strong and unique strings. Do not reuse local development passwords.
- [ ] **Strict CORS Enforcement**: Ensure `ALLOWED_ORIGINS` in your Express backend matches only your production frontend URL. Do not use wildcard `*` domains.
- [ ] **SSL (HTTPS)**: Ensure both frontend and backend are mapped behind HTTPS domains. Web browsers block modern fetch features and cookies if called over unencrypted HTTP.
- [ ] **Database Network Isolation**: If using Option 2 (Docker), verify that your PostgreSQL database port `5432` is not open to the public internet on your server's firewall (e.g., configure `ufw` to block incoming public traffic on 5432).
- [ ] **Removed Debug Logs**: Ensure the **Performance Diagnostic** banner and all developer warning frames are fully removed from dashboard UI pages (Completed ✅).
