# YPPCheck — YouTube Monetization Checker

A mobile-first, static YouTube creator toolkit for the US market. The public site is plain HTML, CSS, and minimal JavaScript. A Cloudflare Pages Function keeps the YouTube Data API key server-side and caches channel reports in Workers KV for 24 hours.

## Pages

- `/` — landing page and tool directory
- `/monetization-checker/` — YPP eligibility and revenue report
- `/earnings-calculator/` — views × RPM scenario calculator
- `/channel-id-finder/` and `/tag-extractor/` — noindex coming-soon pages

## Local development

Use Node.js 20 or newer.

```bash
npm install
npm run dev
```

Wrangler serves the `public` directory and the Function at `/api/check`. Add `YT_API_KEY` to a local `.dev.vars` file for API checks. The file is ignored by Git and must never be committed.

Validate the static deliverable:

```bash
npm run build
npm test
```

## Cloudflare Pages + GitHub deployment

1. Push this repository to the intended GitHub repository.
2. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git** and select the repository.
3. Use **Framework preset: None**, **Build command: `npm run build`**, and **Build output directory: `public`**. Leave the root directory at the repository root.
4. Under **Settings → Variables and Secrets**, add `YT_API_KEY` as an encrypted secret for Production and Preview.
5. Create a Workers KV namespace, then add a KV binding named exactly `YT_CACHE` for Production and Preview.
6. Deploy. Pages automatically discovers the root `functions/` directory and exposes `functions/api/check.js` at `/api/check`.
7. Add the production custom domain in **Custom domains**, then update every `https://youtubemonetizationcheck.com` canonical, Open Graph URL, sitemap URL, and robots sitemap entry if the real domain differs.

Every push to the connected production branch triggers a new Cloudflare Pages deployment.

## YouTube API setup

Create or select a Google Cloud project, enable **YouTube Data API v3**, and create an API key. Restrict the key to the YouTube Data API. Store it only as the Cloudflare secret `YT_API_KEY` (and optionally in uncommitted `.dev.vars` for local testing).

## Accuracy model

YouTube does not expose YPP membership, valid watch hours, Shorts-feed views, revenue, or policy standing through the public Data API. The checker therefore labels those fields as estimates. It samples up to 50 recent public uploads, uses duration as a Shorts heuristic, and compares the modeled signals with current numeric YPP thresholds. Only YouTube Studio is authoritative.

## Production notes

- `public/_headers` adds basic security headers and long-lived asset caching.
- `public/robots.txt` allows crawling and points to the sitemap.
- `public/sitemap.xml` lists all indexable pages.
- Replace the placeholder ad zones only after AdSense approval; keep ads non-intrusive.
- The HTML intentionally loads Tailwind through its CDN per project requirements, while the critical visual system lives in the small local stylesheet.
