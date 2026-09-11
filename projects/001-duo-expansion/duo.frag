#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D blurProfile;

// Manual interpolation avoids requiring floating-point linear-filter extensions.
float spatialBlurCurve(float x) {
    float position = clamp(x, 0.0, 1.0) * 1024.0;
    int index = min(int(floor(position)), 1023);
    return mix(texelFetch(blurProfile, ivec2(index, 0), 0).r,
               texelFetch(blurProfile, ivec2(index + 1, 0), 0).r, position - float(index));
}

#define PI 3.14159265358979323846
float saturate(float x) { return clamp(x, 0.0, 1.0); }

struct DuoUniforms {
    vec4 geometry; // viewport width/height in points, panel height, progress
    vec4 media;    // upright media width/height, white transition amount, aligned front crop
    vec4 raster;   // drawable width/height for pixel-sized reconstruction
    vec4 uvX;     // upright UV -> encoded texture UV (video orientation)
    vec4 uvY;
    vec4 frontProjection; // enabled, perspective lock, blur radius (points), blur start
    vec4 frontEdge;       // blur exponent, dark amount, dark start, dark exponent
    vec4 frontCorner;     // dark amount, geometric reach, softness, onset (radians)
    vec4 frontBlur;       // diagonal blur radius (points), inside enabled, blur end shift, stationary screen darkness
    vec4 creaseBlur; // projected blend width / panel width, easing exponent, cubic handle 1 height, cubic handle 2 height
};
// A rectangle with rounding only at its free edge. The hinge edge stays straight.
float panelDistance(vec2 p, vec2 size, float radius) {
    float r = p.x > size.x * 0.5 ? radius : 0.0;
    vec2 q = abs(p - size * 0.5) - size * 0.5 + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 aspectFill(vec2 uv, vec2 viewport, vec2 image) {
    float s = max(viewport.x / image.x, viewport.y / image.y);
    return (uv - 0.5) * viewport / (image * s) + 0.5;
}

float edgeRamp(float x, float start, float exponent) {
    float ramp = saturate((x - start) / max(1.0 - start, 0.001));
    return pow(ramp, max(exponent, 0.1));
}

// Ease in projected image space so a tilted surface cannot compress the whole
// transition into a sharp strip beside the crease. Flat slopes at both ends.
float creaseBlurWeight(float distance, float panelWidth, float width, float curve) {
    if (width <= 0.0) return 1.0;
    float t = saturate(distance / max(panelWidth * width, 0.001));
    float eased = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    return pow(saturate(eased), clamp(curve, 1.0, 4.0));
}

vec2 encodedUV(vec2 uv, DuoUniforms u) {
    return vec2(dot(u.uvX.xy, uv) + u.uvX.z, dot(u.uvY.xy, uv) + u.uvY.z);
}

// The source is a flat photograph with a black surround. Blur this composite,
// rather than blurring the photo and then inventing a separate triangular shadow.
float pictureCoverage(float y, float height, float footprint) {
    return smoothstep(-footprint, footprint, y) *
           smoothstep(-footprint, footprint, height - y);
}
const vec2 BLUR_OFFSETS[25] = vec2[25](
    vec2(0.000000000, 0.000000000),
    vec2(0.110865760, 0.000000000),
    vec2(-0.110865760, -0.000000000),
    vec2(-0.144802176, 0.132650654),
    vec2(0.144802176, -0.132650654),
    vec2(0.022708480, -0.258751413),
    vec2(-0.022708480, 0.258751413),
    vec2(0.192010361, 0.250443514),
    vec2(-0.192010361, -0.250443514),
    vec2(-0.362793156, -0.064173001),
    vec2(0.362793156, 0.064173001),
    vec2(0.355044139, -0.225850019),
    vec2(-0.355044139, 0.225850019),
    vec2(-0.123225878, 0.458394126),
    vec2(0.123225878, -0.458394126),
    vec2(-0.245306258, -0.472322272),
    vec2(0.245306258, 0.472322272),
    vec2(0.560329439, 0.204631412),
    vec2(-0.560329439, -0.204631412),
    vec2(-0.622144493, 0.256812203),
    vec2(0.622144493, -0.256812203),
    vec2(0.328458145, -0.701895978),
    vec2(-0.328458145, 0.701895978),
    vec2(0.286722993, 0.914118084),
    vec2(-0.286722993, -0.914118084)
);

vec3 sampleFlatPicture(sampler2D photo, vec2 position, vec2 size,
                      float radius, float pixelSize, DuoUniforms u) {
    vec3 surround = vec3(0.012);
    float imageScale = max(size.x / u.media.x, size.y / u.media.y);
    float radiusInTexels = radius / imageScale;
    float pixelFootprint = max(pixelSize * 0.5, 0.0001);
    if (radiusInTexels < 0.25) {
        vec2 uv = aspectFill(clamp(position / size, 0.0, 1.0), size, u.media.xy);
        return mix(surround, textureLod(photo, encodedUV(uv, u), 0.0).rgb,
                   pictureCoverage(position.y, size.y, pixelFootprint));
    }
    // A finer mip footprint avoids magnifying large box-filtered mip texels.
    float lod = max(0.0, log2(max(radiusInTexels * 0.35, 1.0)));
    float footprint = max(pixelFootprint, radius * 0.35);
    vec3 sum = vec3(0.0);
    float total = 0.0;
    // Gaussian-distributed disk samples replace the visible square 5x5 lattice.
    // Opposite pairs keep coverage exactly symmetric at the picture boundary.
    // Fixed offsets avoid temporal noise, including when the source is video.
    for (int i = 0; i < 25; ++i) {
        vec2 offset = BLUR_OFFSETS[i];
        vec2 tap = position + offset * radius;
        vec2 uv = aspectFill(clamp(tap / size, 0.0, 1.0), size, u.media.xy);
        float coverage = pictureCoverage(tap.y, size.y, footprint);
        vec3 color = textureLod(photo, encodedUV(uv, u), lod).rgb;
        sum += mix(surround, color, coverage);
        total += 1.0;
    }
    return sum / total;
}

vec3 foldColor(vec2 p, float w, float h, float angle, bool inside,
                   sampler2D photo, DuoUniforms u) {
    float bezel = h * 0.034;
    vec2 viewport = vec2(w, h) - 2.0 * bezel;
    vec2 localUV = (p - vec2(inside ? 0.0 : bezel, bezel)) /
                     vec2(inside ? w - bezel : viewport.x, viewport.y);
    float x = saturate(localUV.x);
    float camera = h * 3.5;
    float thickness = h * 0.026;
    float c = cos(angle), s = sin(angle);
    float faceZ = inside ? 0.0 : thickness;
    float anchorX = inside ? 0.0 : bezel;
    float referenceZ = s * anchorX + c * faceZ;
    float z = s * p.x + c * faceZ;
    float hingeX = c * anchorX - s * faceZ;
    float worldX = c * p.x - s * faceZ;
    float flatScale = (camera - referenceZ) / (camera - z);

    // Sample a virtual front-facing picture anchored at the inner hinge. At the
    // hinge flatPoint == p exactly; horizontal image lines stay horizontal on screen.
    // The inside image extends left of the hinge, so its distance coordinate
    // reverses the projected world X. At 180 degrees this is exactly p.x again.
    float flatX = inside ? -worldX * flatScale : bezel + worldX * flatScale - hingeX;
    vec2 flatPoint = vec2(flatX,
                              (p.y - h * 0.5) * flatScale + h * 0.5);
    vec2 imagePoint = mix(p, flatPoint, saturate(u.frontProjection.y));
    vec2 imageViewport = inside ? vec2(2.0 * w - 2.0 * bezel, viewport.y) : viewport;
    vec2 imagePosition = inside ? vec2(w - imagePoint.x - bezel, imagePoint.y - bezel)
                                  : imagePoint - bezel;
    if (!inside && u.media.w > 0.5) {
        // Match the exact visible crop of the stationary right screen. The cover
        // has a hinge bezel; normalize its narrower aperture to that whole crop.
        float rightWidth = w - bezel;
        imagePosition.x = rightWidth + (imagePoint.x - bezel) / viewport.x * rightWidth;
        imageViewport.x = 2.0 * rightWidth;
    }
    float onset = clamp(u.frontCorner.w, 0.0, PI / 3.0);
    // Front: build toward edge-on. Inside: unwind that envelope toward flat.
    float treatmentAngle = inside ? PI - angle : angle;
    float turn = smoothstep(onset, PI * 0.5, treatmentAngle);
    // Move the clear boundary beyond the hinge as foreshortening compresses
    // the panel. Shift both masks so neither can pin a sharp strip to the edge.
    float tilt = sin(angle);
    float endShift = saturate(u.frontBlur.z) * tilt * tilt * tilt * tilt;
    // Shape the spatial ramp before moving its clear boundary. Compressing the
    // ramp preserves a gradient all the way to the free edge (no clamped plateau).
    // A broad face needs a gradual, visible blur rather than an extreme easing.
    // Introduce the editable crease-protecting curve as its projected width shrinks.
    // abs(c) treats the cover and inside symmetrically around the edge-on pose.
    float narrowness = 1.0 - abs(c);
    float curveInfluence = smoothstep(0.15, 0.85, narrowness);
    float curvedX = mix(x, spatialBlurCurve(x), curveInfluence);
    float blurX = mix(curvedX, 1.0, endShift);
    float panelWidth = inside ? w - bezel : viewport.x;
    float creaseWeight = creaseBlurWeight(abs(flatX - anchorX) + endShift * panelWidth,
        panelWidth, u.creaseBlur.x, u.creaseBlur.y);
    // Both blur treatments use the same effective hinge-to-edge falloff.
    // Using raw blurX for the diagonals made them much stronger near the crease.
    float spatialWeight = edgeRamp(blurX, u.frontProjection.w, u.frontEdge.x);
    float blur = max(0.0, u.frontProjection.z) * turn * creaseWeight * spatialWeight;
    float dark = saturate(max(0.0, u.frontEdge.y) * turn *
                 edgeRamp(x, u.frontEdge.z, u.frontEdge.w));
    // The image rectangle itself defines the top and bottom boundaries.
    // No independently derived triangle depth or shadow opacity is needed.
    float pictureEdgeDistance = min(imagePosition.y, imageViewport.y - imagePosition.y);
    // Ramp the early corner treatment over the first ~29 degrees, not 1.5
    // projected pixels. The old pixel threshold reached 30% almost instantly.
    // This starts with zero slope at either flat endpoint and blends smoothly
    // into the full fold treatment without a max() crossover.
    float cornerOnset = smoothstep(0.0, 0.5, treatmentAngle);
    float diagonalTurn = turn + 0.3 * cornerOnset * (1.0 - turn);
    // A second blur grows toward the two wedges, as well as toward the free edge
    // and with rotation. Its band extends inward from the geometric wedge boundary.
    float blurHingeProtection = smoothstep(0.0, 0.025, blurX);
    float diagonalRadius = u.frontCorner.y > 0.0
        ? max(0.0, u.frontBlur.x) * diagonalTurn * spatialWeight * blurHingeProtection * creaseWeight : 0.0;
    // Use a symmetric distance field: the same kernel on either side of the
    // image boundary prevents the footprint from changing when crossing it.
    float distanceToImageEdge = abs(pictureEdgeDistance);
    float diagonalMask = 1.0 - smoothstep(0.0, max(1.0, diagonalRadius * 3.0), distanceToImageEdge);
    // The editable curve already shapes diagonalRadius from hinge to free edge.
    // Applying it again across this band collapses the feather with steep curves,
    // leaving a hard black/photo boundary. Keep this symmetric feather smooth.
    float diagonalBlur = diagonalRadius * diagonalMask;
    // Combine blur widths in quadrature, using one gather instead of two passes.
    float combinedBlur = sqrt(blur * blur + diagonalBlur * diagonalBlur);
    float imagePixel = u.geometry.y / max(u.raster.y, 1.0) *
                       (camera - referenceZ) / camera;
    vec3 color = sampleFlatPicture(photo, imagePosition, imageViewport,
                                  combinedBlur, imagePixel, u);
    return color * (1.0 - dark);
}

// Estimate the covered fraction from the projected free edge of both slab faces.
// The fixed screen is fully revealed at edge-on, rather than at the end of the fold.
float rightRevealShade(float angle, float w, float h, float strength) {
    if (angle >= PI * 0.5) return 1.0;
    float camera = h * 3.5, thickness = h * 0.026;
    float c = cos(angle), s = sin(angle);
    float insideEdge = c * w * camera / (camera - s * w);
    float frontEdge = (c * w - s * thickness) * camera / (camera - s * w - c * thickness);
    float covered = saturate(max(insideEdge, frontEdge) / w);
    // The stationary glass needs only a faint occlusion cue. Clear it earlier,
    // once 65% is revealed, with gentle slopes at first exposure and completion.
    float revealed = saturate((1.0 - covered) / 0.65);
    float clearAmount = revealed * revealed * revealed *
        (revealed * (revealed * 6.0 - 15.0) + 10.0);
    return 1.0 - saturate(strength) * (1.0 - saturate(clearAmount));
}

// Hardware detail follows the physical front glass, independently of photo
// projection, blur, and white transitions. The inside face has no camera cutout.
vec3 frontCamera(vec3 color, vec2 p, float w, float h, bool cover) {
    if (!cover) return color;
    float distance = length(p - vec2(w - h * 0.08, h * 0.08));
    float radius = h * 0.023;
    float feather = h * 0.0015;
    float mask = 1.0 - smoothstep(radius - feather, radius + feather, distance);
    return mix(color, vec3(0.004, 0.005, 0.008), mask);
}

vec3 panelColor(vec2 p, float w, float h, bool cover, bool left,
                  float angle, sampler2D photo, DuoUniforms u) {
    
    float bezel = h * 0.034;
    float edge = min(min(p.y, h - p.y), w - p.x);
    // The closed cover has a slim hinge border. The interior halves meet seamlessly.
    if (cover) edge = min(edge, p.x);
    float roundedEdge = -panelDistance(p, vec2(w, h), h * 0.07);
    if (p.x > w * 0.5) edge = min(edge, roundedEdge);
    if (edge < h * 0.004) {
        float metal = 0.70 + 0.12 * cos((p.x + p.y) / h * 5.0);
        return vec3(metal);
    }
    if (edge < bezel) return vec3(0.012);

    if ((cover && u.frontProjection.x > 0.5) || (!cover && left && u.frontBlur.y > 0.5)) {
        vec3 color = foldColor(p, w, h, angle, !cover, photo, u);
        return frontCamera(mix(color, vec3(1.0), saturate(u.media.z)), p, w, h, cover);
    }

    vec2 uv;
    if (cover) {
        // The closed front screen uses its own centered aspect-fill crop.
        uv = aspectFill((p - bezel) / vec2(w - 2.0*bezel, h - 2.0*bezel),
                        vec2(w - 2.0*bezel, h - 2.0*bezel), u.media.xy);
    } else {
        float imageX = left ? w - p.x : w + p.x;
        uv = aspectFill(vec2((imageX - bezel) / (2.0*w - 2.0*bezel),
                               (p.y - bezel) / (h - 2.0*bezel)),
                        vec2(2.0*w - 2.0*bezel, h - 2.0*bezel), u.media.xy);
    }
    uv = vec2(dot(u.uvX.xy, uv) + u.uvX.z, dot(u.uvY.xy, uv) + u.uvY.z);
    vec3 color = textureLod(photo, uv, 0.0).rgb;
    // Retain the old inside lighting only for snapshots predating the inside effect.
    float shade = left ? 1.0 - 0.23 * sin(angle) : 1.0;
    if (!cover && !left) shade = rightRevealShade(angle, w, h, u.frontBlur.w);
    color *= shade;
    return frontCamera(mix(color, vec3(1.0), clamp(u.media.z, 0.0, 1.0)), p, w, h, cover);
}

// Analytic entry bounds for the extruded panel: six planes plus two rounded
// outer-corner cylinders. The curved depth profile is refined inside this bound.
struct LeafHit { float t; vec3 p; vec3 normal; };

void considerHit(inout LeafHit hit, float t, vec3 p, vec3 normal,
                 float w, float h, float thickness, vec3 ray) {
    if (dot(normal, ray) >= 0.0) return; // Only entry surfaces can occlude the image.
    float tolerance = h * 0.00001;
    if (t > 0.0 && t < hit.t && p.z >= -tolerance && p.z <= thickness + tolerance &&
        panelDistance(p.xy, vec2(w, h), h * 0.07) <= tolerance) {
        hit = LeafHit(t, p, normal);
    }
}

LeafHit intersectLeaf(vec3 origin, vec3 ray, float w, float h,
                      float thickness, float c, float s) {
    vec3 o = vec3(c * origin.x + s * origin.z, origin.y + h * 0.5,
                     -s * origin.x + c * origin.z);
    vec3 d = vec3(c * ray.x + s * ray.z, ray.y, -s * ray.x + c * ray.z);
    LeafHit hit = LeafHit(1e8, vec3(0.0), vec3(0.0));
    vec3 bounds = vec3(w, h, thickness);
    for (int axis = 0; axis < 3; ++axis) {
        if (abs(d[axis]) < 0.00001) continue;
        for (int side = 0; side < 2; ++side) {
            float t = (float(side) * bounds[axis] - o[axis]) / d[axis];
            vec3 n = vec3(0.0);
            n[axis] = side == 0 ? -1.0 : 1.0;
            considerHit(hit, t, o + t * d, n, w, h, thickness, d);
        }
    }
    float radius = h * 0.07;
    float a = dot(d.xy, d.xy);
    if (a > 0.00001) {
        for (int corner = 0; corner < 2; ++corner) {
            vec2 center = vec2(w - radius, corner == 0 ? radius : h - radius);
            vec2 relative = o.xy - center;
            float b = dot(relative, d.xy);
            // Closest-approach form avoids subtracting two huge squared terms.
            // That cancellation made grazing corner rays jump to the back face.
            vec2 closest = relative - (b / a) * d.xy;
            float chordSquared = radius * radius - dot(closest, closest);
            if (chordSquared < 0.0) continue;
            for (int root = 0; root < 2; ++root) {
                float t = -b / a + (root == 0 ? -1.0 : 1.0) * sqrt(chordSquared / a);
                vec3 p = o + t * d;
                if (p.x < center.x || (corner == 0 ? p.y > center.y : p.y < center.y)) continue;
                considerHit(hit, t, p, vec3((p.xy - center) / radius, 0.0), w, h, thickness, d);
            }
        }
    }
    return hit;
}

// Round the glass-to-metal lips through the slab's depth. Keep the hinge cut
// flat so the two inner screens can still meet without a rounded gap at full opening.
float roundedLeafDistance(vec3 p, float w, float h, float thickness) {
    float bevel = thickness * 0.42;
    float edge = panelDistance(p.xy - vec2(0.0, bevel),
                               vec2(w - bevel, h - 2.0*bevel), h * 0.07 - bevel);
    float depth = abs(p.z - thickness * 0.5) - (thickness * 0.5 - bevel);
    vec2 d = vec2(edge, depth);
    float rounded = min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - bevel;
    return max(rounded, -p.x);
}

LeafHit roundLeafHit(LeafHit boundary, vec3 origin, vec3 ray, float w,
                     float h, float thickness, float c, float s) {
    if (boundary.t > 1e7) return boundary;
    vec3 o = vec3(c * origin.x + s * origin.z, origin.y + h * 0.5,
                     -s * origin.x + c * origin.z);
    vec3 d = vec3(c * ray.x + s * ray.z, ray.y, -s * ray.x + c * ray.z);
    float rayLength = length(d);
    float epsilon = h * 0.00005;
    float t = boundary.t;
    // The analytic solid gives an exact entry bound. Flat screen pixels converge
    // immediately; only the narrow beveled rim needs additional distance steps.
    for (int step = 0; step < 48; ++step) {
        vec3 p = o + t * d;
        if (any(lessThan(p, vec3(-epsilon))) || any(greaterThan(p, vec3(w, h, thickness) + epsilon))) break;
        float distance = roundedLeafDistance(p, w, h, thickness);
        if (distance < epsilon) {
            vec3 ex = vec3(epsilon, 0.0, 0.0), ey = vec3(0.0, epsilon, 0.0), ez = vec3(0.0, 0.0, epsilon);
            vec3 gradient = vec3(
                roundedLeafDistance(p + ex, w, h, thickness) - roundedLeafDistance(p - ex, w, h, thickness),
                roundedLeafDistance(p + ey, w, h, thickness) - roundedLeafDistance(p - ey, w, h, thickness),
                roundedLeafDistance(p + ez, w, h, thickness) - roundedLeafDistance(p - ez, w, h, thickness));
            vec3 normal = dot(gradient, gradient) > 1e-12 ? normalize(gradient) : boundary.normal;
            return LeafHit(t, p, normal);
        }
        t += max(distance, epsilon) / rayLength;
    }
    // At grazing corners, finite refinement can miss the rounded surface.
    // Keep the analytic silver shell instead of exposing the black screen behind.
    // Mid-depth marks this fallback as metal, never planar glass.
    return LeafHit(boundary.t, vec3(boundary.p.xy, thickness * 0.5), boundary.normal);
}

// Materials follow the planar glass footprint, never a near-flat normal test.
// Even a shallow part of a rounded corner is metal once it lies outside this inset.
bool isGlassFace(LeafHit hit, float w, float h, float thickness) {
    float bevel = thickness * 0.42;
    float planeDistance = min(abs(hit.p.z), abs(hit.p.z - thickness));
    if (planeDistance > h * 0.0001) return false;
    // A small silver overlap hides numerical glass/bezel speckles at the lip.
    // Clamp only the hinge coordinate so this guard never paints the open seam.
    float silverOverlap = h * 0.002;
    vec2 point = vec2(max(silverOverlap, hit.p.x), hit.p.y) - vec2(0.0, bevel);
    float footprint = panelDistance(point, vec2(w - bevel, h - 2.0 * bevel), h * 0.07 - bevel);
    return hit.p.x >= -h * 0.00001 && footprint <= -silverOverlap + h * 0.000001;
}

vec3 rimColor(LeafHit hit, float thickness, float c, float s) {
    vec3 normal = vec3(c * hit.normal.x - s * hit.normal.z, hit.normal.y,
                          s * hit.normal.x + c * hit.normal.z);
    vec3 lightDirection = normalize(vec3(-0.4, -0.6, 1.0));
    float light = max(0.0, dot(normal, lightDirection));
    vec3 halfVector = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
    float reflectedLight = max(0.0, dot(normal, halfVector));
    float broadReflection = pow(reflectedLight, 18.0);
    float highlight = pow(reflectedLight, 110.0);
    float grazing = pow(1.0 - abs(normal.z), 3.0);
    // Polished silver: a broad reflection under a brighter, narrower highlight.
    // Keep the ambient floor bright so shadowed corners never turn black.
    float metal = min(1.0, 0.57 + 0.16 * light + 0.12 * broadReflection +
                           0.42 * highlight + 0.10 * grazing);
    return vec3(metal * 0.98, metal * 0.995, metal);

}

// Alpha carries a surface category for edge detection, not display opacity.
vec4 shadeDuo(vec2 uv, DuoUniforms u, sampler2D photo) {
    float h = u.geometry.z;
    float w = h * 0.72;
    float thickness = h * 0.026;
    float camera = h * 3.5;
    float angle = clamp(u.geometry.w, 0.0, 1.0) * PI;
    float c = cos(angle), s = sin(angle);
    float progress = clamp(u.geometry.w, 0.0, 1.0);
    // Translate the assembly as it unfolds: center the one-panel cover at 0,
    // and the two-panel spread at 1. Local hinge geometry remains unchanged.
    float centering = progress * progress * (3.0 - 2.0 * progress);
    float hingeX = -w * 0.5 * camera / (camera - thickness) * (1.0 - centering);
    vec2 screen = (uv - 0.5) * u.geometry.xy - vec2(hingeX, 0.0);
    vec3 origin = vec3(0.0, 0.0, camera);
    vec3 ray = vec3(screen, -camera);
    vec3 color = vec3(0.96);
    float surface = 0.0; // background=0, screen/bezel=1, metal=2

    // Reuse the same rounded solid and silver material for the stationary half.
    // Its body extends behind z=0, keeping the two inner screens coplanar when open.
    vec3 fixedOrigin = origin + vec3(0.0, 0.0, thickness);
    LeafHit fixedBoundary = intersectLeaf(fixedOrigin, ray, w, h, thickness, 1.0, 0.0);
    LeafHit fixedHit = roundLeafHit(fixedBoundary, fixedOrigin, ray, w, h, thickness, 1.0, 0.0);
    if (fixedHit.t < 1e7) {
        surface = isGlassFace(fixedHit, w, h, thickness) ? 1.0 : 2.0;
        color = isGlassFace(fixedHit, w, h, thickness)
            ? panelColor(fixedHit.p.xy, w, h, false, false, angle, photo, u)
            : rimColor(fixedHit, thickness, 1.0, 0.0);
    }

    // Inner face is at local z=0; the front glass is at z=thickness. The inner
    // face meets the stationary screen at full opening, while the edge stays visible at 90°.
    LeafHit boundary = intersectLeaf(origin, ray, w, h, thickness, c, s);
    LeafHit hit = roundLeafHit(boundary, origin, ray, w, h, thickness, c, s);
    if (hit.t < 1e7 && hit.t <= fixedHit.t + 0.00001) {
        if (isGlassFace(hit, w, h, thickness)) {
            surface = 1.0;
            bool cover = hit.p.z > thickness * 0.5;
            color = panelColor(hit.p.xy, w, h, cover, !cover, angle, photo, u);
        } else {
            surface = 2.0;
            color = rimColor(hit, thickness, c, s);
        }
    }
    return vec4(color, surface);
}

uniform DuoUniforms u;
uniform sampler2D photo;
in vec2 vUV;
out vec4 fragColor;
void main() {
    vec4 center = shadeDuo(vUV, u, photo);
    vec2 dx = dFdx(vUV), dy = dFdy(vUV);
    float boundary = fwidth(center.a);
    // Ray-traced silhouettes cannot benefit from ordinary triangle MSAA. Resolve
    // four subpixel rays around metal and material transitions instead. Derivatives
    // give the real drawable-pixel footprint at any display scale or orientation.
    if (center.a > 1.5 || boundary > 0.5) {
        vec3 color = shadeDuo(vUV - 0.25 * dx - 0.25 * dy, u, photo).rgb;
        color += shadeDuo(vUV + 0.25 * dx - 0.25 * dy, u, photo).rgb;
        color += shadeDuo(vUV - 0.25 * dx + 0.25 * dy, u, photo).rgb;
        color += shadeDuo(vUV + 0.25 * dx + 0.25 * dy, u, photo).rgb;
        fragColor = vec4(color * 0.25, 1.0);
        return;
    }
    fragColor = vec4(center.rgb, 1.0);
}
