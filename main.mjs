// @ts-check

const usernameInput = /** @type {HTMLInputElement} */ (
  document.getElementById("username")
);
const passwordInput = /** @type {HTMLInputElement} */ (
  document.getElementById("password")
);
const screenContainer = /** @type {HTMLFormElement} */ (
  document.getElementById("screen-container")
);
const form = /** @type {HTMLFormElement} */ (
  screenContainer.querySelector("form")
);
const messageContainer = /** @type {HTMLDivElement} */ (
  document.getElementById("message-container")
);
const screenSaver = /** @type {HTMLCanvasElement} */ (
  document.getElementById("screen-saver")
);
const canvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("webgl-canvas")
);

/** @type {WebGL2RenderingContext | null} */
const glContext = canvas.getContext("webgl2");
if (!glContext) {
  console.error("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}
/** @type {WebGL2RenderingContext} */
const gl = glContext;

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

/**
 * @typedef {Object} RenderingContext
 * @property {WebGL2RenderingContext} gl
 * @property {WebGLProgram} program
 * @property {WebGLVertexArrayObject} vao
 * @property {WebGLUniformLocation} resolutionLocation
 * @property {WebGLUniformLocation} pitchAngleLocation
 * @property {WebGLUniformLocation} yawAngleLocation
 * @property {WebGLUniformLocation} ledColorLocation
 */

/** @type {RenderingContext | null} */
let renderingContext = null;

/**
 * Initialize WebGL
 * @returns {Promise<void>}
 */
async function initGL() {
  const [vertexShaderSource, fragmentShaderSource] = await Promise.all([
    fetch("shader.vert").then((res) => res.text()),
    fetch("shader.frag").then((res) => res.text()),
  ]);

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
  const positions = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]);

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
  const resolutionLocation = /** @type {WebGLUniformLocation} */ (
    gl.getUniformLocation(program, "u_resolution")
  );
  const pitchAngleLocation = /** @type {WebGLUniformLocation} */ (
    gl.getUniformLocation(program, "u_pitch_angle")
  );
  const yawAngleLocation = /** @type {WebGLUniformLocation} */ (
    gl.getUniformLocation(program, "u_yaw_angle")
  );
  const ledColorLocation = /** @type {WebGLUniformLocation} */ (
    gl.getUniformLocation(program, "u_led_color")
  );

  renderingContext = {
    gl,
    program,
    vao,
    resolutionLocation,
    pitchAngleLocation,
    yawAngleLocation,
    ledColorLocation,
  };
}

// Mouse tracking for desktop
/** @type {{ x: number, y: number }} */
let mousePos = { x: 0.5, y: 0.5 };

// Touch tracking for mobile devices
/** @type {{ x: number, y: number } | null} */
let lastTouchPos = null;
/** @type {{ pitch: number, yaw: number }} */
let touchAngles = { pitch: 0, yaw: 0 };
/** @type {boolean} */
let isDragging = false;

// Add mouse event listener for desktop
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

  scheduleRender();
});

// Touch event handlers for mobile devices
document.addEventListener(
  "touchstart",
  (event) => {
    event.preventDefault(); // Prevent scrolling
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    // Check if touch is within canvas bounds
    if (
      touch.clientX < rect.left ||
      touch.clientX > rect.right ||
      touch.clientY < rect.top ||
      touch.clientY > rect.bottom
    ) {
      return;
    }

    isDragging = true;
    lastTouchPos = {
      x: touch.clientX,
      y: touch.clientY,
    };
  },
  { passive: false }
);

document.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault(); // Prevent scrolling
    if (!isDragging || !lastTouchPos) {
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    // Calculate delta movement
    const deltaX = touch.clientX - lastTouchPos.x;
    const deltaY = touch.clientY - lastTouchPos.y;

    // Convert delta to angle changes (adjust sensitivity as needed)
    const sensitivity = 0.005;
    touchAngles.yaw -= deltaX * sensitivity; // Horizontal drag controls yaw
    touchAngles.pitch += deltaY * sensitivity; // Vertical drag controls pitch (inverted)

    // Clamp angles to reasonable ranges
    touchAngles.pitch = Math.max(
      -Math.PI / 4,
      Math.min(Math.PI / 4, touchAngles.pitch)
    );
    touchAngles.yaw = Math.max(
      -Math.PI / 4,
      Math.min(Math.PI / 4, touchAngles.yaw)
    );

    // Update last touch position
    lastTouchPos = {
      x: touch.clientX,
      y: touch.clientY,
    };

    scheduleRender();
  },
  { passive: false }
);

document.addEventListener(
  "touchend",
  (event) => {
    event.preventDefault();
    isDragging = false;
    lastTouchPos = null;
  },
  { passive: false }
);

