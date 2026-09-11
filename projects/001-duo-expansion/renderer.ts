import { settledProgress, demoHeight } from './interaction';
import fragment from './duo.frag?raw';
import {
  blurCurveTable,
  blurCurve,
  clamp,
  defaults,
  ease,
  type Settings,
} from './settings';

const vertex = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * vec2(2, -2) + vec2(-1, 1), 0, 1);
  vUV = p;
}`;

export class DuoRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private curveTexture: WebGLTexture;
  private curveKey = '';
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private frame = 0;
  private animation?: {
    from: number;
    to: number;
    start: number;
    duration: number;
    velocity?: number;
    done?: () => void;
  };
  private disposed = false;
  private mobile = false;
  private width = 1;
  private height = 1;
  private mediaSize = [1, 1];
  private pendingImage: HTMLCanvasElement | HTMLVideoElement | null = null;
  progress = 0;
  onDraw?: (progress: number) => void;
  white = 0;
  settings: Settings = { ...defaults };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl)
      throw new Error(
        'WebGL 2 is unavailable. Enable hardware acceleration or try a recent Safari or Chrome.',
      );
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Could not compile the fold shader: ${log}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(
        gl.getProgramInfoLog(this.program) || 'Shader link failed.',
      );
    gl.useProgram(this.program);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([230, 230, 230, 255]),
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(gl.getUniformLocation(this.program, 'photo'), 0);
    this.curveTexture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this.program, 'blurProfile'), 1);
    gl.activeTexture(gl.TEXTURE0);
  }

  setImage(source: HTMLCanvasElement | HTMLVideoElement) {
    // Coalesce decoded frames and upload immediately before the next shader draw.
    // DOM texture uploads can flush the GPU pipeline; avoid doing them mid-frame.
    this.pendingImage = source;
    this.requestDraw();
  }

  private uploadImage(source: HTMLCanvasElement | HTMLVideoElement) {
    const width = 'videoWidth' in source ? source.videoWidth : source.width;
    const height = 'videoHeight' in source ? source.videoHeight : source.height;
    if (!width || !height) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (width === this.mediaSize[0] && height === this.mediaSize[1])
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
    gl.generateMipmap(gl.TEXTURE_2D);
    this.mediaSize = [width, height];
  }

  resize(width: number, height: number) {
    this.mobile =
      window.innerWidth <= 600 ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches &&
        window.innerHeight <= 600);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // Limit fill cost on Retina screens; logical coordinates keep blur in CSS px.
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(1800000 / (this.width * this.height)),
    );
    const pixelWidth = Math.round(this.width * ratio);
    const pixelHeight = Math.round(this.height * ratio);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    // ResizeObserver runs before paint, after RAF. Redraw in this same callback:
    // scheduling another RAF would expose the cleared opaque buffer as black.
    cancelAnimationFrame(this.frame);
    this.draw(performance.now());
  }

  setProgress(value: number) {
    this.animation = undefined;
    this.progress = clamp(value);
    this.requestDraw();
  }
  animate(to: number, seconds: number, done?: () => void) {
    this.animation = undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setProgress(to);
      done?.();
      return;
    }
    this.animation = {
      from: this.progress,
      to: clamp(to),
      start: performance.now(),
      duration: seconds * 1000,
      done,
    };
    this.requestDraw();
  }
  settle(to: number, velocity: number, done?: () => void) {
    this.animate(to, 0.85, done);
    if (this.animation)
      this.animation.velocity = Math.max(-2, Math.min(2, velocity));
  }
  stop() {
    this.animation = undefined;
  }
  requestDraw() {
    if (this.disposed || this.frame || document.hidden) return;
    this.frame = requestAnimationFrame(this.draw);
  }
  private draw = (now: number) => {
    this.frame = 0;
    if (this.disposed || document.hidden) return;
    const animation = this.animation;
    if (animation) {
      const t = clamp((now - animation.start) / animation.duration);
      this.progress =
        animation.velocity === undefined
          ? animation.from + (animation.to - animation.from) * ease(t)
          : settledProgress(
              animation.from,
              animation.to,
              animation.velocity,
              (now - animation.start) / 1000,
            );
      if (t >= 1) {
        this.animation = undefined;
        animation.done?.();
      }
    }
    this.onDraw?.(this.progress);
    if (this.pendingImage) {
      this.uploadImage(this.pendingImage);
      this.pendingImage = null;
    }
    const gl = this.gl,
      s = this.settings;
    gl.useProgram(this.program);
    const uniform = (name: string, values: number[]) => {
      if (!this.uniforms.has(name))
        this.uniforms.set(
          name,
          gl.getUniformLocation(this.program, `u.${name}`),
        );
      gl.uniform4fv(this.uniforms.get(name)!, values);
    };
    const h = demoHeight(this.width, this.height, this.progress, this.mobile);
    uniform('geometry', [this.width, this.height, h, this.progress]);
    uniform('media', [...this.mediaSize, this.white, s.closedImageAligned]);
    uniform('raster', [this.canvas.width, this.canvas.height, 0, 0]);
    uniform('uvX', [1, 0, 0, 0]);
    uniform('uvY', [0, 1, 0, 0]);
    const zoomTime = clamp((this.progress - (1 - s.parallaxSpan)) / s.parallaxSpan);
    const zoomEase = blurCurve(zoomTime, s.parallaxCurveStart, s.parallaxCurveEnd,
      s.parallaxCurveStartX, s.parallaxCurveEndX);
    uniform('parallax', [s.parallaxZoom, s.parallaxSpan, zoomEase, 0]);
    uniform('frontProjection', [1, 1, s.blurRadius, 0.12]);
    uniform('frontEdge', [1.6, s.edgeDarkness, 0.18, 1.5]);
    uniform('frontCorner', [0.97, 1, 0.006, 0]);
    // The blur boundary shift is fixed and cannot be changed by saved versions.
    uniform('frontBlur', [
      s.diagonalBlurRadius,
      1,
      0.24,
      s.rightScreenDarkness,
    ]);
    uniform('creaseBlur', [
      s.creaseBlendWidth,
      s.creaseBlurEasing,
      s.blurCurveStart,
      s.blurCurveEnd,
    ]);
    const curveKey = [
      s.blurCurveStartX,
      s.blurCurveStart,
      s.blurCurveEndX,
      s.blurCurveEnd,
    ].join(',');
    if (curveKey !== this.curveKey) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        1025,
        1,
        0,
        gl.RED,
        gl.FLOAT,
        blurCurveTable(s),
      );
      gl.activeTexture(gl.TEXTURE0);
      this.curveKey = curveKey;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.animation) this.requestDraw();
  };
  dispose() {
    this.disposed = true;
    this.pendingImage = null;
    cancelAnimationFrame(this.frame);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.curveTexture);
    this.gl.deleteProgram(this.program);
  }
}
