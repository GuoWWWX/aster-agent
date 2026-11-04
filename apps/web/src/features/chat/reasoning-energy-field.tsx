import { useEffect, useRef, type ReactElement } from "react";

const MAX_BURSTS = 8;
const MAX_DEVICE_PIXEL_RATIO = 2;

const VERTEX_SHADER = `#version 300 es
precision highp float;

const vec2 TRIANGLE[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(TRIANGLE[gl_VertexID], 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_pixel_ratio;
uniform float u_time;
uniform float u_run_age;
uniform float u_envelope;
uniform int u_burst_count;
uniform vec4 u_bursts[${MAX_BURSTS}];
uniform vec3 u_track_color;
uniform vec3 u_base_color;
uniform vec3 u_cool_color;
uniform vec3 u_hot_color;
uniform vec3 u_blue_tint;
uniform vec3 u_pink_tint;

out vec4 output_color;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

float roundedSquare(vec2 point, float half_size, float radius) {
  vec2 distance_to_edge = abs(point) - vec2(half_size - radius);
  return length(max(distance_to_edge, 0.0))
    + min(max(distance_to_edge.x, distance_to_edge.y), 0.0)
    - radius;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  float pitch = 4.0 * u_pixel_ratio;
  vec2 cell = floor(pixel / pitch);
  vec2 cell_point = mod(pixel, pitch) - pitch * 0.5;
  float square_distance = roundedSquare(cell_point, 1.48 * u_pixel_ratio, 0.82 * u_pixel_ratio);
  float square_mask = 1.0 - smoothstep(0.0, 0.72 * u_pixel_ratio, square_distance);

  float cell_noise = hash21(cell + 17.19);
  vec2 grid_size = u_resolution / pitch;
  float initial_distance = cell.x + abs(cell.y - grid_size.y * 0.48) * 0.82;
  float arrival_jitter = (hash21(cell + 61.73) - 0.5) * 0.2
    + sin(cell.y * 1.37 + cell_noise * 4.2) * 0.045;
  float initial_arrival = initial_distance / 62.0 + arrival_jitter;
  float initial_age = u_run_age - initial_arrival;
  float initial_head = initial_age > 0.0 ? exp(-initial_age * 5.8) : 0.0;
  float initial_recruitment = step(hash21(cell + 143.8), 0.68);

  float old_surface = 1.0 - smoothstep(0.08, 0.42, u_run_age);
  float charged_surface = smoothstep(0.0, 0.34, initial_age);
  float solid_surface = max(old_surface, charged_surface);
  float energy = initial_head * mix(0.62, 1.16, cell_noise) * initial_recruitment;

  for (int index = 0; index < ${MAX_BURSTS}; index += 1) {
    if (index >= u_burst_count) break;

    vec4 burst = u_bursts[index];
    float burst_age = u_time - burst.z;
    if (burst_age <= 0.0) continue;

    vec2 burst_cell = burst.xy * grid_size;
    float burst_identity = hash21(vec2(burst.z * 13.7, burst.w * 31.1));
    float speed = mix(21.0, 38.0, burst_identity);
    float distance_to_burst = abs(cell.x - burst_cell.x) + abs(cell.y - burst_cell.y) * 0.72;
    float local_jitter = (hash21(cell + burst.z * 7.31) - 0.5) * 0.11;
    float local_age = burst_age - distance_to_burst / speed - local_jitter;
    if (local_age <= 0.0) continue;

    float recruitment = hash21(cell + vec2(burst.z * 4.7, burst.z * 9.1));
    float density = mix(0.32, 0.82, hash21(vec2(burst.z, burst.z + 8.3)));
    if (recruitment > density) continue;

    float head = exp(-local_age * 5.2) * 1.24;
    float body_decay = mix(0.82, 3.1, hash21(cell + burst.z * 2.3));
    float body = exp(-local_age * body_decay) * 0.58;
    energy = max(energy, (head + body) * burst.w);
  }

  float drift = 0.84 + 0.16 * sin(u_time * 1.25 + cell.x * 0.43 + cell_noise * 6.28318);
  energy *= drift;
  float stepped_energy = floor(clamp(energy, 0.0, 0.999) * 5.0) / 4.0;
  float hot_cell = smoothstep(0.56, 1.0, stepped_energy);
  float breath_period = mix(2.1, 3.7, hash21(cell + 91.2));
  float breath = 1.0 - hot_cell * 0.24
    * (0.5 + 0.5 * sin(u_time * 6.28318 / breath_period + cell_noise * 6.28318));
  stepped_energy *= breath;

  vec3 energy_color = mix(u_cool_color, u_hot_color, hot_cell);
  float tint_identity = hash21(cell + 203.4);
  energy_color = mix(energy_color, u_blue_tint, step(0.86, tint_identity) * 0.34);
  energy_color = mix(energy_color, u_pink_tint, step(tint_identity, 0.12) * 0.32);

  float particle_coverage = square_mask * stepped_energy;
  vec3 surface_color = mix(u_track_color, u_base_color, solid_surface);
  surface_color = mix(surface_color, energy_color, particle_coverage);
  output_color = vec4(surface_color, u_envelope);
}
`;