canvas.addEventListener("resize", () => {
  resizeCanvas();
  scheduleRender();
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

  scheduleRender();
}

/** @type {number | null} */
let inputTimeout = null;
/**
 * @param {Event} _event
 */
function onInputChange(_event) {
  if (inputTimeout) {
    clearTimeout(inputTimeout);
  }

  ledColor = LED_GREEN;
  scheduleRender();

  inputTimeout = setTimeout(() => {
    ledColor = LED_OFF;
    scheduleRender();
  }, 100);
}

usernameInput.addEventListener("input", onInputChange);
passwordInput.addEventListener("input", onInputChange);

// Activity tracking for screensaver
document.addEventListener("keydown", resetInactivityTimer);
document.addEventListener("click", resetInactivityTimer);
document.addEventListener("touchstart", resetInactivityTimer);
document.addEventListener("touchmove", resetInactivityTimer);
document.addEventListener("click", hideScreensaver);

/**
 * @param {HTMLFormElement} form
 * @returns {boolean}
 */
function validateForm(form) {
  let valid = true;

  const username = /** @type {HTMLInputElement} */ (form.username);
  const password = /** @type {HTMLInputElement} */ (form.password);

  if (username.value === "") {
    username.classList.add("invalid");
    valid = false;
  } else {
    username.classList.remove("invalid");
  }

  if (password.value === "") {
    password.classList.add("invalid");
    valid = false;
  } else {
    password.classList.remove("invalid");
  }

  return valid;
}

/**
 * @param {'form' | 'message' | 'screen-saver'} layer
 */
function showLayer(layer) {
  form.style.display = layer === "form" ? "flex" : "none";
  messageContainer.style.display = layer === "message" ? "block" : "none";
  screenSaver.style.display = layer === "screen-saver" ? "block" : "none";
}

/** @type {number | null} */
let submitTimeout = null;
form.addEventListener("submit", (event) => {
  event.preventDefault();

  // Reset inactivity timer on form submission
  resetInactivityTimer();

  if (submitTimeout) {
    clearTimeout(submitTimeout);
  }

  const valid = validateForm(form);

  ledColor = valid ? LED_GREEN : LED_RED;
  scheduleRender();

  showLayer("message");
  const h1 = /** @type {HTMLHeadingElement} */ (
    messageContainer.querySelector("h1")
  );
  h1.textContent = valid ? "Access Granted" : "Access Denied";
  h1.classList.toggle("invalid", !valid);

  submitTimeout = setTimeout(() => {
    ledColor = LED_OFF;
    scheduleRender();

    showLayer("form");
    resetInactivityTimer(); // Reset timer when returning to form
    submitTimeout = null;
  }, 3000);
});

/** @type {[number, number, number]} */
const LED_OFF = [0.0, 0.0, 0.0];
/** @type {[number, number, number]} */
const LED_RED = [1.0, 0.0, 0.0];
/** @type {[number, number, number]} */
const LED_GREEN = [0.0, 1.0, 0.0];

/** @type {[number, number, number]} */
let ledColor = LED_OFF;

/** @type {number | null} */
let pendingAnimationFrame = null;
function scheduleRender() {
  if (pendingAnimationFrame) {
    cancelAnimationFrame(pendingAnimationFrame);
  }

  pendingAnimationFrame = requestAnimationFrame(render);
}

// Screensaver functionality
/** @type {number | null} */
let inactivityTimer = null;
/** @type {boolean} */
let screensaverActive = false;
/** @type {number | null} */
let gameOfLifeTimeout = null;
/** @type {number | null} */
let gameOfLifeInterval = null;

// Game of Life state
/** @type {boolean[][]} */
let gameGrid = [];
/** @type {number} */
const GRID_SIZE = 50;

/**
 * Reset inactivity timer
 */
function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  if (screensaverActive) {
    return; // Don't reset timer while screensaver is active
  }

  inactivityTimer = setTimeout(() => {
    showScreensaver();
  }, 10000);
}

/**
 * Show screensaver
 */
function showScreensaver() {
  screensaverActive = true;
  showLayer("screen-saver");
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  startGameOfLife();
}

/**
 * Hide screensaver
 */
function hideScreensaver() {
  screensaverActive = false;
  showLayer("form");

  if (gameOfLifeTimeout) {
    clearTimeout(gameOfLifeTimeout);
    gameOfLifeTimeout = null;
  }

  if (gameOfLifeInterval) {
    clearInterval(gameOfLifeInterval);
    gameOfLifeInterval = null;
  }

  resetInactivityTimer();
}

