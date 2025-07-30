// @ts-check

const usernameInput = /** @type {HTMLInputElement} */ (
  document.getElementById("username")
);
const passwordInput = /** @type {HTMLInputElement} */ (
  document.getElementById("password")
);
const loginContainer = /** @type {HTMLFormElement} */ (
  document.getElementById("login-container")
);
const canvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("canvas")
);

/** @type {WebGL2RenderingContext | null} */
const glContext = canvas.getContext("webgl2");
if (!glContext) {
  console.error("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}
/** @type {WebGL2RenderingContext} */
const gl = glContext;

// Vertex shader - simple fullscreen quad
/** @type {string} */
const vertexShaderSource = `#version 300 es
in vec4 a_position;
out vec2 v_uv;

void main() {
  gl_Position = a_position;
  v_uv = a_position.xy * 0.5 + 0.5;
}`;

// Fragment shader - ray marching
/** @type {string} */
const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_pitch_angle;
uniform float u_yaw_angle;
uniform vec3 u_led_color;

const float PI = 3.14159265358979323846;

const float MATERIAL_PLASTIC = 0.0;
const float MATERIAL_GLASS = 1.0;
const float MATERIAL_LED = 2.0;

// Distance function for a cube
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Distance function for an octahedron
float sdOctahedron( vec3 p, float s)
{
  p = abs(p);
  return (p.x+p.y+p.z-s)*0.57735027;
}

// Distance function for a capped cylinder
float sdCappedCylinder( vec3 p, float h, float r )
{
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

// Distance function for a sphere
float sdSphere(vec3 p, float s) {
  return length(p) - s;
}

// Rotation matrix around X-axis (pitch)
mat3 pitchMatrix(float angle) {
  return mat3(
    1.0, 0.0, 0.0,
    0.0, cos(angle), -sin(angle),
    0.0, sin(angle), cos(angle)
  );
}

// Rotation matrix around Y-axis (yaw)
mat3 yawMatrix(float angle) {
  return mat3(
    cos(angle), 0.0, sin(angle),
    0.0, 1.0, 0.0,
    -sin(angle), 0.0, cos(angle)
  );
}

// Rotation matrix around Z-axis (roll)
mat3 rollMatrix(float angle) {
  return mat3(
    cos(angle), -sin(angle), 0.0,
    sin(angle), cos(angle), 0.0,
    0.0, 0.0, 1.0
  );
}

// Scene distance function - returns vec2(distance, materialId)
vec2 map(vec3 p) {
  // Mouse-controlled cube rotation (angles calculated in JS)
  float pitchAngle = u_pitch_angle;
  float yawAngle = u_yaw_angle;
  float rollAngle = 0.0;            // No roll rotation from mouse

  // Generate and combine rotation matrices using separate functions
  mat3 pitch = pitchMatrix(pitchAngle);
  mat3 yaw = yawMatrix(yawAngle);
  mat3 roll = rollMatrix(rollAngle);

  // Combine rotations: roll * pitch * yaw (order matters)
  mat3 rotation = roll * pitch * yaw;

  // Apply rotation to the cube
  vec3 rotatedP = rotation * p;
  float cube = sdBox(rotatedP, vec3(1.2, 1.0, 1.0));

  // Create octahedron positioned at the front of the cube
  vec3 octahedronPosBase = rotatedP - vec3(0.0, 0.0, -1.0);
  octahedronPosBase.x /= 1.2; // Scale x-axis to make octahedron wider
  vec3 octahedronPos = rollMatrix(PI / 4.0) * octahedronPosBase;
  float octahedron = sdOctahedron(octahedronPos, 1.2);

  // Add a flattened cylinder that spans top to bottom of canvas
  vec3 cylinderPos = rotatedP; // Use world coordinates, not rotated
  cylinderPos.z += 0.75; // Move cylinder closer to camera
  cylinderPos = cylinderPos * vec3(0.125, 1.0, 1.0);
  float cylinder = sdCappedCylinder(cylinderPos, 1.0, 0.2);

  // Subtract octahedron from cube (CSG subtraction)
  float cubeWithHole = max(cube, -octahedron);

  // Add LED sphere at bottom right of cube
  vec3 ledPos = rotatedP - vec3(1.1, -0.9, -1.0); // Bottom right position
  float ledSphere = sdSphere(ledPos, 0.02);

  // Determine closest object and its material
  float cylinderInCube = max(cylinder, cube);

  // Find the closest object
  float minDist = cubeWithHole;
  float material = MATERIAL_PLASTIC;

  if (cylinderInCube < minDist) {
    minDist = cylinderInCube;
    material = MATERIAL_GLASS;
  }

  if (ledSphere < minDist) {
    minDist = ledSphere;
    material = MATERIAL_LED;
  }

  return vec2(minDist, material);
}

// Material functions
vec3 glassMaterial(vec3 normal, vec3 viewDir, vec3 lightDir, float diff) {
  // Black glass material
  vec3 baseColor = vec3(0.0); // Very dark base

  // Glass-like reflections
  vec3 reflectDir = reflect(-viewDir, normal);
  float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 3.0);

  // Specular highlight for glass
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(normal, halfDir)), 64.0);

  vec3 litColor = baseColor + fresnel * 0.3 + spec * 0.8;
  litColor = mix(litColor, vec3(0.1), 0.7); // Add transparency effect

  return litColor;
}

