# WebLab

A browser home for interactive graphics projects, starting with **Duo**: a direct WebGL 2 port of the SwiftLab folding-screen shader.

## Run locally

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

Open the local URL printed by the server. `npm run build` creates the production build; `npm run start` serves that build with the generated Cloudflare configuration.

## Duo

- Drag left to open and right to close; the expansion slider and Closed / Front / Inside / Open presets let you inspect exact poses.
- In landscape, tap the demo to animate between endpoints. Space also animates; arrow keys and Home / End work when the demo is focused.
- Tune animation duration, progressive blur, diagonal blur, crease blend width, blur easing, and edge darkening.
- Upload or drop landscape images. Select multiple images to enable shuffle. New images fade through white. Unsupported formats, portrait images, and oversized files leave the current image in place.
- Save, rename, restore, and delete parameter versions. Names increment automatically and include save timestamps. These snapshots contain the five exposed shader settings, not image files, animation duration, or shader source.
- Versions and animation duration stay in this browser's local storage. Clearing site data removes them. A local preview and the hosted site have separate storage.
- Image decoding and rendering happen on your device. Images are not uploaded to a server or added to this repository. Refreshing returns to the bundled sample; choose your images again.

The controls dock below the demo rather than covering it. Use the handle to hide or reopen them. Browser CSS approximates the native translucent controls; it does not use Apple's Liquid Glass APIs.

Blur end shift is fixed at 24% in both renderers; saved versions cannot override it.

## Source map

- `projects/001-duo-expansion/duo.frag`: GLSL fold geometry, image projection, blur, shading, camera and metallic edge.
- `projects/001-duo-expansion/renderer.ts`: WebGL resources, uniforms, animation and demand-driven drawing.
- `projects/001-duo-expansion/settings.ts`: defaults, ranges and validation.
- `projects/001-duo-expansion/media.ts`: local image decoding, orientation and texture-size limits.
- `projects/001-duo-expansion/versions.ts`: version archive and defensive decoding.
- `app/page.tsx`: project controls and browser interaction.
- [Duo study notes](Notes/001-DuoExpansion.md): rendering implementation, decisions and tradeoffs.

Each future project should get its own source directory and study file. Keep effect notes focused on rendering, geometry, parameters, architecture and relevant verification. Put editor styling, version UI and browser-layout details in general app documentation instead.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Lint covers owned application code; generated component-library sources are kept intact. Tests cover local archive integrity, parameter validation, snapshot independence, numbering and fold easing. The shader passed native OpenGL compilation and subsequently compiled and linked in the in-app WebGL 2 browser after fixing GLSL ES numeric conversions. These are compilation checks, not a cross-browser GPU compatibility or frame-rate benchmark. Interactive browser QA and real mobile-device performance profiling have not been performed.

An optional, feature-detected WebMCP `configure_duo` tool exposes expansion and the same five shader settings. It never changes images or saves versions. Its registration, valid parameter updates, and rejection of out-of-range values were checked in the in-app browser.

## Sample image

The included Mars dune photograph is NASA/JPL-Caltech/University of Arizona, [PIA15283](https://science.nasa.gov/photojournal/dunes-in-noachis-terra-region-of-mars/), carried over from SwiftLab. The project contains no personal camera-roll photos.
