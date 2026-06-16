// Vercel Speed Insights Integration
// This script initializes Speed Insights to track web performance metrics

import { injectSpeedInsights } from './node_modules/@vercel/speed-insights/dist/index.mjs';

// Initialize Speed Insights
// The function will automatically inject the tracking script
// Note: Speed Insights only tracks data in production (when deployed to Vercel)
injectSpeedInsights({
  debug: false, // Set to true to see debug logs in development
  // sampleRate: 1, // Optional: sample rate (1 = 100%, 0.5 = 50%)
  // beforeSend: (event) => event, // Optional: modify events before sending
});
