# Privacy Policy — Watchdog

Last updated: 16 September 2026

Watchdog is a Chrome extension that helps you stay on-topic while studying on YouTube.
It is designed so that nothing about what you watch leaves your computer.

## What the extension reads

On YouTube watch pages, Watchdog reads the title and channel name of the video currently
playing. This text is compared against your chosen focus topic by a language model that runs
inside the extension, on your device. The text is then discarded. It is never transmitted,
logged, or stored.

## What the extension stores

Your focus topic, sensitivity setting, snooze state, and list of allowed channels are saved
in Chrome's local extension storage (`chrome.storage.local`). This data stays on your
machine and is removed when you uninstall the extension.

## Network requests

Watchdog makes one kind of network request: on first use it downloads the language model
(about 23 MB) from Hugging Face (huggingface.co). This is a one-time download of a public
file. It carries no information about you or your viewing. After that the model is cached
and the extension works fully offline.

## What the extension does not do

- It does not collect, sell, or share any personal data.
- It does not use analytics, telemetry, or crash reporting.
- It does not track your browsing history.
- It does not contain ads.
- It does not require an account.

## Permissions

- `storage` — to save your settings locally.
- Host access to `https://www.youtube.com/*` — to read the current video's title and
  channel name, and to show the reminder card on the page.

## Open source

The complete source code is public at
https://github.com/Zahoor-ishfaq/youtube-watchdog so anyone can verify these claims.

## Contact

Questions or concerns: open an issue at
https://github.com/Zahoor-ishfaq/youtube-watchdog/issues
