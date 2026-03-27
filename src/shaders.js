export const vertexShader = `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uPointSize;
  uniform float uSizeVariance;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize * (1.0 + (aSize - 0.5) * uSizeVariance);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const fragmentShader = `
  varying vec3 vColor;
  uniform float uSoftness;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    float radius = 0.42;
    float edge = fwidth(dist) * (1.0 + uSoftness * 8.0);
    float alpha = 1.0 - smoothstep(radius - edge, radius + edge, dist);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;