type EnergyBurst = {
  gain: number;
  startedAt: number;
  x: number;
  y: number;
};

type EnergyFieldController = {
  destroy: () => void;
  setActive: (active: boolean) => void;
};

type RgbColor = readonly [number, number, number];

const LIGHT_PALETTE = {
  blue: [0.29, 0.5, 1] as RgbColor,
  cool: [0.45, 0.26, 0.88] as RgbColor,
  hot: [0.78, 0.32, 0.96] as RgbColor,
  pink: [0.95, 0.35, 0.74] as RgbColor,
  track: [0.91, 0.93, 0.96] as RgbColor,
};

const DARK_PALETTE = {
  blue: [0.45, 0.65, 1] as RgbColor,
  cool: [0.66, 0.48, 0.95] as RgbColor,
  hot: [0.9, 0.64, 1] as RgbColor,
  pink: [0.94, 0.44, 0.82] as RgbColor,
  track: [0.2, 0.21, 0.23] as RgbColor,
};

function compileShader(
  context: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = context.createShader(type);
  if (shader === null) return null;

  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (context.getShaderParameter(shader, context.COMPILE_STATUS) === true) return shader;

  context.deleteShader(shader);
  return null;
}

function createProgram(context: WebGL2RenderingContext): WebGLProgram | null {
  const vertexShader = compileShader(context, context.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(context, context.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vertexShader === null || fragmentShader === null) {
    if (vertexShader !== null) context.deleteShader(vertexShader);
    if (fragmentShader !== null) context.deleteShader(fragmentShader);
    return null;
  }

  const program = context.createProgram();
  if (program === null) {
    context.deleteShader(vertexShader);
    context.deleteShader(fragmentShader);
    return null;
  }

  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);
  if (context.getProgramParameter(program, context.LINK_STATUS) === true) return program;

  context.deleteProgram(program);
  return null;
}

