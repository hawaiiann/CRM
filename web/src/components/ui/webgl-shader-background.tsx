import { useEffect, useRef } from "react"

// Fullscreen animated shader background — a soft glowing arc sweeping over a
// dark canvas, in the spirit of the "liquid glass" hero look. Raw WebGL, no
// three.js: a single fullscreen triangle + fragment shader is all this needs,
// and it keeps the bundle small.
const VERTEX_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAGMENT_SRC = `
precision highp float;
uniform vec2 uResolution;
uniform float uTime;

// Smooth glowing arc: distance from a point to a circle, turned into a thin
// bright band via inverse-square falloff, with a slow drift + color drift.
float arcGlow(vec2 uv, vec2 center, float radius, float width) {
  float d = abs(length(uv - center) - radius);
  return width / (d * d + width);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  float t = uTime * 0.06;
  // Anchored higher than before (was -0.85) — the brightest part of the arc
  // used to land in the empty lower half of short pages (Задачи, Клиенты,
  // Планирование), reading as "page didn't finish loading" rather than
  // ambient light. Keeping it near the top/header band, where there's
  // always real content, means short pages stay calm below the fold.
  vec2 center = vec2(sin(t * 0.7) * 0.3, -0.45 + sin(t * 0.5) * 0.08);
  float radius = 1.0 + sin(t * 0.9) * 0.05;

  float glow = arcGlow(uv, center, radius, 0.0045);
  float glowWide = arcGlow(uv, center, radius, 0.04) * 0.28;

  vec3 warm = vec3(1.0, 0.82, 0.55);
  vec3 cool = vec3(0.45, 0.65, 1.0);
  float mixT = 0.5 + 0.5 * sin(uv.x * 2.2 + t * 1.3);
  vec3 arcColor = mix(cool, warm, mixT);

  // Dimmed overall so the glow reads as ambient light, not a spotlight —
  // keeps the glass panels from washing out when it sweeps behind them.
  vec3 col = arcColor * (glow * 1.4 + glowWide) * 0.486;

  // subtle ambient vignette so the canvas isn't pure black at the edges
  float vig = smoothstep(1.4, 0.2, length(uv));
  col += vec3(0.015, 0.015, 0.022) * vig;

  gl_FragColor = vec4(col, 1.0);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error("Shader compile error: " + info)
  }
  return shader
}

export function WebGLShaderBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false })
    if (!gl) return

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
    const program = gl.createProgram()!
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Shader link error:", gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    const posBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, "aPos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, "uResolution")
    const uTime = gl.getUniformLocation(program, "uTime")

    let rafId = 0
    const start = performance.now()
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    function resize() {
      const canvasEl = canvasRef.current
      if (!canvasEl || !gl) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.floor(canvasEl.clientWidth * dpr)
      const h = Math.floor(canvasEl.clientHeight * dpr)
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w
        canvasEl.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    function render(now: number) {
      resize()
      const ctx = gl!
      ctx.uniform2f(uResolution, ctx.drawingBufferWidth, ctx.drawingBufferHeight)
      ctx.uniform1f(uTime, prefersReducedMotion ? 0 : (now - start) / 1000)
      ctx.drawArrays(ctx.TRIANGLES, 0, 3)
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteBuffer(posBuffer)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />
}
