/**
 * Particle shaders. Motion that is a pure function of time (intro, morph,
 * idle drift, sheen, hover lens) runs on the GPU; only the pointer spring
 * offsets are simulated on the CPU and streamed in via `aOffset`.
 *
 * Colors stay in sRGB end to end (no three.js color management), and the
 * fragment shaders output premultiplied alpha.
 */

export const particleVertex = /* glsl */ `
  attribute vec2 aStart;
  attribute vec3 aStartColor;
  attribute float aStartScale;
  attribute vec3 aColor;
  attribute float aScale;
  attribute float aDelay;
  attribute vec4 aRand;
  attribute vec2 aOffset;

  uniform float uTime;
  uniform float uIntroTime;
  uniform float uDuration;
  uniform float uStagger;
  uniform float uEase;
  uniform float uCurve;
  uniform float uFadeIn;
  uniform float uPolar;

  uniform float uDotSize;
  uniform float uPxPerUnit;
  uniform float uSizeVar;
  uniform float uBrightVar;
  uniform float uIdle;
  uniform float uTwinkle;
  uniform float uSizeMul;
  uniform float uOffsetMix;

  uniform vec2 uPointer;
  uniform float uPointerAmt;
  uniform float uLensRadius;
  uniform float uLens;

  uniform float uSheen;
  uniform float uSheenPos;
  uniform vec2 uSheenDir;
  uniform float uSheenWidth;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vPx;
  varying float vSprite;

  float ease(float t) {
    if (uEase < 0.5) return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
    if (uEase < 1.5) { float u = 1.0 - t; return 1.0 - u * u * u * u; }
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
  }

  void main() {
    float t = clamp((uIntroTime - aDelay * uStagger) / uDuration, 0.0, 1.0);
    float e = ease(t);

    vec2 home = position.xy;
    vec2 p;
    if (uPolar > 0.5) {
      // Spiral in: aStart = (radius multiplier, angular offset).
      float a = aStart.y * (1.0 - e);
      float m = mix(aStart.x, 1.0, e);
      p = mat2(cos(a), sin(a), -sin(a), cos(a)) * home * m;
    } else {
      vec2 d = home - aStart;
      p = mix(aStart, home, e);
      // Curved flight path: sideways bow that vanishes at both ends.
      p += vec2(-d.y, d.x) * (aRand.y - 0.5) * uCurve * sin(3.14159265 * e);
    }

    float ph = aRand.x * 6.2831853;
    p += uIdle * e * vec2(
      sin(uTime * (0.55 + aRand.z * 0.5) + ph),
      cos(uTime * (0.45 + aRand.w * 0.5) + ph * 1.7)
    );
    p += aOffset * uOffsetMix;

    float scale = mix(aStartScale, aScale, e);
    vec3 col = mix(aStartColor, aColor, e);

    float bright = 1.0 + (aRand.z - 0.5) * 2.0 * uBrightVar;
    bright *= 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (0.8 + aRand.w * 1.6) + ph * 3.0));

    float lens = uPointerAmt * (1.0 - smoothstep(0.0, uLensRadius, length(p - uPointer)));
    float s = dot(home, uSheenDir) - uSheenPos;
    float sheen = uSheen * exp(-(s * s) / (uSheenWidth * uSheenWidth)) * step(0.999, t);

    float size = uDotSize * scale
      * (1.0 + (aRand.w - 0.5) * 2.0 * uSizeVar)
      * (1.0 + lens * uLens + sheen * 0.3);

    col = col * bright;
    col = mix(col, vec3(1.0), clamp(sheen * 0.55 + lens * uLens * 0.12, 0.0, 1.0));

    float alpha = mix(1.0, smoothstep(0.0, 0.45, t), uFadeIn);
    float px = size * uPxPerUnit * uSizeMul;
    // Sub-pixel dots: keep a 1px footprint and fade by covered area instead.
    alpha *= clamp(px * px, 0.0, 1.0);
    px = max(px, 1.0);

    vColor = col;
    vAlpha = alpha;
    vPx = px;
    vSprite = px + 2.0;
    gl_PointSize = vSprite;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

export const dotFragment = /* glsl */ `
  uniform float uSoftness;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPx;
  varying float vSprite;

  void main() {
    float r = length(gl_PointCoord - 0.5) * vSprite;
    float R = vPx * 0.5;
    // Analytic 1px anti-aliased disc.
    float hard = clamp(R - r + 0.5, 0.0, 1.0);
    float soft = exp(-2.2 * (r * r) / (R * R));
    float a = mix(hard, soft, uSoftness) * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export const glowFragment = /* glsl */ `
  uniform float uGlow;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float g = exp(-18.0 * dot(c, c)) * uGlow * vAlpha;
    if (g < 0.001) discard;
    gl_FragColor = vec4(vColor * g, g * 0.6);
  }
`;

export const backgroundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const backgroundFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uSpot;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d = length(p) / (0.5 * max(uAspect, 1.0));
    vec3 col = mix(uColor2, uColor, smoothstep(0.0, 1.15, d) * uSpot + (1.0 - uSpot));
    // Triangular dither kills 8-bit banding in dark gradients.
    float n1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float n2 = fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 24634.6345);
    col += (n1 + n2 - 1.0) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;
