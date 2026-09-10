# Lab

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
- Save, rename, restore, and delete parameter versions. Names increment automatically and include save timestamps. These snapshots contain the exposed shader settings, not image files, animation duration, or shader source.
- Versions and animation duration stay in this browser's local storage. Clearing site data removes them. A local preview and the hosted site have separate storage.
- Image decoding and rendering happen on your device. Visitor uploads are not sent to a server or added to this repository. The Italy sample collection is bundled publicly. Refreshing returns to the bundled sample; choose your images again.

The controls start hidden. Use the sliders icon to open the floating right-side inspector, and its close button, the same icon, or Escape to dismiss it. The panel has a 12 px inset and rounded corners; the demo moves into the remaining space while it slides in. The inspector is nonmodal so the demo remains interactive. Browser CSS approximates the native translucent controls; it does not use Apple's Liquid Glass APIs.

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

An optional, feature-detected WebMCP `configure_duo` tool exposes expansion and the same shader settings. It never changes images or saves versions. Its registration, valid parameter updates, and rejection of out-of-range values were checked in the in-app browser.

## Sample image

The public Italy collection contains four photos supplied by Ben DiMarco. `P1001163.JPG` is the default. Pick a thumbnail in the controls or use Shuffle to explore the collection. Uploading your own photos switches shuffle to your selected files; choosing an Italy thumbnail switches it back. Every switch keeps the existing fade through white.

Files live in `public/photos/italy/`. Add a landscape JPEG (up to 2048 px wide) and a 360 px thumbnail named `<id>-thumb.jpg`, then add the ID and label to `projects/001-duo-expansion/samples.ts`. The first entry is the default. Exported copies use JPEG compression and omit EXIF metadata; originals are unchanged. Only the selected full-size photo is decoded, and thumbnail loading is deferred.

The Blur curve editor has two vertical handles: drag with a mouse or touch, or focus a handle and use Up/Down (Shift for larger steps). Reset restores the progressive default; saved versions include the curve. These controls are available to every visitor who can access the site and affect only their own session.

Canvas resizing draws synchronously after updating its backing buffer. This prevents the cleared opaque buffer from appearing black during inspector transitions; unchanged pixel dimensions are not reassigned.

## Repository

GitHub: https://github.com/bendimarco/TheLab

This remains a standalone app. Clone the repository, run `npm ci`, then `npm run dev` with Node 22.13 or newer. The initial shader preset matches the selected Version 1; visitor-created versions remain local to each browser. The Sites hosting manifest is retained for that deployment option.
