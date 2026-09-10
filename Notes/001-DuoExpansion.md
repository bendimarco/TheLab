# Duo expansion — WebGL port

Duo folds a narrow screen outward around its left edge to reveal a screen twice as wide. The assembly shifts horizontally as it opens so the closed and fully open poses are both centered. The turning panel is a solid with rounded silver edges, a black bezel, and a front camera cutout.

The key illusion is that the frame rotates in perspective while the photograph behaves like a flat image seen through a rotating window. Progressive blur, diagonal dark wedges, and angle-dependent blur reconcile those two conflicting depth cues.

## Starting point

This ports the current `DuoMedia.metal` implementation from SwiftLab after the rollback of the later edge-spreading blur, residual blur, fold-darkness and motion-smear additions. It retains the original projected crease easing and now adds a tilt-dependent blur-end shift. Those reverted effects are deliberately absent.

The web shader preserves the Swift defaults: 36-point progressive blur, 16-point diagonal blur, 45% crease blend width, easing exponent 1.5, 58% edge darkening, and a fixed 24% blur-end shift. Web blur distances are expressed in CSS pixels, the logical-coordinate counterpart to SwiftUI points. Matching logical viewport and panel dimensions gives the closest comparison.

## Rendering architecture

`duo.frag` is a direct Metal-to-GLSL ES 3.00 translation. `renderer.ts` draws one full-screen triangle into a WebGL 2 canvas. Each fragment casts a ray against the two panels; no DOM transforms or perspective image elements approximate the fold.

A mesh renderer with Three.js would be a reasonable alternative for a larger 3D scene. Here, the Metal implementation already solved visibility, bevels, image projection, and sampling analytically. Retaining that math avoids introducing a second geometry representation and makes the two implementations easier to compare. The tradeoff is that procedural geometry consumes fragment work, especially around the rounded rim.

The nine Metal `float4` uniform groups become GLSL `vec4` members on a uniform struct. GLSL ES requires explicit floating-point operands: expressions such as `2 * bezel` must become `2.0 * bezel`. The desktop GLSL compiler accepted the original numeric conversions, but the actual WebGL compiler rejected them. Checking the browser compiler therefore caught a portability issue that the native compile check could not. Video-orientation matrices are identity in this image-only port: the browser decodes orientation before the texture is created. Changes to the five exposed shader values alter uniforms without recompiling the program.

## Hinge geometry and centering

Panel width is `0.72 × height`, thickness is `0.026 × height`, and the camera sits `3.5 × height` from the image plane. The moving panel rotates through `π × progress` radians. The stationary panel extends behind its glass plane; the moving inside face meets it at full opening.

For each panel, `intersectLeaf` transforms a ray into panel-local coordinates, then intersects the slab's planes and the cylinders describing the free corners. This gives a tight entry bound. `roundLeafHit` refines that hit against a rounded signed-distance function, using at most 48 steps. Flat screen pixels converge immediately; the expensive refinement stays near the curved metal lip.

The nearest hit chooses the visible material. `isGlassFace` uses distance to the planar face and its inset footprint rather than a nearly-flat-normal test. A small silver guard band hides numerical material speckles without painting the open hinge seam. The rim's brightness floor also prevents shaded metal corners from becoming black.

Centering uses `p²(3 − 2p)` to interpolate the hinge's horizontal translation. Panel height stays constant throughout a fold, avoiding an apparent scale pulse. This translation changes the assembly's position, not its hinge mechanics.

## Keeping the photograph flat

Physical surface coordinates and image-sampling coordinates serve different purposes. The surface intersection determines which fragment is visible. The source photo is sampled using a virtual front-facing plane anchored at the hinge.

`foldColor` computes the point's world depth and a perspective scale `(camera − referenceDepth) / (camera − pointDepth)`. It uses that scale to undo the image tilt. The inside face reverses its horizontal coordinate because its image extends leftward from the hinge. At full opening, the two inside faces sample contiguous halves of one aspect-filled image. The front face uses its own centered crop.

This is an intentional perceptual construction rather than a physically accurate display. Horizontal features remain horizontal even when the bezel becomes diagonal. Dark wedges at the top and bottom mask the mismatch between the rotating surface and the stationary image plane.

## Blur that does not clump

A sparse kernel sampling widely separated sharp texels can produce repeated blobs at large radii. The Swift implementation solved this with mip prefiltering; the web port retains it.

Image loading creates a complete mip chain once. The shader chooses a fractional LOD from the requested blur radius in source texels, then gathers 25 weighted samples in a 5 × 5 neighborhood. Trilinear filtering blends adjacent mip levels as the radius changes. Neighboring taps therefore average prefiltered regions rather than isolated details.

This is a practical, bounded approximation to a broad Gaussian, not a mathematically exact Gaussian convolution. It costs one gather per affected surface fragment and no frame-by-frame offscreen blur passes. Mip generation is paid only when the image changes.

