# SIGMA Golden Bell landing page

The existing static `/goldenbell/` page is independent from the operator app in
`run/`. Serve the repository root (for example `python3 -m http.server 8082`) to
preview both routes. No dependencies or build step are required for the landing.
The `run/build.mjs` Site deployment packages both `/goldenbell/` and
`/goldenbell/run/`. It reads the landing files from this directory in the main
repository, or from `landing/` in the standalone Site source checkout. Keep that
checkout's landing assets, including fonts and their license, synchronized before publishing. The Site root
redirects to `/goldenbell/`; existing operator URLs remain unchanged.

Run checks from the repository root:

```sh
node --test goldenbell/landing.test.cjs goldenbell/run/*.test.cjs
```

## Registration

The form is deliberately disabled: no submission endpoint, JavaScript, storage,
analytics or collection of applicant information. Before opening registration,
confirm eligibility, venue, schedule, prize details, and the actual data handling
and consent requirements. Do not merely remove `disabled`.

## Hero artwork

Typography uses the user's selected DNF BitBit original Regular WOFF2, downloaded
unchanged from https://cdn.df.nexon.com/img/common/font/DNFBitBit-Regular.woff2.
The file is self-hosted; no installed font or external CDN is needed at runtime.
The same font file serves all visual weights without synthetic bolding.
Copyright (c) 2022 NEOPLE Inc.; SIL Open Font License 1.1 and source attribution
are included in `fonts/DNFBitBit-LICENSE.txt`. Official policy:
https://df.nexon.com/data/font/dnfbitbit.

Decorative glints use CSS geometry, are hidden from assistive technology, never
intercept input, and stop animating when reduced motion is preferred.

`hero-bell.png` was generated with the built-in image generation tool on
2026-09-24, then copied into this project. It is decorative campaign artwork,
not a photograph of an actual event or prize. No third-party logos are used.

Final prompt:

> Use case: ads-marketing. Asset type: hero artwork for a Korean high-school mathematics Golden Bell event landing page, not a website mockup. Create one exquisite cinematic product render: a large elegant polished warm-gold handbell tilted diagonally, short dark handle, floating above a matte midnight navy surface, with three small restrained gold confetti ribbons around it, subtle soft warm spotlight, beautiful specular reflections and deep shadows. Sophisticated youthful editorial art direction, premium school festival campaign. Bell centered in a square 1024x1024 composition with generous dark negative space at the edges. Background almost uniform deep ink navy #101b31 to blend into web background, subtly illuminated near bell. No people, no lettering, no digits, no logos, no watermark, no stage, no podium, no excessive glitter. Strong clear silhouette, tactile brushed and polished metal.
