# Applied - Smart Job Application Assistant

![Applied Logo](extension/logo.svg)

Applied is a privacy-first browser extension that helps autofill job application forms using a local proxy with deterministic rules and optional AI.

## Tech Stack

`JavaScript` `Node.js` `Express` `Browser Extension` `AI/LLM`

## Key Features

- **Hybrid resolver:** deterministic mapping first, AI only for unresolved fields.
- **Low-latency caching:** response cache plus in-flight deduplication for repeated clicks.
- **Answer memory:** remembers approved answers and reuses them on matching fields.
- **Duplicate application guard:** tracks submitted applications and warns before reapplying.
- **Local-first architecture:** proxy runs on localhost; profile data stays local.

## Browser Support

- **Firefox:** fully supported (Manifest V2).
- **Chrome/Chromium:** supported in Developer Mode.

## ATS Support Matrix

Coverage below is practical support level based on current adapter + fill strategy in this repository.

| ATS / Site | Support Level | Estimated Autofill Coverage | Notes |
| --- | --- | --- | --- |
| Greenhouse | High | ~95% | Best overall extraction and select/radio handling. |
| Lever | High | ~90% | Strong coverage on common text/select/radio patterns. |
| Ashby | Medium-High | ~85% | Good coverage, but custom UI variants can differ by company. |
| Workday | Medium | ~75% | Works on common flows, but Workday DOM variations are broad. |

## Getting Started

### 1) Prerequisites

- Node.js 18+
- [GitHub token](https://github.com/settings/tokens) (optional; required only for AI resolver)

### 2) Setup Proxy

```bash
npm install
cp .env.example .env
# add GITHUB_TOKEN in .env if you want AI resolution
npm run start:proxy
```

### 3) Install Extension

1. Open your browser extensions page.
2. Enable **Developer Mode**.
3. Click **Load Unpacked** and select `extension/`.

## Profile Data

Put your structured profile files in `profile-data/`:

- `profile.v2.json` (primary profile facts)
- `answers.v2.txt` (optional answer bank for long-form responses)

Then reload profile data from the extension UI or call the proxy reload endpoint.

## Performance and Timeouts

- Extension proxy timeout is tuned to **50s** to reduce first-click timeouts on slower models.
- Proxy caches resolved forms and reuses in-flight work for identical requests.

## Development

Run tests:

```bash
npm test
```

## Privacy

Personal data remains local to your machine. AI usage is optional and controlled by your proxy configuration.
