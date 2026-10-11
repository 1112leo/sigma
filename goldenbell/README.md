# SIGMA Golden Bell landing page

The static `/goldenbell/` page follows the organizer's supplied October 12
reference: SUITE headlines, SUIT body text, a full-width dotted mathematics
backdrop, overlapping schedule card, and rank-specific prize cards.

Serve the repository root (`python3 -m http.server 8082`) to preview the landing
and `/goldenbell/run/` together. The landing needs no dependencies or build step.
The optional `run/build.mjs` standalone worker packages both Golden Bell routes,
including the landing scripts and locally hosted fonts.

## Event content

- October 30, 2026 (Friday), 16:00–17:30 tentative, school gym.
- Cheonan Oseong High School grades 1–2; first 60 applicants, preregistration only.
- Everyone receives Isaac toast. Culture vouchers: 1st ₩50,000, 2nd ₩30,000,
  3rd ₩10,000. 4th and 5th receive snack boxes.
- Two comeback rounds, during the middle and later parts of the contest.

These facts come from the supplied reference. Update all repeated schedule,
eligibility and prize descriptions together if the organizer changes them.

## Fonts and animation

The original SUIT and SUITE variable WOFF2 files are hosted in `fonts/`, with
their SIL Open Font Licenses. They match the reference's `@2` fonts:
https://github.com/sun-typeface/SUIT and https://github.com/sun-typeface/SUITE.
No font CDN is used at runtime. Existing DNF BitBit and bell-image assets remain
available for other pages; they are not used by this landing.

`landing.js` draws the reference's dot grid, curves and geometry. It stops
animation outside the viewport, in hidden tabs, and for reduced-motion users.
`reveal.js` adds one-time entrances to below-fold sections without changing
layout. Content stays available if those browser APIs are unsupported.

## Registration and contact

Both application buttons open the organizer's Google Form:
https://forms.gle/HBcpW34hJzRkYkDi9. The landing itself collects no applicant data.

After registration closes, set `REGISTRATION_CLOSED = true` near the top of
`landing.js` and publish. This disables both application buttons and updates
the application/FAQ copy. Stop Google Form responses separately in Google Forms;
the landing switch does not control that form or count submissions.

The footer provides SMS contact (010-5707-5642), Instagram contact, and the
existing PIN-protected operator screen at `/goldenbell/run/`.

## Checks

```sh
node --test goldenbell/*.test.cjs goldenbell/run/*.test.cjs
```