vec3 plasticMaterial(vec3 normal, vec3 viewDir, vec3 lightDir, float diff) {
  // Beige soft plastic material
  vec3 materialColor = vec3(0.9, 0.85, 0.7); // Beige color

  // Soft plastic lighting (more diffuse, less specular)
  float softDiff = 0.4 + 0.6 * diff; // Softer contrast

  // Subtle specular for plastic
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(normal, halfDir)), 16.0) * 0.2;

  return materialColor * softDiff + spec;
}

vec3 ledMaterial(vec3 normal, vec3 viewDir, vec3 lightDir, float diff) {
  // LED material that emits the uniform color
  return u_led_color;
}

// Calculate normal using gradient
vec3 calcNormal(vec3 p) {
  const float eps = 0.001;
  vec2 h = vec2(eps, 0.0);
  return normalize(vec3(
    map(p + h.xyy).x - map(p - h.xyy).x,
    map(p + h.yxy).x - map(p - h.yxy).x,
    map(p + h.yyx).x - map(p - h.yyx).x
  ));
}

// Ray marching function
vec2 rayMarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  const int maxSteps = 100;
  const float maxDist = 100.0;
  const float eps = 0.001;
  float materialId = -1.0;

  for (int i = 0; i < maxSteps; i++) {
    vec3 p = ro + t * rd;
    vec2 result = map(p);
    float d = result.x;
    materialId = result.y;

    if (d < eps || t > maxDist) break;

    t += d;
  }

  return vec2(t, materialId);
}

