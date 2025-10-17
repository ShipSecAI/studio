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
      name: 'shipsec-worker',
      cwd: __dirname + '/worker',
      script: 'npm',
      args: 'run dev',
      env_file: __dirname + '/worker/.env',
      env: {
        TEMPORAL_TASK_QUEUE: 'shipsec-default',
      },
    },
    {
      name: 'shipsec-test-worker',
      cwd: __dirname + '/worker',
      script: 'npm',
      args: 'run dev',
      env_file: __dirname + '/worker/.env',
      env: {
        TEMPORAL_TASK_QUEUE: 'test-worker-integration',
      },
    },
  ],
};
