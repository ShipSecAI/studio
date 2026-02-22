# Remote Development Setup

Run ShipSec Studio infrastructure on a remote Linux machine and develop from your Mac. This is useful when your local machine has limited RAM (e.g., 16GB Mac) and you want to offload Docker containers to a more powerful machine.

## Architecture

```
Mac (local)                        Linux Server (remote)
─────────────                      ────────────────────
Browser  ──LAN (10.0.0.156)──►  nginx :80 ──► frontend :5173
                                             └──► backend :3211

Code editor  ──Mutagen sync──►  /home/shipsec/toronto/
```

- **LAN access** — browse directly via the server's IP, no tunnel needed
- **Mutagen** — syncs code changes from Mac to server in real-time
- **Docker + PM2** — run entirely on the server
- **SSH** — used only for shell access and running commands

## Prerequisites

### On the remote Linux server

| Tool             | Installation                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Docker + Compose | Standard install, user added to `docker` group                                                           |
| Bun              | `curl -fsSL https://bun.sh/install \| bash`                                                              |
| Just             | `curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh \| bash -s -- --to /usr/local/bin` |
| PM2              | Installed via `node_modules`, symlink to PATH (see below)                                                |

### On your Mac

| Tool    | Purpose                                                   |
| ------- | --------------------------------------------------------- |
| SSH     | Built-in                                                  |
| Mutagen | `brew install mutagen-io/mutagen/mutagen` (for file sync) |

## Server Setup

### 1. Create a dedicated user

Don't run as root. Create a `shipsec` user with Docker access:

```bash
# On the server (as root)
useradd -m -s /bin/bash -G docker shipsec
mkdir -p /home/shipsec/.ssh
cp ~/.ssh/authorized_keys /home/shipsec/.ssh/
chown -R shipsec:shipsec /home/shipsec/.ssh
chmod 700 /home/shipsec/.ssh && chmod 600 /home/shipsec/.ssh/authorized_keys
```

### 2. Clone the repo and install dependencies

```bash
# SSH with agent forwarding (needed for private repo clone)
ssh -A shipsec@<server-ip>

cd ~
git clone git@github.com:ShipSecAI/studio-private.git toronto
cd toronto
git checkout <your-branch>
bun install
```

### 3. Symlink tools to PATH

PM2 and bun need to be in PATH for non-interactive SSH and `just` commands:

```bash
# As root on the server
ln -sf /home/shipsec/.bun/bin/bun /usr/local/bin/bun
ln -sf /home/shipsec/toronto/node_modules/.bin/pm2 /usr/local/bin/pm2
```

### 4. Check for port conflicts

The project uses standard ports. Before starting, verify nothing else occupies them:

```bash
ss -tlnp | grep -E ':(80|8081|9000|9001)\s'
```

If conflicts exist (e.g., from CasaOS or Portainer), move the conflicting services to different ports rather than remapping the project's ports. The docker-compose files use standard ports and should not be modified for server-specific conflicts.

### 5. Update .env files

**`backend/.env`** — add/update:

```env
LOG_KAFKA_BROKERS="localhost:9092"
CORS_EXTRA_ORIGINS="http://<server-ip>"
```

**`frontend/.env`** — set empty so API calls use relative URLs through nginx:

```env
VITE_API_URL=
```