Progressive blur grows with distance from the hinge and the panel's treatment angle. The inside face uses the inverted angular envelope: its treatment relaxes as it opens. The diagonal blur grows near the two geometric wedges. Their radii combine in quadrature, `sqrt(main² + diagonal²)`, so one gather implements both. The wedge opacity is feathered as well; blurring only the photograph would leave the black mask visibly sharp.

## Easing into the crease

A tilted panel compresses distances in screen space. If blur is eased only in panel-local coordinates, its transition can collapse into a narrow, visible strip next to the hinge.

`creaseBlurWeight` instead measures distance in projected image space and divides it by the chosen blend width. A quintic smoothstep, `t³(6t² − 15t + 10)`, gives zero slope at both ends. Raising this result to the easing exponent delays the buildup while retaining continuous endpoints.

Increasing blend width spreads the transition over more of the projected picture. Increasing the exponent keeps that region sharper longer before the blur grows. At the hinge, the treatment stays anchored and clear.

## Darkness and the fixed screen

The turning face's darkening follows the same local progression as the blur, with a separate onset and exponent inherited from Swift. The fixed right screen shares the exposed edge-darkness strength.

`rightRevealShade` estimates coverage using the projected free edges of both faces of the thick slab. As coverage decreases, a quintic curve clears the stationary screen's dark overlay monotonically. There is no extra pulse or mid-animation darkness peak. The shading is fully clear when that screen is fully revealed at edge-on.

## Shifting the blur boundary when nearly edge-on

The original sharp hinge can dominate the image as foreshortening compresses the whole visible face. `blurEndShift` moves the clear end of the gradient past that hinge by `amount × sin⁴(angle)`, in panel-width units. The quartic angular envelope starts gently, becomes strongest near edge-on, and returns to zero at both flat endpoints.

Both factors that previously protected the hinge must move. The projected crease distance gains `shift × panelWidth`; the local blur ramp uses `clamp(x + shift)` instead of `x`. The diagonal blur uses the shifted coordinate as well. Merely increasing radius, or moving only one of the two masks, would leave an unblurred strip.

The shift amount is fixed at 0.24. Saved versions cannot override it. Maximum blur remains bounded by the existing blur radii, and no additional texture samples are needed. The dark-gradient and wedge-opacity coordinates are unchanged. WebGL and Metal use the same formula and uniform slot.

The glass-reflection coating has been removed. Old versions ignore both their reflection and end-shift values; the renderer always supplies a 0.24 shift. The polished rim still uses its rounded normal, bright ambient floor, broad and narrow highlights, and grazing response. Keeping the metal lighting preserves the hardware cue without overlaying reflections on the photo.

## Edge sampling and resource costs

A full-screen triangle's ordinary MSAA cannot resolve silhouettes constructed inside its fragment shader. The shader tags each ray result as background, screen or metal. Around metal and material transitions it averages four subpixel rays, using screen-space derivatives for the correct footprint.

Images are limited to a 2048-pixel longest edge before GPU upload. A 2048-square RGBA texture and its mip chain require roughly 21.3 MiB, excluding browser decode buffers. Only the current GPU texture is retained; the selected source files remain local. Changing images regenerates the texture's mip chain.

The render loop draws on changes and during active animations rather than continuously while idle. Drawable resolution is capped at twice CSS resolution and approximately 1.8 million pixels. This bounds fill cost on dense displays, with some loss of fine rim detail at large viewport sizes. Hidden pages stop fold animation; reduced-motion preferences bypass automatic transitions.

The shader's ray refinement, edge supersampling and 25-tap gather still need real-device profiling. A fixed sample count and resolution cap are cost controls, not proof of a particular frame rate.

## Verification and limits

The translated fragment shader passed compilation on the Mac's native OpenGL driver after changing the GLSL version declaration and removing ES precision declarations. A subsequent in-app WebGL 2 startup check found the stricter numeric-conversion requirements described above. After correction, the browser compiled and linked the shader and accepted pose and parameter changes. These checks do not prove identical output on all WebGL drivers.

Type checking, production compilation, and focused archive/easing tests are part of the web verification. Browser interaction QA and side-by-side pixel comparison against the Metal output have not yet been performed. In particular, browser image decoding and color management can differ from the original Metal texture-loading path.

A useful next comparison is to feed both implementations the same horizontal grid, viewport size, panel height, and parameters, then inspect closed, 45°, edge-on, 135°, and open poses. Keep projection alignment, crease continuity, material boundaries and large-radius blur separate when diagnosing differences.

## Reading path

Start with `settings.ts` for the current editable values, then `renderer.ts` for resource lifetime and uniform mapping. In `duo.frag`, read `shadeDuo` and `panelColor` first. Follow with `foldColor`, `creaseBlurWeight`, and `sampleFront`. Read the slab-intersection and bevel functions last; they provide the geometry underlying those visual treatments.