/**
 * Count living neighbors for a cell
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function countNeighbors(x, y) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + GRID_SIZE) % GRID_SIZE;
      const ny = (y + dy + GRID_SIZE) % GRID_SIZE;
      if (gameGrid[nx][ny]) count++;
    }
  }
  return count;
}

/**
 * Update Game of Life grid
 */
function updateGameOfLife() {
  const newGrid = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(false));

  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      const neighbors = countNeighbors(x, y);
      const alive = gameGrid[x][y];

      // Conway's Game of Life rules
      if (alive && (neighbors === 2 || neighbors === 3)) {
        newGrid[x][y] = true; // Survive
      } else if (!alive && neighbors === 3) {
        newGrid[x][y] = true; // Birth
      }
      // Otherwise cell dies or stays dead
    }
  }

  gameGrid = newGrid;
}

/**
 * Render Game of Life
 * @param {CanvasRenderingContext2D} screensaverContext
 */
function renderGameOfLife(screensaverContext) {
  if (!screensaverActive) return;

  const canvas = screenSaver;
  const ctx = screensaverContext;

  // Clear canvas
  ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calculate cell size
  const cellWidth = canvas.width / GRID_SIZE;
  const cellHeight = canvas.height / GRID_SIZE;
  const radius = Math.min(cellWidth, cellHeight) * 0.4;

  // Draw living cells as green circles
  ctx.fillStyle = "#00ff00";
  ctx.shadowColor = "#00ff00";
  ctx.shadowBlur = 10;

  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (gameGrid[x][y]) {
        const centerX = (x + 0.5) * cellWidth;
        const centerY = (y + 0.5) * cellHeight;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.shadowBlur = 0; // Reset shadow
}

function resetGameGrid() {
  gameGrid = Array(GRID_SIZE)
    .fill(null)
    .map(() =>
      Array(GRID_SIZE)
        .fill(null)
        .map(() => Math.random() < 0.3)
    );
}

/**
 * Start Game of Life animation
 */
function startGameOfLife() {
  if (!screensaverActive) return;

  const screensaverContext = screenSaver.getContext("2d");
  if (!screensaverContext) {
    throw new Error("Failed to get screensaver canvas context");
  }

  resetGameGrid();

  // Resize screensaver canvas
  const rect = screenSaver.getBoundingClientRect();
  screenSaver.width = rect.width * window.devicePixelRatio;
  screenSaver.height = rect.height * window.devicePixelRatio;
  screensaverContext.scale(window.devicePixelRatio, window.devicePixelRatio);

  function animate() {
    if (!screensaverActive) return;
    if (!screensaverContext) return;

    updateGameOfLife();
    renderGameOfLife(screensaverContext);

    gameOfLifeTimeout = setTimeout(animate, 250);
  }

  animate();
  gameOfLifeInterval = setInterval(resetGameGrid, 30000);
}

function render() {
  if (!renderingContext) {
    return;
  }

  const {
    gl,
    program,
    vao,
    resolutionLocation,
    pitchAngleLocation,
    yawAngleLocation,
    ledColorLocation,
  } = renderingContext;

  // Enable blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.clearColor(0, 0, 0, 0); // Transparent clear color
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.bindVertexArray(vao);

  // Calculate rotation angles - use touch angles if available, otherwise use mouse position
  let pitchAngle, yawAngle;
  if (
    isDragging ||
    (lastTouchPos === null &&
      (touchAngles.pitch !== 0 || touchAngles.yaw !== 0))
  ) {
    // Use accumulated touch angles for touch devices
    pitchAngle = Math.max(
      -Math.PI / 8,
      Math.min(Math.PI / 8, -touchAngles.pitch * 0.25)
    );
    yawAngle = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, touchAngles.yaw * 0.25)
    );
  } else {
    // Use mouse position for desktop devices
    const normalizedMouse = {
      x: (mousePos.x - 0.5) * 2.0,
      y: (mousePos.y - 0.5) * 2.0,
    };
    pitchAngle = Math.max(
      -Math.PI / 8,
      Math.min(Math.PI / 8, normalizedMouse.y * 0.25)
    );
    yawAngle = Math.max(
      -Math.PI / 8,
      Math.min(Math.PI / 8, -normalizedMouse.x * 0.25)
    );
  }

  gl.uniform1f(pitchAngleLocation, pitchAngle);
  gl.uniform1f(yawAngleLocation, yawAngle);
  gl.uniform3f(ledColorLocation, ...ledColor);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

  screenContainer.style.transform = `
    translate(-50%, -50%)
    rotateX(${pitchAngle / 12}rad)
    rotateY(${-yawAngle / 12}rad)
  `;

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  pendingAnimationFrame = null;
}

// Start the render loop
initGL().then(() => {
  resizeCanvas();
  scheduleRender();
  resetInactivityTimer(); // Start the inactivity timer
});
