const fs = require('fs');
const path = require('path');

function isLinuxMusl() {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
    if (report?.header?.glibcVersionRuntime) {
      return false;
    }
    if (Array.isArray(report?.sharedObjects)) {
      if (report.sharedObjects.some((file) => file.includes('libc.musl-') || file.includes('ld-musl-'))) {
        return true;
      }
    }
  } catch (_) {
    // Ignore report inspection errors and continue with filesystem probing.
  }

  try {
    const ldd = fs.readFileSync('/usr/bin/ldd', 'utf-8');
    if (ldd.includes('musl')) {
      return true;
    }
  } catch (_) {
    // Ignore missing ldd; we'll try the child process fallback.
  }

  try {
    const output = require('child_process')
      .execSync('ldd --version', { encoding: 'utf8' })
      .toLowerCase();
    return output.includes('musl');
  } catch (_) {
    return false;
  }
}

function getSwcTargets() {
  const { platform, arch } = process;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return ['darwin-arm64'];
    }
    if (arch === 'x64') {
      return ['darwin-x64'];
    }
  }

  if (platform === 'linux') {
    const musl = isLinuxMusl();
    if (arch === 'x64') {
      return musl ? ['linux-x64-musl', 'linux-x64-gnu'] : ['linux-x64-gnu', 'linux-x64-musl'];
    }
    if (arch === 'arm64') {
      return musl ? ['linux-arm64-musl', 'linux-arm64-gnu'] : ['linux-arm64-gnu', 'linux-arm64-musl'];
    }
    if (arch === 'arm') {
      return ['linux-arm-gnueabihf'];
    }
    if (arch === 'riscv64') {
      return musl ? ['linux-riscv64-musl', 'linux-riscv64-gnu'] : ['linux-riscv64-gnu', 'linux-riscv64-musl'];
    }
    if (arch === 's390x') {
      return ['linux-s390x-gnu'];
    }
  }

  if (platform === 'win32') {
    if (arch === 'x64') {
      return ['win32-x64-msvc'];
    }
    if (arch === 'ia32') {
      return ['win32-ia32-msvc'];
    }
    if (arch === 'arm64') {
      return ['win32-arm64-msvc'];
    }
  }

  if (platform === 'freebsd') {
    if (arch === 'x64') {
      return ['freebsd-x64'];
    }
    if (arch === 'arm64') {
      return ['freebsd-arm64'];
    }
  }

  if (platform === 'android') {
    if (arch === 'arm64') {
      return ['android-arm64'];
    }
    if (arch === 'arm') {
      return ['android-arm-eabi'];
    }
  }

  return [];
}

function collectCandidatePaths(target) {
  const candidates = [];
  const bunDir = path.join(__dirname, 'node_modules', '.bun');
  const aggregateDir = path.join(bunDir, 'node_modules', '@swc', `core-${target}`, `swc.${target}.node`);

  if (aggregateDir && fs.existsSync(aggregateDir)) {
    candidates.push(aggregateDir);
  }

  try {
    const entries = fs.readdirSync(bunDir);
    for (const entry of entries) {
      if (entry.startsWith(`@swc+core-${target}@`)) {
        const versionedPath = path.join(
          bunDir,
          entry,
          'node_modules',
          '@swc',
          `core-${target}`,
          `swc.${target}.node`,
        );
        candidates.push(versionedPath);
      }
    }
  } catch (_) {
    // Unable to scan versioned directories; continue with resolver fallback.
  }

  try {
    const resolvedPkg = require.resolve(`@swc/core-${target}/package.json`, {
      paths: [path.join(bunDir, 'node_modules'), __dirname],
    });
    const resolvedCandidate = path.join(path.dirname(resolvedPkg), `swc.${target}.node`);
    candidates.push(resolvedCandidate);
  } catch (_) {
    // Optional dependency may not be installed for this platform.
  }

  return Array.from(new Set(candidates));
}

function resolveSwcBinaryPath() {
  const targets = getSwcTargets();
  for (const target of targets) {
    const candidates = collectCandidatePaths(target);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

const swcBinaryPath = resolveSwcBinaryPath();
if (!swcBinaryPath) {
  console.warn('Unable to automatically resolve SWC native binary; Temporal workers will use default resolution.');
}

// Load frontend .env file and extract VITE_* variables
function loadFrontendEnv() {
  const envPath = path.join(__dirname, 'frontend', '.env');
  const env = { NODE_ENV: 'development' };
  
  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
          return;
        }
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim();
          // Only include VITE_* variables for frontend
          if (key.startsWith('VITE_')) {
            env[key] = value;
          }
        }
      });
    }
  } catch (err) {
    console.warn('Failed to load frontend .env file:', err.message);
  }
  
  return env;
}

