# Lab

A browser home for interactive graphics projects, starting with **Duo**: a direct WebGL 2 port of the SwiftLab folding-screen shader.

For future experiments, read [the compact Lab handoff](Notes/START-HERE.md) and use [the project case-study template](Notes/ProjectTemplate.md).

## Run locally

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

Open the local URL printed by the server. `npm run build` creates the production build; `npm run start` serves that build with the generated Cloudflare configuration.

## Duo

- Drag left to open and right to close. Releasing near an endpoint gently settles the fold with a damped spring; enable **Precise dragging** to stop at the exact release position. This preference is local to the browser. The expansion slider and Closed / Front / Inside / Open presets let you inspect exact poses.
- In landscape, tap the demo to animate between endpoints. Space also animates; arrow keys and Home / End work when the demo is focused.
- Tune animation duration, progressive blur, diagonal blur, crease blend width, and edge darkening.
- Upload or drop photos and videos (images up to 30 MB, videos up to 100 MB). Browser-playable MP4, WebM, and MOV files loop silently through the same shader. Video frames are capped at 1280 px and 60 texture updates per second, and playback pauses when the gallery or another tab is visible. Vertical and square images are cropped in the center to 3:2 before loading. Select multiple images to enable shuffle. New images fade through white. Unsupported formats and oversized files leave the current image in place.
- Save, rename, restore, and delete parameter versions. Names increment automatically and include save timestamps. These snapshots contain the exposed shader settings, not image files, animation duration, or shader source.
- Versions and animation duration stay in this browser's local storage. Clearing site data removes them. A local preview and the hosted site have separate storage.
- Image decoding and rendering happen on your device. Visitor uploads are not sent to a server or added to this repository. The Italy sample collection is bundled publicly. Your personal rotation persists across refreshes in local IndexedDB.

After one idle second, a single-line “Drag left to expand” hint eases in just beside the right edge of the closed phone, over 0.7 seconds. A gentle opening pulse starts 0.2 seconds after that entrance finishes and repeats every four seconds. It opens to 9.5% over 0.85 seconds and closes over 1.05 seconds. Interacting dismisses the guidance for that visit; refreshing the page makes it available again. Reduced-motion preferences suppress the nudge.

The controls start hidden. Use the sliders icon to open the floating right-side inspector, and its close button, the same icon, or Escape to dismiss it. The panel has a 12 px inset and rounded corners; the demo moves into the remaining space while it slides in. On mobile, the inspector slides up from the bottom as a scrollable sheet, using at most 48% of the viewport (420 px), moving the demo into the space above it with matching animation timing, and respecting the bottom safe area. The media toolbar hides while the mobile sheet is open, freeing its reserved space for the demo. The close button or Modify button dismisses it. The inspector is nonmodal so the demo remains interactive. Browser CSS approximates the native translucent controls; it does not use Apple's Liquid Glass APIs.

Blur end shift is fixed at 24% in both renderers; saved versions cannot override it.

## Source map

- `projects/001-duo-expansion/duo.frag`: GLSL fold geometry, image projection, blur, shading, camera and metallic edge.
- `projects/001-duo-expansion/renderer.ts`: WebGL resources, uniforms, animation and demand-driven drawing.
- `projects/001-duo-expansion/settings.ts`: defaults, ranges and validation.
- `projects/001-duo-expansion/media.ts`: local photo/video decoding, centered cropping, frame scheduling and texture-size limits.
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

The public Italy collection contains one video and three photos supplied by Ben DiMarco. The default is **Dog**, followed by **Italy video** (`P1001308.MP4`), **Lake**, and **Friend**. The sunset sample has been removed. Phones start with Dog and shuffle only the photos; the video remains an explicit choice in the picker. Reduced-motion and data-saving preferences also default to stills. The 4.5-second video is a silent, fast-start H.264 copy at 1280 × 852 and about 30 fps, reduced from 28.3 MB to 5.0 MB. The original file is unchanged. Only the selected sample loads; unsupported sample-video decoding falls back to Dog. Pick a thumbnail in the controls or use Shuffle to explore the collection. Adding your own photos creates a personal rotation saved in IndexedDB on this browser and origin. Subsequent uploads append to it, and Shuffle excludes the sample photos while that rotation exists. Collections of up to four items advance in order and wrap around; larger collections shuffle randomly without immediately repeating the active item. Selecting an Italy thumbnail previews it without deleting the personal rotation. The toolbar shows the uploaded count and latest three thumbnails. Click the stack to open the animated gallery, select a photo, or remove one with its × button. Deletions persist locally; removing the last photo restores sample shuffling. Prepared images are stored locally as bounded-size WebP blobs; videos retain their original file plus a still preview. Playback format support depends on the browser (H.264 MP4 is a practical choice); uploads are never sent to a server. Storage does not transfer between localhost, workers.dev, and the custom domain, and clearing browser site data removes the rotation. Every switch keeps the existing fade through white.

