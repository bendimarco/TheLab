// Offscreen macOS GPU test of the production foldColor path.
// This checks rendered coverage, not a second implementation of the shader mask.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'darwin') {
  console.log('GPU boundary check requires macOS OpenGL.');
  process.exit(0);
}
const dir = await mkdtemp(join(tmpdir(), 'lab-boundary-'));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
}
try {
  let source = await readFile(
    new URL('../projects/001-duo-expansion/duo.frag', import.meta.url),
    'utf8',
  );
  source = source
    .replace('#version 300 es', '#version 330 core')
    .replace('precision highp float;', '')
    .replace('precision highp int;', '')
    .replaceAll('highp ', '');
  // Map test rows through the inverse camera projection onto each glass face.
  // The center row must stay half picture / half black across every column.
  source =
    source.slice(0, source.indexOf('void main() {')) +
    `
uniform vec4 testPose;
void main() {
  float h=500.0, w=h*.72, bezel=h*.028, camera=h*3.5;
  float angle=testPose.y; bool inside=testPose.x>.5;
  float anchor=inside?0.0:bezel, faceZ=inside?0.0:h*.034;
  float px=mix(anchor,w-bezel,vUV.x);
  float ref=sin(angle)*anchor+cos(angle)*faceZ;
  float z=sin(angle)*px+cos(angle)*faceZ;
  float scale=(camera-ref)/(camera-z);
  float distance=(vUV.y-.5)*100.0;
  float flatY=testPose.z>.5?h-bezel-distance:bezel+distance;
  float py=h*.5+(flatY-h*.5)/scale;
  fragColor=vec4(foldColor(vec2(px,py),w,h,angle,inside,photo,u),1.0);
}
`;
  const shader = join(dir, 'boundary.frag');
  const binary = join(dir, 'render-boundary');
  await writeFile(shader, source);
  run('clang', [
    '-Wno-deprecated-declarations',
    fileURLToPath(new URL('./render-boundary.c', import.meta.url)),
    '-framework',
    'OpenGL',
    '-o',
    binary,
  ]);
  run(binary, [shader, 'test']);
} finally {
  await rm(dir, { recursive: true, force: true });
}
