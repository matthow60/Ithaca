'use client';

// Animated WebGL backgrounds in the Odyssey palette. Raw WebGL, no dependencies.
//
//   <ShaderCanvas variant="sea" />     flat poster-style waves rising from the bottom (page background)
//   <ShaderCanvas variant="oracle" />  slow swirling marble in teal with gold glints (Gemini card)
//
// Pauses when off-screen or when the tab is hidden, draws one still frame for
// prefers-reduced-motion, and hides itself if WebGL isn't available or the
// context is lost (the CSS background behind it shows instead).
//
// Note: cleanup must NOT call WEBGL_lose_context. React (dev / Strict Mode) runs
// effects twice on the same <canvas>, and getContext() would then hand back the
// dead context, which Chrome draws as a white box with a sad-face icon.

import { useEffect, useRef } from 'react';

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Shared noise helpers + two looks. Colors are posterized into flat bands
// to match the cut-paper style of the key art, with foam lines on band edges.
const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_variant; // 0 = sea, 1 = oracle

const vec3 INK      = vec3(0.122, 0.106, 0.110);
const vec3 DEEP     = vec3(0.039, 0.204, 0.192);
const vec3 TEAL_DK  = vec3(0.000, 0.392, 0.361);
const vec3 TEAL     = vec3(0.000, 0.608, 0.557);
const vec3 FOAM     = vec3(0.627, 0.851, 0.827);
const vec3 GOLD     = vec3(1.000, 0.745, 0.345);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

vec4 sea(vec2 uv, vec2 p, float t) {
  vec2 q = vec2(fbm(p * 1.8 + vec2(t, -t * 0.4)), fbm(p * 1.8 + vec2(-t * 0.6, t)));
  float f = fbm(p * 1.4 + 2.0 * q + vec2(t * 0.5, 0.0));
  // height of the water surface: rolling swells with a noisy edge
  float h = uv.y * 1.55 - 0.09 * sin(p.x * 3.2 + t * 5.0 + f * 5.0) - f * 0.55;
  float bands = 7.0;
  float level = floor(h * bands);
  float edge = fract(h * bands);

  vec3 col = INK;
  if (level < 1.0) col = TEAL;
  else if (level < 2.0) col = TEAL_DK;
  else if (level < 3.0) col = DEEP;
  float alpha = level < 3.0 ? 1.0 : 0.0;

  // foam crest lines along each band edge
  float crest = (1.0 - smoothstep(0.0, 0.06, edge)) * step(level, 3.0);
  col = mix(col, FOAM, crest * 0.85);
  alpha = max(alpha, crest * 0.6);
  // fade the whole sea toward the top so content stays readable
  alpha *= 0.5 * (1.0 - smoothstep(0.06, 0.36, uv.y));
  return vec4(col, alpha);
}

vec4 oracle(vec2 uv, vec2 p, float t) {
  // Large, slow domain warp: reads as flowing marble / contour lines, not noise.
  vec2 q = vec2(fbm(p * 0.9 + vec2(t * 0.8, 0.0)), fbm(p * 0.9 + vec2(0.0, -t * 0.7)));
  vec2 r = vec2(fbm(p * 0.8 + 1.8 * q + vec2(1.7, 9.2) + t * 0.3), fbm(p * 0.8 + 1.8 * q + vec2(8.3, 2.8)));
  float f = fbm(p * 0.7 + 1.8 * r);
  float bands = 9.0;
  float level = floor(f * bands);
  float edge = fract(f * bands);

  // Mostly ink, with deep-sea bands and thin teal contour lines.
  vec3 col = mod(level, 2.0) < 1.0 ? INK : mix(INK, DEEP, 0.75);
  float line = 1.0 - smoothstep(0.0, 0.07, edge);
  col = mix(col, TEAL, line * 0.55);
  // a single gold contour near the peaks
  float glint = step(6.0, level) * (1.0 - smoothstep(0.0, 0.09, edge));
  col = mix(col, GOLD, glint * 0.8);
  return vec4(col, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * 0.05;
  vec4 c = u_variant < 0.5 ? sea(uv, p, t) : oracle(uv, p, t);
  gl_FragColor = vec4(c.rgb * c.a, c.a); // premultiplied alpha
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[ShaderCanvas]', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

export default function ShaderCanvas({ variant = 'sea', className = '', maxDpr = 1.5 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const hide = () => {
      canvas.style.visibility = 'hidden';
    };
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true });
    if (!gl || gl.isContextLost()) return hide();
    canvas.style.visibility = '';

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return hide();
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return hide();
    gl.useProgram(program);

    // One triangle that covers the whole canvas.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');
    gl.uniform1f(gl.getUniformLocation(program, 'u_variant'), variant === 'oracle' ? 1 : 0);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let frame = 0;
    let visible = true;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    }

    function draw(now) {
      resize();
      // Reduced motion: a fixed, still frame.
      gl.uniform1f(uTime, reduceMotion ? 40 : (now - start) / 1000 + 40);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    let lost = false;
    function onLost(e) {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      frame = 0;
      hide();
    }
    canvas.addEventListener('webglcontextlost', onLost);

    function loop(now) {
      if (lost) return;
      draw(now);
      frame = visible && !document.hidden && !reduceMotion ? requestAnimationFrame(loop) : 0;
    }
    function wake() {
      if (!lost && !frame && visible && !document.hidden && !reduceMotion) frame = requestAnimationFrame(loop);
    }

    const resizeObserver = new ResizeObserver(() => !lost && draw(performance.now()));
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wake();
    });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', wake);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', wake);
      canvas.removeEventListener('webglcontextlost', onLost);
      // Free GPU objects but keep the context alive (see note at the top).
      if (!gl.isContextLost()) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
    };
  }, [variant, maxDpr]);

  return <canvas ref={ref} className={`shader-canvas ${className}`} aria-hidden="true" />;
}
