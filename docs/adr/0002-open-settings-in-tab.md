# Open the settings page in a browser tab

The extension's complete settings already live in `options.html`, but the browser's default options-page presentation embeds them in the extension management interface. We enable `options_ui.open_in_tab` and keep using `chrome.runtime.openOptionsPage()` so settings open as a standalone browser tab, while the plugin panel remains focused on current-site status and quick controls; we do not add custom tab de-duplication.
