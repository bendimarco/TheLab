# Start the next Lab project

Lab is Ben's collection of interactive graphics experiments. Duo is project 001: a Swift/Metal folding-screen study ported to WebGL. Keep this repository as the web home for subsequent projects, with a separate directory and case study per experiment. This file is the compact handoff; the code and individual case studies hold the details.

## Read first

1. This file for shared lessons and scope.
2. `README.md` for running, deployment, media behavior, and app controls.
3. `Notes/001-DuoExpansion.md` for the rendering investigation. It is chronological: early numbers describe earlier versions, not current defaults.
4. `projects/001-duo-expansion/settings.ts` and `renderer.ts` for current values and behavior. Do not infer defaults from a visitor's local storage.

The native sibling is `../SwiftLab`, with its own README, AGENTS.md, per-project notes and `SwiftLab/Projects/001-DuoExpansion/`. Read its instructions before editing it. The web implementation evolved after the initial port; native/web parity must be checked, not assumed. Keep this handoff in version control rather than relying on the original chat being available.

## Product direction and working preferences

- Start from a visual reference and describe the intended geometry, image behavior, and motion before choosing an implementation.
- Prefer simple convincing effects. A broad soft metal highlight is better than several conspicuous reflection bands.
- Debug the underlying projection, boundaries, or sampling when an artifact recurs. Adding local masks repeatedly hid errors and created new seams in Duo.
- Expose meaningful live controls and saveable presets; remove ineffective controls. Capture approved values in source defaults.
- Make touch interaction generous, continuous, and interruptible. Use pointer capture, lock horizontal intent once recognized, and keep controls outside the drag target.
- Preserve media quality and originals. Never silently reduce frame rate or transcode uploaded files. Any export should be a separate asset with measured source/output dimensions, cadence, size, and visual comparison.
- Visitor media stays on their device. Public samples require an intentional selection.

## Reusable rendering lessons

### Separate the coordinate systems

Duo uses analytic ray/surface intersections for visibility while sampling its image through a virtual front-facing plane. Surface coordinates, image coordinates, logical pixels, and framebuffer pixels are distinct. Mixing these created stretched corners, wedge flares and hard cutoffs. Define one reference image boundary and derive blur/darkness distance from that same boundary, for both top and bottom.

### Separate spatial falloff from motion timing

A blur curve shapes distance from crease to free edge; animation easing shapes change over time or rotation. Applying strong easing everywhere made wide folds look flat. Duo blends spatial behavior with angle, then separately eases the onset near endpoints. Check closed, almost closed, edge-on, almost open and open in both directions. A matching endpoint screenshot does not validate the transition.

### Broad blur needs prefiltering

Widely spaced samples from a sharp texture clump into colored blocks. Use a mip chain with fractional LOD and a symmetric weighted kernel. In Duo, 25 precomputed Gaussian disk offsets and paired samples maintain a smooth boundary; the editable curve is inverted into a CPU lookup table rather than solved per fragment. Rebuild mips when media changes, not for every geometry-only frame.

### Video adds work that a still does not

A still uploads once. Video adds decoding, possible crop/copy, texture transfer and mip generation for each new frame. Schedule video updates with requestVideoFrameCallback when available, ignore duplicate frames, and coalesce uploads before drawing. Animate the fold independently at display cadence. Use direct video textures for bounded uncropped media; crop large or portrait media through a bounded canvas. Pause hidden/unneeded playback and release decoders, callbacks, textures and object URLs.

Retain a decoded poster until playback presents a frame. Call play directly from a user gesture when required. Distinguish autoplay policy rejection from decoding failure and ignore stale play promises after pause/disposal. A valid file extension does not guarantee browser codec support. Do not promise 60 fps without device measurements.

### Geometry and material are different fixes

Metal speckling at the corners required stable intersections and material classification, not a stronger highlight. Preserve geometric thickness while tuning visible bezel width. Use simple smooth shading after geometry is sound. Browser GLSL ES compilation is necessary: native compilation accepted numeric conversions that WebGL rejected.

### Resizing and storage are lifecycle problems

Changing a canvas backing size clears it; redraw immediately and skip unchanged dimensions. Avoid ResizeObserver feedback writes that resize the observed element. Preserve pose and resources while sheets animate.

Persist media bytes and MIME type with atomic IndexedDB writes; support legacy records. Prepare bytes before opening the transaction. A failed save can still allow clearly labeled temporary use for the visit without clearing existing media. Quota and browser failures remain possible; screenshots alone cannot establish their cause.

## Architecture for project 002 and beyond

Keep `projects/NNN-slug/` for each effect's renderer, shader, settings and media-specific logic, and `Notes/NNN-Name.md` for its case study. When adding the next project, introduce a small project catalog and stable routes such as `/projects/002-slug`; preserve Duo's existing URL or provide an explicit redirect. This is the next-step plan, not routing already implemented.

Extract shared controls, media storage, or animation utilities only when the second project needs them. Keep shader-specific geometry out of shared app code. Use `Notes/ProjectTemplate.md` to record the new experiment. Keep UI/layout decisions in README or app documentation, not the shader case study.

## Validation and limits

Run type checking, relevant tests and a production build. For Duo, `node verification/boundary.test.mjs` checks 128 native GPU boundary cases. It is not a full browser, metal-appearance or iPhone performance test. Validate interaction and appearance in the target browser and on a real phone where possible; record what was actually checked and what remains unverified.

Current baseline: Dog then video then Lake then Friend; mobile automatic rotation excludes video. Mobile uses a larger folded demo which fits down while opening, a bottom settings sheet and no drag text/arrow. Teaser motion remains. Default animation is 1.9 seconds. Current shader values live in settings.ts; edge darkness uses internal 1 by default, displayed as 50%, with internal 2 displayed as 100%.

## Prompt to start a new task

“Create the next project in Lab: [idea/reference]. Read Notes/START-HERE.md and the relevant project notes first. Preserve Duo. Target [Swift, web, or both]. Start by defining the visual behavior and coordinate model, then implement a small interactive prototype with meaningful controls. Validate the transitions and performance on [devices]. Document the final architecture, useful failed approaches, measurements, and remaining limitations in its own case study.”