function parseCssColor(value: string, fallback: RgbColor): RgbColor {
  const rgbMatch = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbMatch !== null) {
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  }

  const colorMatch = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (colorMatch !== null) {
    return [Number(colorMatch[1]), Number(colorMatch[2]), Number(colorMatch[3])];
  }

  return fallback;
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function mountEnergyField(canvas: HTMLCanvasElement): EnergyFieldController | null {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (context === null) return null;

  const program = createProgram(context);
  if (program === null) return null;

  const uniform = (name: string): WebGLUniformLocation | null => context.getUniformLocation(program, name);
  const uniforms = {
    baseColor: uniform("u_base_color"),
    blueTint: uniform("u_blue_tint"),
    burstCount: uniform("u_burst_count"),
    bursts: uniform("u_bursts[0]"),
    coolColor: uniform("u_cool_color"),
    envelope: uniform("u_envelope"),
    hotColor: uniform("u_hot_color"),
    pinkTint: uniform("u_pink_tint"),
    pixelRatio: uniform("u_pixel_ratio"),
    resolution: uniform("u_resolution"),
    runAge: uniform("u_run_age"),
    time: uniform("u_time"),
    trackColor: uniform("u_track_color"),
  };
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const burstValues = new Float32Array(MAX_BURSTS * 4);
  const bursts: EnergyBurst[] = [];
  let active = false;
  let animationFrame = 0;
  let destroyed = false;
  let envelope = 0;
  let lastFrameAt = performance.now() / 1_000;
  let nextBurstAt = 0;
  let runStartedAt = lastFrameAt;

  context.useProgram(program);

  const resizeCanvas = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.viewport(0, 0, width, height);
  };

  const addBurst = (startedAt: number, initial = false): void => {
    bursts.push({
      gain: initial ? 1.08 : randomBetween(0.68, 1.02),
      startedAt,
      x: initial ? 0.02 : randomBetween(0.58, 0.98),
      y: randomBetween(0.2, 0.8),
    });
    if (bursts.length > MAX_BURSTS) bursts.shift();
  };

  const scheduleFrame = (): void => {
    if (destroyed || animationFrame !== 0) return;
    animationFrame = window.requestAnimationFrame(renderFrame);
  };

  const renderFrame = (timestamp: number): void => {
    animationFrame = 0;
    if (destroyed) return;

    resizeCanvas();
    const now = timestamp / 1_000;
    const elapsed = Math.min(Math.max(now - lastFrameAt, 0), 0.05);
    lastFrameAt = now;
    const reducedMotion = reducedMotionQuery.matches;
    const envelopeTarget = active ? 1 : 0;
    const envelopeRate = active ? 9 : 5.5;
    envelope += (envelopeTarget - envelope) * (1 - Math.exp(-elapsed * envelopeRate));

    if (active && !reducedMotion && now >= nextBurstAt) {
      addBurst(now);
      nextBurstAt = now + randomBetween(0.3, 0.75);
    }
    while (bursts.length > 0 && now - bursts[0]!.startedAt > 5) bursts.shift();

    burstValues.fill(0);
    bursts.forEach((burst, index) => {
      const offset = index * 4;
      burstValues[offset] = burst.x;
      burstValues[offset + 1] = burst.y;
      burstValues[offset + 2] = burst.startedAt;
      burstValues[offset + 3] = burst.gain;
    });

    const isDark = document.documentElement.dataset.theme === "dark";
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const rangeStyles = getComputedStyle(canvas.parentElement ?? canvas);
    const trackStyles = canvas.parentElement?.parentElement === null
      || canvas.parentElement?.parentElement === undefined
      ? rangeStyles
      : getComputedStyle(canvas.parentElement.parentElement);
    const baseColor = parseCssColor(rangeStyles.backgroundColor, palette.cool);
    const trackColor = parseCssColor(trackStyles.backgroundColor, palette.track);
    const runAge = reducedMotion && active ? 10 : Math.max(0, now - runStartedAt);

    context.useProgram(program);
    context.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    context.uniform1f(uniforms.pixelRatio, Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    context.uniform1f(uniforms.time, now);
    context.uniform1f(uniforms.runAge, runAge);
    context.uniform1f(uniforms.envelope, reducedMotion ? envelopeTarget : envelope);
    context.uniform1i(uniforms.burstCount, reducedMotion ? 0 : bursts.length);
    context.uniform4fv(uniforms.bursts, burstValues);
    context.uniform3fv(uniforms.trackColor, trackColor);
    context.uniform3fv(uniforms.baseColor, baseColor);
    context.uniform3fv(uniforms.coolColor, palette.cool);
    context.uniform3fv(uniforms.hotColor, palette.hot);
    context.uniform3fv(uniforms.blueTint, palette.blue);
    context.uniform3fv(uniforms.pinkTint, palette.pink);
    context.drawArrays(context.TRIANGLES, 0, 3);

    if (reducedMotion) return;
    if (active || envelope > 0.01) scheduleFrame();
  };

  const setActive = (nextActive: boolean): void => {
    if (active === nextActive) return;
    active = nextActive;
    lastFrameAt = performance.now() / 1_000;
    if (active) {
      runStartedAt = lastFrameAt;
      bursts.length = 0;
      addBurst(runStartedAt + 0.04, true);
      nextBurstAt = runStartedAt + randomBetween(0.42, 0.72);
    }
    scheduleFrame();
  };

  const resizeObserver = new ResizeObserver(scheduleFrame);
  resizeObserver.observe(canvas);
  const themeObserver = new MutationObserver(scheduleFrame);
  themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"], attributes: true });
  reducedMotionQuery.addEventListener("change", scheduleFrame);
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") scheduleFrame();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeCanvas();

  return {
    destroy: () => {
      destroyed = true;
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      reducedMotionQuery.removeEventListener("change", scheduleFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      context.deleteProgram(program);
    },
    setActive,
  };
}

export function ReasoningEnergyField({ active }: { active: boolean }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<EnergyFieldController | null>(null);
  const initialActiveRef = useRef(active);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    const controller = mountEnergyField(canvas);
    controllerRef.current = controller;
    controller?.setActive(initialActiveRef.current);
    return () => {
      controller?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setActive(active);
  }, [active]);

  return (
    <canvas
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full rounded-[inherit]"
      ref={canvasRef}
    />
  );
}