> **Important:** `VITE_API_URL` must be empty (not `http://localhost:3211`) so the `openapi-fetch` client uses relative URLs. This works because nginx proxies `/api/` to the backend. See [API Base URL Resolution](#api-base-url-resolution) for details.

### 6. Start the dev environment

```bash
# As shipsec user on the server
cd ~/toronto
just dev
```

On first run, Postgres initialization creates ~12 databases and may exceed the default healthcheck timeout. If it fails, just run `just dev` again — the data persists in Docker volumes.

To start completely fresh: `just dev clean` then `just dev`.

## Mac SSH Configuration

Add this to `~/.ssh/config` for shell access to the server:

```ssh-config
Host toronto-dev
    HostName <server-ip>
    User shipsec
    IdentityFile ~/.ssh/id_ed25519
    ForwardAgent yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Connect with: `ssh toronto-dev`

## Accessing the App

Access the app directly via the server's LAN IP — no tunnel needed:

| Service           | URL                                  |
| ----------------- | ------------------------------------ |
| App (via nginx)   | http://10.0.0.156                    |
| Frontend (direct) | http://10.0.0.156:5173               |
| Backend API       | http://10.0.0.156:3211/api/v1/health |
| Temporal UI       | http://10.0.0.156:8081               |

Login with the default local auth credentials (`admin` / `admin`).

> **Outside your LAN?** Use Tailscale (IP: 100.68.79.68) — same URLs, replace `10.0.0.156` with the Tailscale IP.

## File Sync with Mutagen

Mutagen provides real-time bidirectional file sync between your Mac and the server. A `mutagen.yml` config is already committed to the repo with appropriate ignores (node_modules, .env files, build outputs, .git, etc.).

### Install and start

```bash
# Install on Mac
brew install mutagen-io/mutagen/mutagen

# Start the daemon (once per login session, or add to shell init)
mutagen daemon start

# Start the sync session (from the repo root)
mutagen project start
```

### Daily workflow commands

```bash
mutagen project list       # Check sync status and conflicts
mutagen project pause      # Pause without terminating
mutagen project resume     # Resume a paused session
mutagen project terminate  # Stop and remove the session
```

### What is and isn't synced

| Synced               | Not synced                        |
| -------------------- | --------------------------------- |
| All source files     | `node_modules/`                   |
| Config files         | `.env` files (server has its own) |
| Docs, tests          | `dist/`, `build/` outputs         |
| `mutagen.yml` itself | `.git/` directory                 |

> **Important:** `.env` files are deliberately excluded. The server's `.env` files have different values (CORS origins, empty VITE_API_URL) that must not be overwritten by your local `.env` files.

### Adding new npm dependencies

`node_modules` and `bun.lockb` are not synced (platform-specific binaries). When you add a new package locally, run `bun install` on the server too:

```bash
# After: bun add <pkg> --cwd worker  (or any package)
ssh toronto-dev 'cd /home/shipsec/toronto && bun install'
```

Without this, PM2 will crash-loop the affected process with `ERR_MODULE_NOT_FOUND` until the package is installed.

### Git commits and the server

`.git` is excluded from Mutagen sync — the two repos have different git state (Mac uses a worktree, server has a normal clone) and syncing `.git` would corrupt both.

This is fine for the dev loop: Mutagen syncs file contents in real-time, so the server always has your latest code regardless of whether you've committed. The server's `git status` will show modified files, but that doesn't affect running the app.

If you need the server's git history to reflect your commits (e.g., for branch-aware scripts or after a rebase):

```bash
# Push on Mac, then pull on server
git push && ssh toronto-dev 'cd /home/shipsec/toronto && git pull'
```

## Troubleshooting

### Postgres healthcheck fails on first start

The init script creates multiple databases which takes >50 seconds. The default healthcheck has only 10 retries × 5s = 50s timeout. Run `just dev` a second time — data persists in volumes so initialization is instant.

For a permanent fix, increase retries in `docker/docker-compose.infra.yml`:

```yaml
postgres:
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U shipsec']
    interval: 5s
    timeout: 5s
    retries: 30 # was 10
```

### API calls fail with CORS or go to wrong port

1. Verify `frontend/.env` has `VITE_API_URL=` (empty, not `http://localhost:3211`)
2. Verify `backend/.env` has `CORS_EXTRA_ORIGINS` with the server's LAN IP
3. Hard-refresh the browser (Cmd+Shift+R) after changes — Vite caches JS bundles
4. Restart the frontend: `pm2 restart shipsec-frontend-0`

### "command not found" errors via SSH

Non-interactive SSH doesn't source `.bashrc`. Ensure bun and pm2 are symlinked to `/usr/local/bin/` (see step 3).

### Bash PATH warnings on SSH login

If your Mac sends its PATH to the server (common with zsh), you may see harmless warnings about paths with spaces. These can be ignored.

## API Base URL Resolution

The frontend resolves its API base URL through this chain:

1. **`frontend/src/services/api.ts`** — `resolveApiBaseUrl()` reads `import.meta.env.VITE_API_URL`. If empty/unset, returns `''` (empty string = relative URLs).
2. **`packages/backend-client/src/api-client.ts`** — `ShipSecApiClient` constructor receives the base URL. Uses `??` (nullish coalescing) so empty string is preserved as-is, only falling back to `http://localhost:3211` when `null`/`undefined`.
3. **nginx** — Proxies `/api/` requests to the backend on port 3211 internally.

This means when `VITE_API_URL=` is empty, all API calls become relative (e.g., `/api/v1/components`), which nginx routes correctly regardless of how you access the frontend (LAN IP, Tailscale, ngrok, etc.).

> **Note:** The `??` vs `||` distinction matters here. JavaScript's `||` treats `''` as falsy and would fall back to the default. The `??` operator only triggers on `null`/`undefined`, preserving the intentional empty string.
