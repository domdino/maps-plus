import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Maps Plus — for Google Maps',
    short_name: 'Maps Plus',
    description:
      'Power-user features for Google Maps: resolve Street View capture dates and lasso-select your saved places. Not affiliated with Google.',
    // Every permission is explained in README.md#permissions.
    permissions: ['storage'],
    host_permissions: [
      // SingleImageSearch RPC used by the Pano Date Resolver.
      'https://maps.googleapis.com/*',
      // Optional: Google Places API (New), only used when the user pastes their own key.
      'https://places.googleapis.com/*',
      // Place photos, downloaded only when the user exports an HTML report with images.
      'https://*.googleusercontent.com/*',
    ],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
