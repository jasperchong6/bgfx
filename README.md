# bgfx

Background blur / replace for browser video calls on Android Chrome (built for SP Jain ELO).
Runs as a bookmarklet: hooks `getUserMedia` and live WebRTC senders, uses MediaPipe Selfie Segmentation, and falls back to the raw camera if anything fails.

- `bgfx.js` — readable source
- `bgfx.min.js` — minified build loaded by the bookmarklet via jsDelivr

Save it as a bookmark (once)
In Chrome, open any page and tap ⋮ → ☆ to bookmark it.
Tap Edit on the pop-up (or ⋮ → Bookmarks, long-press it, Edit).
Name it bgfx. Clear the URL field and paste the code. Save.

javascript:(function()%7Bif(window.__bgfx)%7Bwindow.__bgfx.open()%3Breturn%7Dvar%20s%3Ddocument.createElement(%27script%27)%3Bs.src%3D%27https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2Fjasperchong6%2Fbgfx%4091ae2f86c0a9b6deee8c6a7884b22bc02a31bcc3%2Fbgfx.min.js%27%3Bs.onerror%3Dfunction()%7Balert(%27bgfx%20could%20not%20load.%20This%20page%20may%20be%20blocking%20it%2C%20or%20you%20are%20offline.%27)%7D%3B(document.head%7C%7Cdocument.documentElement).appendChild(s)%7D)()

Use it in browser in Android Phone
Open virtual meeting website in Chrome and get to the meeting or pre-join screen.
Tap the address bar, type bgfx, and tap the bookmark suggestion (not a search result). Tapping it from the Bookmarks menu won't work, Chrome only runs it from the address bar.
A ✨ button appears within a few seconds. Tap it to pick a mode. Drag it if it covers a control. If you see a "bgfx could not load" message instead, the page or your connection blocked it.
If your camera was already on, it switches over within 2 seconds. If you still look unchanged, turn your camera off and on in ELO.

Modes and the status dot
Blur
AI cuts you out and blurs the rest. Slider sets strength.
Image
Your own photo from the gallery behind you.
Colour
Plain colour behind you.
Spot
No AI: soft blur outside an oval around your head and shoulders. Lightest on battery.
Off
Raw camera.
