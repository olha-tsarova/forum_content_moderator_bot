module.exports = {
  apps: [
    {
      name: "forum_content_moderator_bot",
      script: "dist/index.js",
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
