# Deploy Leadiya to Hetzner VPS

## 1. Provision VPS

1. Go to [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Create server: **CX22** (2 vCPU, 4GB RAM, 40GB SSD) — ~$5/mo
3. OS: **Ubuntu 22.04**
4. Add your SSH key
5. Note the IP address

## 2. Initial Server Setup

```bash
ssh root@YOUR_VPS_IP

# System updates
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
apt install -y docker-compose-plugin

# Create app user
adduser --disabled-password leadiya
usermod -aG docker leadiya

# Install Git
apt install -y git
```

## 3. Clone and Configure

```bash
su - leadiya
git clone https://github.com/rahmetlabs/clawdbot.git leadiya
cd leadiya

# Create .env from example
cp .env.example .env
nano .env
```

### Required .env values:

```
# Supabase (from your Supabase project dashboard → Settings → API)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
DATABASE_DIRECT_URL=postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret

# Dashboard auth (same Supabase project, VITE_ prefix for browser)
VITE_SUPABASE_URL=https://[ref].supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Redis (local on VPS)
REDIS_URL=redis://localhost:6379

# Production settings
NODE_ENV=production
AUTH_BYPASS=false
WHATSAPP_BAILEYS_ENABLED=true
WHATSAPP_INBOUND_LOG=true

# Your tenant ID (get from Supabase after first signup)
DEFAULT_TENANT_ID=your-tenant-uuid
```

## 4. Install Redis on VPS

```bash
# As root
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# Test
redis-cli ping  # Should return PONG
```

## 5. Setup Supabase Auth

1. Go to your Supabase project → Authentication → Providers
2. Enable **Email** provider (should be on by default)
3. Disable "Confirm email" for faster testing (Authentication → Settings → uncheck "Enable email confirmations")
4. Note the JWT Secret from Settings → API → JWT Secret

## 6. Run Database Migrations

```bash
# From the leadiya directory, apply migrations
docker compose run --rm api node -e "
  const { Client } = require('pg');
  const { readFileSync, readdirSync } = require('fs');
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL });
  client.connect().then(async () => {
    const files = readdirSync('packages/db/drizzle').filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      console.log('Applying:', f);
      await client.query(readFileSync('packages/db/drizzle/' + f, 'utf8'));
    }
    console.log('All migrations applied');
    await client.end();
  });
"
```

## 7. Build and Start

```bash
docker compose up --build -d

# Check status
docker compose ps
docker compose logs -f api --tail 20
docker compose logs -f workers --tail 20

# API health
curl http://localhost:3001/health
```

Dashboard: http://YOUR_VPS_IP:8080

## 8. Domain + SSL (Cloudflare)

1. Buy domain or add subdomain in Cloudflare
2. Add A record: `app.rahmetlabs.com` → VPS IP (proxied)
3. SSL mode: Full (strict) — Cloudflare handles HTTPS automatically
4. Dashboard is now at: `https://app.rahmetlabs.com`

## 9. Auto-Deploy on Push

Add to `.env` on the VPS:
```
GITHUB_WEBHOOK_SECRET=your-secret
```

Create `/home/leadiya/deploy.sh`:
```bash
#!/bin/bash
cd /home/leadiya/leadiya
git pull
docker compose up --build -d
docker compose logs -f --tail 5
```

For GitHub Actions CD, add secrets to your repo:
- `VPS_HOST`: VPS IP
- `VPS_SSH_KEY`: SSH private key for the leadiya user

## Monthly Cost

| Service | Cost |
|---------|------|
| Hetzner CX22 | ~$5/mo |
| Supabase Free | $0 |
| Cloudflare Free | $0 |
| Redis (on VPS) | $0 |
| **Total** | **~$5/mo** |
