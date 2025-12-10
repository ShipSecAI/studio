#!/usr/bin/env bun
/**
 * Sync all package.json versions with a release tag
 * 
 * Usage: bun scripts/sync-versions.ts v1.0.0
 */

const version = process.argv[2];

if (!version) {
  console.error('Usage: bun scripts/sync-versions.ts <version>');
  console.error('Example: bun scripts/sync-versions.ts v1.0.0');
  process.exit(1);
}

// Remove 'v' prefix if present
const cleanVersion = version.replace(/^v/, '');

// Validate version format (semver)
const semverRegex = /^\d+\.\d+\.\d+(-.+)?$/;
if (!semverRegex.test(cleanVersion)) {
  console.error(`Invalid version format: ${cleanVersion}`);
  console.error('Expected format: X.Y.Z or X.Y.Z-prerelease');
  process.exit(1);
}

const packages = [
  'package.json',
  'packages/shared/package.json',
  'packages/component-sdk/package.json',
  'packages/backend-client/package.json',
  'backend/package.json',
  'worker/package.json',
  'frontend/package.json',
];

console.log(`Updating all packages to version ${cleanVersion}...\n`);

let updated = 0;

for (const pkgPath of packages) {
  try {
    const file = Bun.file(pkgPath);
    const content = await file.text();
    const pkg = JSON.parse(content);

  // Skip if package doesn't have a version field
    if (!('version' in pkg)) {
      console.log(`⏭️  Skipping ${pkgPath} (no version field)`);
      continue;
    }

    const oldVersion = pkg.version;
    pkg.version = cleanVersion;

    // Write back
    await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

    if (oldVersion !== cleanVersion) {
      console.log(`✅ Updated ${pkgPath}: ${oldVersion} → ${cleanVersion}`);
      updated++;
    } else {
      console.log(`✓  ${pkgPath} already at ${cleanVersion}`);
    }
  } catch (error) {
    console.error(`❌ Error updating ${pkgPath}:`, error);
  }
}

console.log(`\n✨ Updated ${updated} package(s) to version ${cleanVersion}`);
console.log('\nNext steps:');
console.log('  1. Review changes: git diff');
console.log('  2. Commit: git add package.json packages/*/package.json backend/package.json worker/package.json frontend/package.json');
console.log(`  3. Commit: git commit -m "chore: bump versions to ${cleanVersion}"`);
console.log(`  4. Tag: git tag -a ${version} -m "Release ${version}"`);
console.log(`  5. Push: git push origin main && git push origin ${version}`);

