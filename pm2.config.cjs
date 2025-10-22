module.exports = {
  apps: [
    {
      name: 'shipsec-backend',
      cwd: __dirname + '/backend',
      script: 'bun',
      args: 'run dev',
      env_file: __dirname + '/backend/.env',
    },
    {
      name: 'shipsec-frontend',
      cwd: __dirname + '/frontend',
      script: 'bun',
      args: 'run dev',
      env_file: __dirname + '/frontend/.env',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'shipsec-worker',
      cwd: __dirname + '/worker',
      script: 'bun',
      args: 'run dev',
      env_file: __dirname + '/worker/.env',
      env: {
        TEMPORAL_TASK_QUEUE: 'shipsec-default',
      },
    },
    {
      name: 'shipsec-test-worker',
      cwd: __dirname + '/worker',
      script: 'bun',
      args: 'run dev',
      env_file: __dirname + '/worker/.env',
      env: {
        TEMPORAL_TASK_QUEUE: 'test-worker-integration',
      },
    },
  ],
};
