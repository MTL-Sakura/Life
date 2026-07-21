module.exports = {
  apps: [
    {
      name: "sakura-life",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      watch: false,
      time: true,
    },
  ],
};