Files live in `public/photos/italy/`. Add a landscape JPEG (up to 2048 px wide) and a 360 px thumbnail named `<id>-thumb.jpg`, then add the ID and label to `projects/001-duo-expansion/samples.ts`. The first entry is the desktop default; the first still is the phone default. Exported copies use JPEG compression and omit EXIF metadata; originals are unchanged. Only the selected full-size photo is decoded, and thumbnail loading is deferred.

The Blur curve editor has two handles that move horizontally and vertically across the full graph: drag with a mouse or touch, or focus a handle and use the arrow keys (Shift for larger steps). Move the handles toward the corners to create much steeper falloffs. Reset restores the progressive default; saved versions include the curve. These controls are available to every visitor who can access the site and affect only their own session.

Canvas resizing draws synchronously after updating its backing buffer. This prevents the cleared opaque buffer from appearing black during inspector transitions; unchanged pixel dimensions are not reassigned.

## Repository

GitHub: https://github.com/bendimarco/TheLab

This remains a standalone app. Clone the repository, run `npm ci`, then `npm run dev` with Node 22.13 or newer. The initial shader preset matches the selected Version 1; visitor-created versions remain local to each browser. The Sites hosting manifest is retained for that deployment option.

For the folding image boundary regression on macOS, run `node verification/boundary.test.mjs`. It uses the native GPU to check the actual shader at multiple angles and curve shapes; it does not require opening a browser.

Video samples are fetched into a bounded local blob before decoding, so playback does not depend on the host supporting HTTP byte-range responses. When browser policy requires a user gesture, a Play video button starts the existing decoder directly from its click handler. Superseded play requests and expected pause/dispose interruptions do not produce playback errors.

Bounded landscape videos, including the bundled sample, upload directly from the decoded video element into WebGL. Their 2D canvas is drawn once for the poster, not on every frame. Larger and portrait uploads retain the bounded/cropped canvas path. Texture updates are coalesced and applied before the shader draw; mipmaps rebuild only when the video supplies a new frame. The fold shader, blur taps, curves, and resolution are unchanged. A 30 fps source remains 30 fps footage while fold motion can render independently at display cadence; physical-device frame rates are not guaranteed.

Edge darkening displays a normalized 0–100% slider: the default 50% represents internal strength 1, and 100% represents strength 2. Existing saved values preserve their rendering strength under the new labels.

Animation duration defaults to 1.9 seconds; the Blur easing slider has been removed. The curve editor remains available, and saved shader versions retain their internal crease-easing value for compatibility. Right-screen darkness defaults to 50%.

If local saving fails, new media remains usable for the current visit with an explicit temporary-storage notice. Temporary items can still be shuffled, added to, and removed; refreshing drops only those unsaved items. Existing persisted records are not cleared. New database records store media bytes and MIME types, while older Blob records remain readable. Uploads still stay entirely on the device.

On phones, the folded demo starts larger and smoothly scales to fit its full open width. Horizontal drags can start anywhere on the free demo stage; pointer capture retains the gesture outside the phone, and horizontal intent stays locked despite vertical finger drift. The controls and gallery retain their own interactions.

The drag instruction text and arrow are hidden on phones; the fold teaser remains. Blocked video playback shows the decoded poster while the Play video button waits for a user gesture.

Video transport is desktop-only: quiet Play/Pause and 1×/0.5× text to the left of the phone, plus a small scrubber. Seeking refreshes the shader even while paused. Mobile attempts muted playback and retries blocked playback on the next demo gesture without extra transport controls. Older uploaded-video previews are regenerated once from their local originals and stored as JPEG previews; media bytes remain unchanged.

Desktop video controls use a vertical stack of Play/Pause icons, speed, and a one-pixel vertical scrubber. Watched content is dark grey; the remainder is light grey. The small thumb fades and grows with a 280 ms ease-in-out when the pointer is within 40 px (also visible for keyboard focus). Controls fade on media changes and as the projected fold approaches them; their collision bound uses the shader's camera, hinge, rotation and slab thickness. Mobile controls remain hidden.

Scrubbing pauses the video at the chosen frame; playback resumes only with Play. Transport icons use solid sharp-cornered triangle and bar shapes.

Transport collision fading is updated directly on every shader draw, including click animations, release settling and the teaser, without rendering the React tree at animation cadence. Media-selection fading remains separate. Controls disappear with 60 px of clearance; Play/Pause and speed sit below the scrub line.
