# bgfx

Background blur / replace for browser video calls on Android Chrome (built for SP Jain ELO).
Runs as a bookmarklet: hooks `getUserMedia` and live WebRTC senders, uses MediaPipe Selfie Segmentation, and falls back to the raw camera if anything fails.

- `bgfx.js` — readable source
- `bgfx.min.js` — minified build loaded by the bookmarklet via jsDelivr
