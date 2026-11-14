// Runs in the extension's isolated world: tell the page-world engine where the bundled AI model lives.
try { document.documentElement.setAttribute('data-bgfx-base', chrome.runtime.getURL('mp/')); } catch (e) {}
