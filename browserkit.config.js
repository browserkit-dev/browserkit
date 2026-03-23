// browserkit.config.js
export default {
  host: "127.0.0.1",
  basePort: 52741,
  adapters: {
    // debugPort enables raw Playwright access — see README for details
    "@browserkit/adapter-hackernews": { port: 52741, debugPort: 52742 },
  },
};