void main() {
  // Normalize coordinates to [-1, 1]
  vec2 uv = (v_uv - 0.5) * 2.0;
  uv.x *= u_resolution.x / u_resolution.y;

  // Camera setup (fixed camera, no mouse rotation)
  vec3 ro = vec3(0.0, 0.0, -2.75); // Ray origin (camera position) - moved closer
  vec3 rd = normalize(vec3(uv, 1.0)); // Ray direction

  // Ray march
  vec2 marchResult = rayMarch(ro, rd);
  float t = marchResult.x;
  float materialId = marchResult.y;

  // Calculate color with transparency
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0); // Transparent background

  if (t < 100.0) {
    // Hit something
    vec3 p = ro + t * rd;
    vec3 normal = calcNormal(p);

    // Lighting setup
    vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
    vec3 viewDir = normalize(-rd);
    float diff = max(0.0, dot(normal, lightDir));

    vec3 litColor;

    if (materialId == MATERIAL_GLASS) {
      // Cylinder material
      litColor = glassMaterial(normal, viewDir, lightDir, diff);
    } else if (materialId == MATERIAL_PLASTIC) {
      // Cube material
      litColor = plasticMaterial(normal, viewDir, lightDir, diff);
    } else if (materialId == MATERIAL_LED) {
      // LED material
      litColor = ledMaterial(normal, viewDir, lightDir, diff);
    } else {
      // Default material (shouldn't happen)
      litColor = vec3(1.0, 0.0, 1.0); // Magenta for debugging
    }

    // Gamma correction
    litColor = pow(litColor, vec3(1.0 / 2.2));

    color = vec4(litColor, 1.0);
  }

  fragColor = color;
}`;

/**
 * Create shader
 * @param {WebGL2RenderingContext} gl - WebGL context
 * @param {number} type - Shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER)
 * @param {string} source - Shader source code
 * @returns {WebGLShader | null} Compiled shader or null if failed
 */
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Create program
 * @param {WebGL2RenderingContext} gl - WebGL context
 * @param {WebGLShader} vertexShader - Compiled vertex shader
 * @param {WebGLShader} fragmentShader - Compiled fragment shader
 * @returns {WebGLProgram | null} Linked program or null if failed
 */
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

// Setup WebGL
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(
  gl,
  gl.FRAGMENT_SHADER,
  fragmentShaderSource
);

if (!vertexShader || !fragmentShader) {
  throw new Error("Failed to create shaders");
}

const program = createProgram(gl, vertexShader, fragmentShader);
if (!program) {
  throw new Error("Failed to create program");
}

// Create fullscreen quad
/** @type {Float32Array} */
const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

/** @type {WebGLBuffer | null} */
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

// Setup vertex array
/** @type {WebGLVertexArrayObject | null} */
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

/** @type {number} */
const positionLocation = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// Get uniform locations
/** @type {WebGLUniformLocation | null} */
const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
/** @type {WebGLUniformLocation | null} */
const pitchAngleLocation = gl.getUniformLocation(program, "u_pitch_angle");
/** @type {WebGLUniformLocation | null} */
const yawAngleLocation = gl.getUniformLocation(program, "u_yaw_angle");
/** @type {WebGLUniformLocation | null} */
const ledColorLocation = gl.getUniformLocation(program, "u_led_color");

// Mouse tracking
/** @type {{ x: number, y: number }} */
let mousePos = { x: 0.5, y: 0.5 };

// Add mouse event listener
document.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  // Ignore if mouse is outside of canvas
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    return;
  }

  mousePos.x = (event.clientX - rect.left) / rect.width;
  mousePos.y = 1.0 - (event.clientY - rect.top) / rect.height; // Flip Y coordinate

  render();
});

document.addEventListener("touchmove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  mousePos.x = (touch.clientX - rect.left) / rect.width;
  mousePos.y = 1.0 - (touch.clientY - rect.top) / rect.height;

  render();
});

canvas.addEventListener("resize", () => {
  resizeCanvas();
  render();
});

/**
 * Resize canvas to match display size
 */
function resizeCanvas() {
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const pixelRatio = window.devicePixelRatio;

  const renderWidth = Math.floor(displayWidth * pixelRatio);
  const renderHeight = Math.floor(displayHeight * pixelRatio);

  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  render();
}

/**
 * @param {Event} _event
 */
function onInputChange(_event) {
  LED_COLOR = LED_GREEN;
  render();

  setTimeout(() => {
    LED_COLOR = LED_OFF;
    render();
  }, 200);
}

usernameInput.addEventListener("input", onInputChange);
passwordInput.addEventListener("input", onInputChange);

/** @type {number | null} */
let submitTimeout = null;
loginContainer.addEventListener("submit", (event) => {
  event.preventDefault();

  if (submitTimeout) {
    clearTimeout(submitTimeout);
  }

  LED_COLOR = LED_RED;
  render();

  submitTimeout = setTimeout(() => {
    LED_COLOR = LED_OFF;
    render();
    submitTimeout = null;
  }, 1000);
});

/** @type {[number, number, number]} */
const LED_OFF = [0.0, 0.0, 0.0];
/** @type {[number, number, number]} */
const LED_RED = [1.0, 0.0, 0.0];
/** @type {[number, number, number]} */
const LED_GREEN = [0.0, 1.0, 0.0];
/** @type {[number, number, number]} */
const LED_BLUE = [0.0, 0.0, 1.0];

/** @type {[number, number, number]} */
let LED_COLOR = LED_OFF;

function render() {
  // Enable blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.clearColor(0, 0, 0, 0); // Transparent clear color
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.bindVertexArray(vao);

  // Set uniforms
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

  // Calculate rotation angles from mouse position
  const normalizedMouse = {
    x: (mousePos.x - 0.5) * 2.0,
    y: (mousePos.y - 0.5) * 2.0,
  };
  const pitchAngle = normalizedMouse.y * 0.25; // Vertical mouse movement -> pitch (X-axis rotation)
  const yawAngle = -normalizedMouse.x * 0.25; // Horizontal mouse movement -> yaw (Y-axis rotation)

  gl.uniform1f(pitchAngleLocation, pitchAngle);
  gl.uniform1f(yawAngleLocation, yawAngle);

  // Set LED color to red (#ff0000)
  gl.uniform3f(ledColorLocation, ...LED_COLOR);

  // Apply same rotation to login container using CSS transforms
  if (loginContainer) {
    loginContainer.style.transform = `
      translate(-50%, -50%)
      rotateX(${pitchAngle / 12}rad)
      rotateY(${-yawAngle / 12}rad)
    `;
  }

  // Draw
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// Start the render loop
requestAnimationFrame(() => {
  resizeCanvas();
  render();
});