const frontendEnv = loadFrontendEnv();

// Load worker .env file for OpenSearch and other worker-specific variables
function loadWorkerEnv() {
  const envPath = path.join(__dirname, 'worker', '.env');
  const env = {};

  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
          return;
        }
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          env[key] = value;
        }
      });
    }
  } catch (err) {
    console.warn('Failed to load worker .env file:', err.message);
  }

  return env;
}

const workerEnv = loadWorkerEnv();

// Determine environment from NODE_ENV or SHIPSEC_ENV
const environment = process.env.SHIPSEC_ENV || process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Get instance number (0-9) for multi-instance support
const instanceNum = process.env.SHIPSEC_INSTANCE || '0';
const instanceDatabaseUrl = `postgresql://shipsec:shipsec@localhost:5433/shipsec_instance_${instanceNum}`;
// Only set these defaults for local development. In production, credentials must
// come from the environment / deployment config.
const devInstanceEnv = isProduction
  ? {}
  : {
      DATABASE_URL: instanceDatabaseUrl,
      SECRET_STORE_MASTER_KEY: process.env.SECRET_STORE_MASTER_KEY || 'ShipSecLocalDevKey32Bytes!!!!!!!',
    };

// Environment-specific configuration
const envConfig = {
  development: {
    TEMPORAL_TASK_QUEUE: 'shipsec-dev',
    TEMPORAL_NAMESPACE: 'shipsec-dev',
    NODE_ENV: 'development',
  },
  production: {
    TEMPORAL_TASK_QUEUE: 'shipsec-prod',
    TEMPORAL_NAMESPACE: 'shipsec-prod',
    NODE_ENV: 'production',
  },
};

const currentEnvConfig = envConfig[isProduction ? 'production' : 'development'];

// Helper to get instance-specific env file path
function getInstanceEnvFile(appName, instance) {
  return __dirname + `/.instances/instance-${instance}/${appName}.env`;
}

// Helper to get instance-specific ports
function getInstancePort(basePort, instance) {
  return basePort + parseInt(instance) * 100;
}

// Get env file (use instance-specific if it exists, otherwise fall back to root)
function resolveEnvFile(appName, instance) {
  const instancePath = getInstanceEnvFile(appName, instance);
  const rootPath = __dirname + `/${appName}/.env`;
  
  if (fs.existsSync(instancePath)) {
    return instancePath;
  }
  return rootPath;
}

