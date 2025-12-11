# Release Process

This document describes the release process for ShipSec Studio, including Docker image releases and npm package versioning.

## Docker Image Releases

### Automatic Release (Recommended)

When you push a git tag matching the pattern `v*.*.*` (e.g., `v1.0.0`, `v1.2.3`), the GitHub Actions workflow automatically:

1. **Builds** all three Docker images (backend, worker, frontend)
2. **Tags** images with:
   - Version tag: `ghcr.io/shipsecai/studio-{service}:{version}` (e.g., `ghcr.io/shipsecai/studio-backend:1.0.0`)
   - Latest tag: `ghcr.io/shipsecai/studio-{service}:latest`
3. **Pushes** images to GitHub Container Registry (GHCR)
4. **Creates** a GitHub release with changelog

### Manual Release

You can also trigger a release manually via GitHub Actions UI:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Enter the version tag (e.g., `v1.0.0`)

### Creating a Release

```bash
# 1. Ensure you're on main branch and up to date
git checkout main
git pull origin main

# 2. Create and push a tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# The workflow will automatically build and release
```

### Image Tags

Images are tagged as:
- `ghcr.io/shipsecai/studio-backend:{version}` and `:latest`
- `ghcr.io/shipsecai/studio-worker:{version}` and `:latest`
- `ghcr.io/shipsecai/studio-frontend:{version}` and `:latest`

### Pulling Images

```bash
# Pull a specific version
docker pull ghcr.io/shipsecai/studio-backend:1.0.0

# Pull latest
docker pull ghcr.io/shipsecai/studio-backend:latest
```

## NPM Package Versioning

### Current State

This is a **monorepo** with workspace packages:
- `@shipsec/shared` (v0.1.0)
- `@shipsec/component-sdk` (v0.1.0, private)
- `@shipsec/backend-client` (v0.1.0)
- `@shipsec/studio-backend` (v0.1.0)
- `@shipsec/studio-worker` (v0.1.0, private)
- `@shipsec/studio-frontend` (v1.0.0)

**Important**: These packages are **workspace dependencies** and are **not published to npm**. They're consumed internally within the monorepo.

### Versioning Strategies

#### Option 1: Manual Versioning (Current - Simplest)

**When to use**: Small teams, infrequent releases, packages not published to npm.

**Process**:
1. Update `package.json` versions manually before release
2. Commit version changes
3. Tag release

**Pros**:
- Simple, no tooling needed
- Full control over versions
- Works well for internal packages

**Cons**:
- Easy to forget
- Can get out of sync
- Manual work

#### Option 2: Sync with Docker Release Tag (Recommended for Internal Packages)

Since packages aren't published to npm, you can sync versions with Docker releases:

```bash
# Script to sync all package versions with release tag
bun run scripts/sync-versions.ts v1.0.0
```

This updates all `package.json` files to match the release version.

**Pros**:
- Keeps versions in sync
- Simple automation
- No external tooling

**Cons**:
- Still requires running script
- All packages get same version

#### Option 3: Changesets (Best for Published Packages)

**When to use**: If you plan to publish packages to npm, or want independent versioning.

**Setup**:
```bash
bun add -D @changesets/cli
bun changeset init
```

**Process**:
1. Developers add changesets: `bun changeset`
2. Version command: `bun changeset version`
3. Publish: `bun changeset publish`

**Pros**:
- Industry standard for monorepos
- Independent package versioning
- Great for published packages
- Changelog generation

**Cons**:
- More setup
- Requires developer discipline
- Overkill for internal-only packages

#### Option 4: Semantic Release (Auto-versioning)

**When to use**: Want fully automated versioning based on commit messages.

Uses commit message conventions (Conventional Commits) to automatically:
- Determine version bump
- Update package.json
- Generate changelog
- Create git tags

**Pros**:
- Fully automated
- No manual version management
- Consistent with commit messages

**Cons**:
- Requires commit message discipline
- Less control
- Can be complex for monorepos

### Recommendation

**For ShipSec Studio (current state)**:

Since packages are **not published to npm** and are **workspace dependencies**, we recommend:

1. **Option 2**: Sync versions with Docker release tag
   - Simple script to update all package.json files
   - Keeps versions consistent
   - No external dependencies

2. **Future**: If you publish packages to npm, migrate to **Option 3 (Changesets)**

### Implementation

See `scripts/sync-versions.ts` for the version sync script.

## Release Checklist

- [ ] Update CHANGELOG.md (if maintained)
- [ ] Run tests: `bun run test`
- [ ] Run typecheck: `bun run typecheck`
- [ ] Update package versions (if syncing): `bun run scripts/sync-versions.ts v1.0.0`
- [ ] Commit version changes (if any)
- [ ] Create and push tag: `git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`
- [ ] Verify GitHub Actions workflow completes
- [ ] Verify images are available in GHCR
- [ ] Verify GitHub release is created

## Required GitHub Secrets

The release workflow uses `GITHUB_TOKEN` which is automatically provided by GitHub Actions. No additional secrets are required for GHCR.

## Troubleshooting

### Images not appearing in GHCR

1. Check workflow logs for errors
2. Verify `GITHUB_TOKEN` has `packages:write` permission
3. Ensure repository has GitHub Packages enabled

### Release not created

1. Check workflow logs
2. Verify tag format matches `v*.*.*`
3. Check GitHub Actions permissions

