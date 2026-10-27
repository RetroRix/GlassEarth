/**
 * The ride horizon wedge — the band of the ride view that neither
 * the ground tiles nor the renderer's sky can paint.
 *
 * Found by measuring pixels on live rides, after two wrong theories
 * (see files/cockpit-sky-2026-10-26.md): at the ride's 76° pitch the
 * visible ground ends where tile coverage ends, but the true horizon
 * line sits higher on the screen. Between them is a wedge. The
 * renderer's sky program writes only ABOVE its horizon line; its
 * background layer paints only per covering tile, i.e. only where
 * ground already is; and the canvas is cleared transparent — so the
 * wedge showed the page behind the canvas: a flat pale (day) or
 * near-black (night) bar with a cliff edge, whatever the sky spec
 * said. Recolouring the background layer could not touch it (proven
 * by an in-ride probe: the paint read back changed, the pixels did
 * not).
 *
 * The fix paints the wedge from inside the canvas, with a custom
 * WebGL layer at the very bottom of the style stack: a fullscreen
 * triangle whose fragment shader evaluates the SAME horizon-line
 * test the renderer's own sky program uses — same line, ported from
 * the renderer's source — and fills the below-line side with the
 * ride sky's horizon colour. Tiles and labels draw over it where
 * they exist; above the line the sky gradient already lives; the
 * three meet at one colour because the spec sets fog == horizon.
 * Being canvas paint, the sensor looks (which filter the canvas)
 * treat the wedge like the rest of the world.
 *
 * Ride-scoped like the sky itself: the effect in OsirisMap adds the
 * layer when a ride starts and removes it when the ride ends. The
 * layer deliberately no-ops under the globe projection — the wedge
 * is a flat-map horizon artefact; globe rides keep the sky gradient
 * alone, as they shipped.
 */
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';

export const RIDE_WEDGE_LAYER_ID = 'ride-horizon-wedge';

/** The renderer's cap on the horizon angle (maxMercatorHorizonAngle). */
export const MAX_MERCATOR_HORIZON_ANGLE = 89.25;

/**
 * Port of the renderer's getMercatorHorizon: how far above the
 * screen centre the horizon line sits, in CSS pixels, for a camera
 * `cameraToCenterDistance` px away at `pitchDegrees`. The 0.85
 * factor is the renderer's own earth-radius simulation.
 */
export function mercatorHorizonPx(cameraToCenterDistance: number, pitchDegrees: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  return (
    cameraToCenterDistance *
    Math.min(
      Math.tan(rad(90 - pitchDegrees)) * 0.85,
      Math.tan(rad(MAX_MERCATOR_HORIZON_ANGLE - pitchDegrees)),
    )
  );
}

export interface WedgeHorizonUniforms {
  /** A point on the horizon line, device px, GL orientation (y up). */
  horizon: [number, number];
  /** The line's unit normal, pointing toward the sky side. */
  normal: [number, number];
}

/**
 * The horizon line in exactly the form the renderer's sky program
 * receives it (its skyUniformValues): the line passes through
 * (width/2 − horizon·sinRoll, height/2 + horizon·cosRoll) scaled by
 * the pixel ratio, with normal (−sinRoll, cosRoll). A fragment is on
 * the sky side when its signed distance along the normal is > 0.
 */
export function rideWedgeHorizonUniforms(input: {
  width: number;
  height: number;
  pixelRatio: number;
  rollRadians: number;
  cameraToCenterDistance: number;
  pitchDegrees: number;
}): WedgeHorizonUniforms {
  const horizon = mercatorHorizonPx(input.cameraToCenterDistance, input.pitchDegrees);
  const cosRoll = Math.cos(input.rollRadians);
  const sinRoll = Math.sin(input.rollRadians);
  return {
    horizon: [
      (input.width / 2 - horizon * sinRoll) * input.pixelRatio,
      (input.height / 2 + horizon * cosRoll) * input.pixelRatio,
    ],
    normal: [-sinRoll, cosRoll],
  };
}

/**
 * How far past the line (device px) the wedge still paints, onto
 * the gradient's first pixels. There the gradient has already
 * converged to within ~2% of the horizon colour (its blend curve is
 * quadratic over hundreds of px), so the overlap hides any
 * sub-pixel disagreement about the line instead of opening a seam.
 */
export const WEDGE_OVERLAP_PX = 2;

/** The shader's coverage test, mirrored for tests. */
export function wedgeCovers(fragX: number, fragY: number, u: WedgeHorizonUniforms): boolean {
  const blend = (fragY - u.horizon[1]) * u.normal[1] + (fragX - u.horizon[0]) * u.normal[0];
  return blend <= WEDGE_OVERLAP_PX;
}

