const fs = require('fs');
const path = require('path');

const instanceNum = process.env.SHIPSEC_INSTANCE || '0';
const isProduction = process.env.SHIPSEC_ENV === 'production' || process.env.NODE_ENV === 'production';

const sharedWatch = isProduction ? false : ['src'];
const sharedIgnoreWatch = ['node_modules', 'dist', '*.log'];

function getInstancePort(basePort, instance) {
  return basePort + Number(instance) * 100;
}

function getDatabaseName(instance) {
  return Number(instance) === 0 ? 'shipsec' : `shipsec_instance_${instance}`;
}

function getTemporalNamespace(instance) {
  return Number(instance) === 0 ? 'shipsec-dev' : `shipsec-dev-${instance}`;
}

function resolveEnvFile(appName, instance) {
  const instancePath = path.join(__dirname, '.instances', `instance-${instance}`, `${appName}.env`);
  const rootPath = path.join(__dirname, appName, '.env');
  return fs.existsSync(instancePath) ? instancePath : rootPath;
}

function getBackendEnv(instance) {
  const port = getInstancePort(3211, instance);
  const databaseUrl = `postgresql://shipsec:shipsec@localhost:5433/${getDatabaseName(instance)}`;
  const temporalNamespace = getTemporalNamespace(instance);
  const suffix = String(instance);

  return {
    NODE_ENV: isProduction ? 'production' : 'development',
    SHIPSEC_INSTANCE: suffix,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    TEMPORAL_NAMESPACE: temporalNamespace,
    TEMPORAL_TASK_QUEUE: temporalNamespace,
    LOG_KAFKA_CLIENT_ID: `shipsec-backend-${suffix}`,
    LOG_KAFKA_GROUP_ID: `shipsec-log-ingestor-${suffix}`,
    EVENT_KAFKA_CLIENT_ID: `shipsec-backend-events-${suffix}`,
    EVENT_KAFKA_GROUP_ID: `shipsec-event-ingestor-${suffix}`,
    NODE_IO_KAFKA_CLIENT_ID: `shipsec-backend-node-io-${suffix}`,
    NODE_IO_KAFKA_GROUP_ID: `shipsec-node-io-ingestor-${suffix}`,
    AGENT_TRACE_KAFKA_CLIENT_ID: `shipsec-backend-agent-trace-${suffix}`,
    AGENT_TRACE_KAFKA_GROUP_ID: `shipsec-agent-trace-ingestor-${suffix}`,
    CHAT_STREAM_KAFKA_CLIENT_ID: `shipsec-backend-chat-stream-${suffix}`,
    CHAT_STREAM_KAFKA_GROUP_ID: `shipsec-chat-stream-ingestor-${suffix}`,
  };
}

function getWorkerEnv(instance) {
  const backendPort = getInstancePort(3211, instance);
  const databaseUrl = `postgresql://shipsec:shipsec@localhost:5433/${getDatabaseName(instance)}`;
  const temporalNamespace = getTemporalNamespace(instance);
  const suffix = String(instance);

  return {
    NODE_ENV: isProduction ? 'production' : 'development',
    SHIPSEC_INSTANCE: suffix,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
    BACKEND_URL: `http://localhost:${backendPort}`,
    DATABASE_URL: databaseUrl,
    TEMPORAL_NAMESPACE: temporalNamespace,
    TEMPORAL_TASK_QUEUE: temporalNamespace,
    LOG_KAFKA_CLIENT_ID: `shipsec-worker-${suffix}`,
    EVENT_KAFKA_CLIENT_ID: `shipsec-worker-events-${suffix}`,
    AGENT_TRACE_KAFKA_CLIENT_ID: `shipsec-worker-agent-trace-${suffix}`,
    NODE_IO_KAFKA_CLIENT_ID: `shipsec-worker-node-io-${suffix}`,
    CHAT_STREAM_KAFKA_CLIENT_ID: `shipsec-worker-chat-stream-${suffix}`,
    NAPI_RS_FORCE_WASI: '1',
  };
}

module.exports = {
  apps: [
    {
      name: `shipsec-backend-${instanceNum}`,
      cwd: path.join(__dirname, 'backend'),
      script: 'bun',
      args: 'run dev',
      interpreter: 'none',
      env_file: resolveEnvFile('backend', instanceNum),
      env: getBackendEnv(instanceNum),
      time: true,
      watch: sharedWatch,
      ignore_watch: sharedIgnoreWatch,
      max_memory_restart: '500M',
    },
    {
      name: `shipsec-frontend-${instanceNum}`,
      cwd: path.join(__dirname, 'frontend'),
      script: 'bun',
      args: 'x --bun vite',
      interpreter: 'none',
      env_file: resolveEnvFile('frontend', instanceNum),
      env: {
        NODE_ENV: isProduction ? 'production' : 'development',
        SHIPSEC_INSTANCE: instanceNum,
      },
      time: true,
      watch: sharedWatch,
      ignore_watch: sharedIgnoreWatch,
    },
    {
      name: `shipsec-worker-${instanceNum}`,
      cwd: path.join(__dirname, 'worker'),
      script: 'bun',
      args: 'src/temporal/workers/dev.worker.ts',
      interpreter: 'none',
      env_file: resolveEnvFile('worker', instanceNum),
      env: getWorkerEnv(instanceNum),
      time: true,
      watch: sharedWatch,
      ignore_watch: sharedIgnoreWatch,
      max_memory_restart: '1G',
    },
    {
      name: 'shipsec-test-worker',
      cwd: path.join(__dirname, 'worker'),
      script: 'bun',
      args: 'src/temporal/workers/dev.worker.ts',
      interpreter: 'none',
      env_file: path.join(__dirname, 'worker', '.env'),
      env: {
        NODE_ENV: 'development',
        TEMPORAL_NAMESPACE: 'shipsec-dev',
        TEMPORAL_TASK_QUEUE: 'test-worker-integration',
        NAPI_RS_FORCE_WASI: '1',
      },
      time: true,
    },
  ],
};