module.exports = {
  apps: [
    {
      name: `shipsec-backend-${instanceNum}`,
      cwd: __dirname + '/backend',
      script: 'bun',
      args: isProduction ? 'src/main.ts' : 'run dev',
      interpreter: 'none',
      env_file: resolveEnvFile('backend', instanceNum),
      env: {
        ...currentEnvConfig,
        PORT: getInstancePort(3211, instanceNum),
        // Ensure instance DB isolation even if dotenv auto-loads a workspace/default `.env`.
        ...devInstanceEnv,
        TERMINAL_REDIS_URL: process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379',
        LOG_KAFKA_BROKERS: process.env.LOG_KAFKA_BROKERS || 'localhost:9092',
        LOG_KAFKA_TOPIC: process.env.LOG_KAFKA_TOPIC || 'telemetry.logs',
        LOG_KAFKA_CLIENT_ID: process.env.LOG_KAFKA_CLIENT_ID || `shipsec-backend-${instanceNum}`,
        LOG_KAFKA_GROUP_ID: process.env.LOG_KAFKA_GROUP_ID || `shipsec-backend-log-consumer-${instanceNum}`,
        EVENT_KAFKA_TOPIC: process.env.EVENT_KAFKA_TOPIC || 'telemetry.events',
        EVENT_KAFKA_CLIENT_ID: process.env.EVENT_KAFKA_CLIENT_ID || `shipsec-backend-events-${instanceNum}`,
        EVENT_KAFKA_GROUP_ID: process.env.EVENT_KAFKA_GROUP_ID || `shipsec-event-ingestor-${instanceNum}`,
        NODE_IO_KAFKA_TOPIC: process.env.NODE_IO_KAFKA_TOPIC || 'telemetry.node-io',
        NODE_IO_KAFKA_CLIENT_ID:
          process.env.NODE_IO_KAFKA_CLIENT_ID || `shipsec-backend-node-io-${instanceNum}`,
        NODE_IO_KAFKA_GROUP_ID:
          process.env.NODE_IO_KAFKA_GROUP_ID || `shipsec-node-io-ingestor-${instanceNum}`,
        AGENT_TRACE_KAFKA_TOPIC: process.env.AGENT_TRACE_KAFKA_TOPIC || 'telemetry.agent-trace',
        AGENT_TRACE_KAFKA_CLIENT_ID:
          process.env.AGENT_TRACE_KAFKA_CLIENT_ID || `shipsec-backend-agent-trace-${instanceNum}`,
        AGENT_TRACE_KAFKA_GROUP_ID:
          process.env.AGENT_TRACE_KAFKA_GROUP_ID || `shipsec-agent-trace-ingestor-${instanceNum}`,
        ENABLE_INGEST_SERVICES: process.env.ENABLE_INGEST_SERVICES || 'true',
        INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
        TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        TEMPORAL_NAMESPACE: `shipsec-dev-${instanceNum}`,
        TEMPORAL_TASK_QUEUE: `shipsec-dev-${instanceNum}`,
      },
      watch: !isProduction ? ['src'] : false,
      ignore_watch: ['node_modules', 'dist', '*.log'],
      max_memory_restart: '500M',
    },
    {
      name: `shipsec-frontend-${instanceNum}`,
      cwd: __dirname + '/frontend',
      script: 'bun',
      // Ensure each instance binds to its own Vite port (default is 5173).
      args: ['run', 'dev', '--', '--port', String(getInstancePort(5173, instanceNum)), '--strictPort'],
      env_file: resolveEnvFile('frontend', instanceNum),
      env: {
        ...frontendEnv,
        ...currentEnvConfig,
        VITE_API_URL: `http://localhost:${getInstancePort(3211, instanceNum)}`,
      },
      watch: !isProduction ? ['src'] : false,
      ignore_watch: ['node_modules', 'dist', '*.log'],
    },
    {
      name: `shipsec-worker-${instanceNum}`,
      cwd: __dirname + '/worker',
      // Run the worker with Node + tsx to avoid Bun's SWC binding issues
      script: __dirname + '/node_modules/.bin/tsx',
      args: 'src/temporal/workers/dev.worker.ts',
      env_file: resolveEnvFile('worker', instanceNum),
      env: Object.assign(
        {
          ...workerEnv, // Load worker .env file (includes OPENSEARCH_URL, etc.)
          ...currentEnvConfig,
          NAPI_RS_FORCE_WASI: '1',
          INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
          STUDIO_API_BASE_URL: process.env.STUDIO_API_BASE_URL || `http://localhost:${getInstancePort(3211, instanceNum)}/api/v1`,
          ...devInstanceEnv,
          TERMINAL_REDIS_URL: process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379',
          LOG_KAFKA_BROKERS: process.env.LOG_KAFKA_BROKERS || 'localhost:9092',
          LOG_KAFKA_TOPIC: process.env.LOG_KAFKA_TOPIC || 'telemetry.logs',
          LOG_KAFKA_CLIENT_ID: process.env.LOG_KAFKA_CLIENT_ID || `shipsec-worker-${instanceNum}`,
          EVENT_KAFKA_TOPIC: process.env.EVENT_KAFKA_TOPIC || 'telemetry.events',
          EVENT_KAFKA_CLIENT_ID: process.env.EVENT_KAFKA_CLIENT_ID || `shipsec-worker-events-${instanceNum}`,
          TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
          TEMPORAL_NAMESPACE: `shipsec-dev-${instanceNum}`,
          TEMPORAL_TASK_QUEUE: `shipsec-dev-${instanceNum}`,
          SKIP_CONTAINER_CLEANUP: process.env.SKIP_CONTAINER_CLEANUP || 'false',
        },
        swcBinaryPath ? { SWC_BINARY_PATH: swcBinaryPath } : {},
      ),
      watch: !isProduction ? ['src'] : false,
      ignore_watch: ['node_modules', 'dist', '*.log'],
      max_memory_restart: '1G',
    },
    {
      name: 'shipsec-test-worker',
      cwd: __dirname + '/worker',
      // Use Node + tsx here as well
      script: __dirname + '/node_modules/.bin/tsx',
      args: 'src/temporal/workers/dev.worker.ts',
      env_file: __dirname + '/worker/.env',
      env: Object.assign(
        {
          ...workerEnv, // Load worker .env file (includes OPENSEARCH_URL, etc.)
          TEMPORAL_TASK_QUEUE: 'test-worker-integration',
          TEMPORAL_NAMESPACE: 'shipsec-dev',
          NODE_ENV: 'development',
          NAPI_RS_FORCE_WASI: '1',
        },
        swcBinaryPath ? { SWC_BINARY_PATH: swcBinaryPath } : {},
      ),
    },
  ],
};
