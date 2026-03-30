// browserkit.config.js
export default {
  host: "127.0.0.1",
  basePort: 52741,
  adapters: {
    // debugPort enables raw Playwright access — see README for details
    "@browserkit/adapter-hackernews": { port: 52741, debugPort: 52742 },
    "/Users/jzarecki/Projects/browserkit-adapter-google-discover/dist/index.js": {
      port: 52743,
      deviceEmulation: "Pixel 7",
      channel: "chrome",
    },
    "/Users/jzarecki/Projects/session-mcp/packages/adapter-linkedin/dist/index.js": { port: 52744, channel: "chrome" },
    "@browserkit/adapter-rescue-flights": { port: 52746 },
    "/Users/jzarecki/Projects/browserkit-adapter-booking/dist/index.js": {
      port: 52745,
      // channel: "chrome" not used — CloakBrowser uses its own Chromium binary
      antiDetection: {
        useCloakBrowser: true,  // CloakBrowser's 33 C++ patches handle everything DataDome checks
      },
    },
  },
};
