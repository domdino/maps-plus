# Maps Plus privacy policy

**Maps Plus does not collect, store on any server, sell, or share any user data.**

- No analytics, telemetry, crash reporting or tracking of any kind. Maps Plus has no servers.
- Everything Maps Plus keeps (settings, the saved places it has picked up from pages you opened, an optional API key you pasted, and a lookup cache) lives in your browser's `chrome.storage.local`. You can erase it from the options page at any time, or by removing the extension.
- Network requests go only to Google, only when you take an action:
  - **Resolve date** → `maps.googleapis.com` (the same Street View metadata service Google's Maps JavaScript API uses). The request contains the pano's coordinates and ID — nothing about you. Requests are sent without cookies.
  - **Place details**, only if you pasted your own Google Places API key → `places.googleapis.com`, with that key. Requests contain the place name and coordinates.
  - **HTML report with images** → downloads place photos from `*.googleusercontent.com`.
- Saved places are read from responses Google Maps already sends to your own browser tab. Maps Plus never asks for your Google password or cookies and never makes signed-in requests on your behalf.
- Exports are created in your browser and saved to your computer only when you click an export button.

Use of Google Maps remains subject to Google's Terms of Service and Privacy Policy.