/** '#cfe2f2' → [0.812, 0.886, 0.949, 1]; null on anything else. */
export function hexToRgba01(hex: string): [number, number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/* The map runs WebGL2 and every custom layer in this app compiles
   `#version 300 es` shaders with a self-declared `out vec4
   fragColor` (see satellite-layer / wind-gl-layer). An ES 1.00
   shader (attribute / gl_FragColor) fails compilation here — the
   first version of this layer did exactly that and silently never
   painted a pixel. */
export const WEDGE_VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 1.0, 1.0); }
`;

export const WEDGE_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_horizon;
uniform vec2 u_horizon_normal;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  float blend = (gl_FragCoord.y - u_horizon.y) * u_horizon_normal.y
              + (gl_FragCoord.x - u_horizon.x) * u_horizon_normal.x;
  if (blend > ${WEDGE_OVERLAP_PX}.0) discard;
  fragColor = u_color;
}
`;

function compile(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * The wedge as a MapLibre custom layer. `colorRef` is the effect's
 * mutable holder for the current ride sky's horizon colour (a theme
 * flip mid-ride updates the ref, and the next frame wears it).
 * Any GL failure leaves the layer inert — it must never break the
 * map it decorates.
 */
/* TEMP DIAGNOSTIC (wedge probe v2 — remove before final): */
export const wedgeProbe = {
  adds: 0, renders: 0, branch: 'never-rendered', effect: 'never-ran', err: '',
};

export function createRideWedgeLayer(colorRef: { current: string }): CustomLayerInterface {
  let map: MlMap | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uHorizon: WebGLUniformLocation | null = null;
  let uNormal: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;

  return {
    id: RIDE_WEDGE_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(m: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      wedgeProbe.adds++;
      map = m;
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, WEDGE_VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, WEDGE_FRAG);
        if (!vs || !fs) return;
        const prog = gl.createProgram();
        if (!prog) return;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.deleteProgram(prog);
          return;
        }
        program = prog;
        aPos = gl.getAttribLocation(prog, 'a_pos');
        uHorizon = gl.getUniformLocation(prog, 'u_horizon');
        uNormal = gl.getUniformLocation(prog, 'u_horizon_normal');
        uColor = gl.getUniformLocation(prog, 'u_color');
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        // One fullscreen triangle.
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      } catch {
        program = null;
      }
    },

    onRemove(_m: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = null;
      try {
        if (program) gl.deleteProgram(program);
        if (buffer) gl.deleteBuffer(buffer);
      } catch { /* context already gone */ }
      program = null;
      buffer = null;
    },

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, options?: { fov?: number }) {
      wedgeProbe.renders++;
      if (!program || !buffer || !map) { wedgeProbe.branch = `missing:${!program ? 'program' : !buffer ? 'buffer' : 'map'}`; return; }
      try {
        // The wedge is a flat-map horizon artefact; globe rides keep
        // the sky gradient alone, as shipped.
        let projectionType: string | undefined;
        try {
          const p = (map as MlMap).getProjection?.() as unknown as { type?: string } | undefined;
          projectionType = p?.type;
        } catch { projectionType = undefined; }
        if (projectionType === 'globe') { wedgeProbe.branch = 'globe-skip'; return; }
        const rgba = hexToRgba01(colorRef.current);
        if (!rgba) { wedgeProbe.branch = 'bad-color'; return; }
        /* Camera state from public getters and the render arguments
           only — the Map's transform is not public surface in this
           MapLibre version (map.transform is undefined at runtime;
           the first version of this layer read it and threw every
           frame). cameraToCenterDistance is the transform's own
           definition: (height / 2) / tan(fov / 2), CSS pixels. */
        const canvas = gl.canvas as HTMLCanvasElement;
        const pixelRatio = map.getPixelRatio();
        const cssWidth = canvas.clientWidth || canvas.width / pixelRatio;
        const cssHeight = canvas.clientHeight || canvas.height / pixelRatio;
        const fov = options?.fov && options.fov > 0 ? options.fov : (36.87 * Math.PI) / 180;
        const t = {
          width: cssWidth,
          height: cssHeight,
          pitch: map.getPitch(),
          cameraToCenterDistance: (0.5 * cssHeight) / Math.tan(fov / 2),
        };
        const u = rideWedgeHorizonUniforms({
          width: t.width,
          height: t.height,
          pixelRatio,
          rollRadians: ((map.getRoll() || 0) * Math.PI) / 180,
          cameraToCenterDistance: t.cameraToCenterDistance,
          pitchDegrees: t.pitch,
        });
        gl.useProgram(program);
        gl.uniform2f(uHorizon, u.horizon[0], u.horizon[1]);
        gl.uniform2f(uNormal, u.normal[0], u.normal[1]);
        gl.uniform4f(uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        // Pure backdrop paint: no depth interaction, nothing after
        // it in the stack may notice it was here.
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
        wedgeProbe.branch = `drew:h=${u.horizon[1].toFixed(0)},pitch=${t.pitch},dist=${t.cameraToCenterDistance.toFixed(0)},w=${t.width},h=${t.height}`;
      } catch (e) { wedgeProbe.branch = `threw:${e instanceof Error ? e.message : String(e)}`; }
    },
  };
}
