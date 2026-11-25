'use strict';
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktop = window.matchMedia('(min-width: 821px)');
const hero = document.querySelector('.hero');
const atmosphere = document.querySelector('.ambient-clouds');
const motionControl = document.querySelector('.motion-control');
const gardenMotion = createGardenMotion();
let paused = motionPreference.matches;
let heroVisible = hero.getBoundingClientRect().bottom > 0;
// A CSS animation's paused state preserves its exact pose and elapsed time.
// The pets stay still. Small painted garden regions and the clouds move.
function syncMotion() {
  const playing = !paused && heroVisible && !document.hidden;
  const cloudsPlaying = playing && desktop.matches;
  atmosphere.style.animationPlayState = cloudsPlaying ? 'running' : 'paused';
  atmosphere.style.willChange = cloudsPlaying ? 'transform' : 'auto';
  gardenMotion.setPlaying(playing);
  hero.dataset.motionState = playing ? 'playing' : 'paused';
  motionControl.hidden = false;
  motionControl.querySelector('span').textContent = paused ? 'Resume motion' : 'Pause motion';
  motionControl.querySelector('path').setAttribute('d', paused ? 'M6 3l10 7-10 7Z' : 'M7 4v12M13 4v12');
}

// Butterflies are transparent sprites over stationary background patches.
// Only the separate flower regions deform the original painting.
function createGardenMotion() {
  const canvas = hero.querySelector('.garden-motion');
  const artwork = hero.querySelector('img.hero-art');
  let gl;
  let program;
  let timeUniform;
  let strengthUniform;
  let ready = false;
  let failed = false;
  let playing = false;
  let frame = 0;
  let previousTime = null;
  let elapsed = 0;
  let assetsStarted = false;
  let assetsReady = false;
  const assets = {};

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = null;
  }
  function fallback() {
    ready = false;
    failed = true;
    stop();
    delete hero.dataset.gardenReady;
  }
  const regions = [
    [67, 314, 88, 94], [1454, 509, 76, 86],
    [193, 700, 132, 208], [73, 697, 70, 110], [1406, 853, 124, 164]
  ];
  function draw(fullPainting = false) {
    gl.uniform1f(timeUniform, elapsed);
    gl.uniform1f(strengthUniform, desktop.matches ? 1 : .7);
    if (fullPainting) {
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      // Repaint only the five moving areas, about five percent of the image.
      gl.enable(gl.SCISSOR_TEST);
      for (const [x, y, width, height] of regions) {
        gl.scissor(x, canvas.height - y - height, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  }
  function tick(now) {
    if (!playing || !ready) return;
    if (previousTime === null) previousTime = now;
    const delta = now - previousTime;
    // Thirty painted frames per second are enough for this gentle movement.
    if (delta >= 1000 / 30 - .5) {
      // All authored frequencies complete whole cycles at 200π seconds.
      // Wrapping here preserves continuity and shader precision on long visits.
      elapsed = (elapsed + Math.min(delta / 1000, .1)) % (200 * Math.PI);
      previousTime = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function setPlaying(value) {
    playing = value;
    if (!playing) stop();
    else {
      loadAssets();
      maybeInitialize();
      if (ready && !frame) frame = requestAnimationFrame(tick);
    }
  }
  function maybeInitialize() {
    if (playing && !ready && !failed && assetsReady && artwork.complete && artwork.naturalWidth) initialize();
  }
  function loadAssets() {
    if (assetsStarted || failed) return;
    assetsStarted = true;
    const sources = {
      left: 'assets/garden-left-underlay.webp',
      right: 'assets/garden-right-underlay.webp',
      butterfly: 'assets/butterfly.webp'
    };
    let remaining = Object.keys(sources).length;
    for (const [key, source] of Object.entries(sources)) {
      const image = new Image();
      assets[key] = image;
      image.addEventListener('load', () => {
        remaining -= 1;
        if (remaining === 0) { assetsReady = true; maybeInitialize(); }
      }, { once: true });
      image.addEventListener('error', fallback, { once: true });
      image.src = source;
    }
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Garden shader unavailable');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Garden shader unavailable');
    }
    return shader;
  }
  function initialize() {
    if (!artwork.naturalWidth) return;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power'
      });
      if (!gl) { fallback(); return; }
      if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) {
        throw new Error('Garden precision unavailable');
      }
      const vertex = compile(gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          v_uv = vec2((a_position.x + 1.0) * .5, (1.0 - a_position.y) * .5);
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `);
      const fragment = compile(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_image;
        uniform sampler2D u_left;
        uniform sampler2D u_right;
        uniform sampler2D u_butterfly;
        uniform float u_time;
        uniform float u_strength;
        varying vec2 v_uv;

        float patchWeight(vec2 uv) {
          vec2 edge = smoothstep(vec2(0.0), vec2(.12), uv)
            * smoothstep(vec2(0.0), vec2(.12), vec2(1.0) - uv);
          return edge.x * edge.y;
        }
        vec4 butterfly(vec2 p, vec2 center, float size, float speed, bool mirror) {
          float beat = u_time * speed;
          float wing = 1.0 - (.10 - .10 * cos(beat)) * u_strength;
          vec2 drift = vec2(2.0 * sin(u_time * 1.1), 3.0 * sin(u_time * 1.7)) * u_strength;
          float angle = .04 * sin(u_time * 2.1) * u_strength;
          float c = cos(angle);
          float s = sin(angle);
          vec2 moved = mat2(c, -s, s, c) * (p - center - drift);
          moved.x /= wing;
          vec2 uv = moved / size + .5;
          if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return vec4(0.0);
          if (mirror) uv.x = 1.0 - uv.x;
          return texture2D(u_butterfly, uv);
        }
        vec2 breeze(vec2 p, vec2 center, vec2 radius, float speed) {
          vec2 local = p - center;
          float weight = 1.0 - smoothstep(.25, 1.0, length(local / radius));
          // Upper blossoms move most; the stem's lower attachment stays put.
          float bend = 1.0 - smoothstep(-.1, .9, local.y / radius.y);
          float wind = sin(u_time * speed) + .3 * sin(u_time * speed * 1.8);
          return p - vec2(5.5 * wind, .8 * sin(u_time * speed)) * weight * bend * u_strength;
        }
        void main() {
          vec2 screen = v_uv * vec2(1536.0, 1024.0);
          vec2 p = screen;
          p = breeze(p, vec2(259.0, 804.0), vec2(66.0, 104.0), 1.15);
          p = breeze(p, vec2(108.0, 752.0), vec2(35.0, 55.0), 1.35);
          p = breeze(p, vec2(1468.0, 935.0), vec2(62.0, 82.0), .95);
          vec4 color = texture2D(u_image, p / vec2(1536.0, 1024.0));
          // Background coordinates never use the butterfly's transformation.
          vec2 leftUV = (screen - vec2(64.0, 306.0)) / vec2(96.0, 108.0);
          vec2 rightUV = (screen - vec2(1444.0, 502.0)) / vec2(92.0, 108.0);
          color = mix(color, texture2D(u_left, leftUV), patchWeight(leftUV));
          color = mix(color, texture2D(u_right, rightUV), patchWeight(rightUV));
          vec4 left = butterfly(screen, vec2(111.0, 360.0), 64.0, 12.0, false);
          vec4 right = butterfly(screen, vec2(1492.0, 552.0), 62.0, 10.5, true);
          // Sprite RGB is uploaded premultiplied, avoiding colored edge halos.
          color.rgb = left.rgb + color.rgb * (1.0 - left.a);
          color.rgb = right.rgb + color.rgb * (1.0 - right.a);
          gl_FragColor = color;
        }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Garden renderer unavailable');
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      function uploadTexture(image, unit, uniform, premultiply = false) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.uniform1i(gl.getUniformLocation(program, uniform), unit);
      }
      uploadTexture(artwork, 0, 'u_image');
      uploadTexture(assets.left, 1, 'u_left');
      uploadTexture(assets.right, 2, 'u_right');
      uploadTexture(assets.butterfly, 3, 'u_butterfly', true);
      timeUniform = gl.getUniformLocation(program, 'u_time');
      strengthUniform = gl.getUniformLocation(program, 'u_strength');
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw(true);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Garden texture unavailable');
      ready = true;
      hero.dataset.gardenReady = 'true';
      setPlaying(playing);
    } catch {
      fallback();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  canvas.addEventListener('webglcontextlost', fallback);
  artwork.addEventListener('load', maybeInitialize, { once: true });
  return { setPlaying };
}
motionControl.addEventListener('click', () => { paused = !paused; syncMotion(); });
motionPreference.addEventListener('change', () => { paused = motionPreference.matches; syncMotion(); });
desktop.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);
if ('IntersectionObserver' in window) {
  const heroObserver = new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    syncMotion();
  });
  heroObserver.observe(hero);
}
syncMotion();

// Read the label: while the section is on screen the ingredients take turns,
// each with Kiba's note, then the match; tapping one holds it. Without motion,
// IntersectionObserver or the Web Animations API the section stays a plain
// list with every note shown.
(function labelStory() {
  const track = document.querySelector('.label-track');
  if (!track) return;
  const stage = track.querySelector('.label-stage');
  const list = track.querySelector('.label-list');
  const noteColumn = track.querySelector('.label-notes');
  const control = track.querySelector('.label-control');
  const controlText = control.querySelector('.label-control-text');
  const controlIcon = control.querySelector('path');
  const progress = control.querySelector('.label-control-bar span');
  const words = [...track.querySelectorAll('.ing')];
  const notes = [...track.querySelectorAll('.label-note')];
  const supported = 'IntersectionObserver' in window && typeof Element.prototype.animate === 'function';
  let enabled = false;
  let inView = false;
  let userPaused = false;
  let step = 0;
  let timer = null;
  const observer = supported ? new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
    sync();
  }, { threshold: [0, 0.35, 0.7] }) : null;

  // Times live in CSS custom properties (ms). Each step lasts at least long
  // enough to read its note at about 240 words a minute.
  function dwell() {
    const result = step === words.length;
    const style = getComputedStyle(track);
    const base = parseFloat(style.getPropertyValue(result ? '--label-result' : '--label-step')) || (result ? 6000 : 3500);
    const perWord = parseFloat(style.getPropertyValue('--label-per-word')) || 0;
    const text = (result ? track.querySelector('.label-result') : notes[step]).textContent;
    return Math.max(base, text.trim().split(/\s+/).length * perWord);
  }
  // On wide screens the margin note sits beside the line of its ingredient.
  function alignNote() {
    const word = words[step];
    const note = notes[step];
    if (!enabled || !word || !note || !desktop.matches) {
      noteColumn.style.removeProperty('--note-y');
      return;
    }
    const room = stage.clientHeight - noteColumn.offsetTop - note.offsetHeight - 24;
    const offset = Math.max(0, Math.min(word.offsetTop - list.offsetTop, room));
    noteColumn.style.setProperty('--note-y', `${offset}px`);
  }
  function render(next) {
    step = next;
    words.forEach((word, i) => {
      word.dataset.state = i < step ? 'read' : i === step ? 'active' : 'next';
      if (enabled && i === step) word.setAttribute('aria-current', 'step');
      else word.removeAttribute('aria-current');
    });
    notes.forEach((note, i) => note.classList.toggle('is-active', i === step));
    track.dataset.step = String(step);
    track.classList.toggle('is-result', step === words.length);
    alignNote();
  }
  function playing() {
    return enabled && inView && !userPaused && !document.hidden;
  }
  function sync() {
    if (!enabled) return;
    if (timer) {
      if (playing()) timer.play();
      else timer.pause();
    }
    controlText.textContent = userPaused ? 'Play' : 'Pause';
    controlIcon.setAttribute('d', userPaused ? 'M6 3l10 7-10 7Z' : 'M7 4v12M13 4v12');
  }
  // The progress bar's own animation is the timer: when it finishes, advance.
  function startDwell() {
    timer?.cancel();
    timer = progress.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: dwell(), fill: 'forwards' });
    timer.onfinish = () => {
      render((step + 1) % (words.length + 1));
      startDwell();
    };
    sync();
  }
  function choose(index) {
    userPaused = true;
    render(index);
    startDwell();
  }
  function enable() {
    enabled = true;
    document.documentElement.classList.add('label-enhanced');
    control.hidden = false;
    words.forEach((word, i) => {
      word.setAttribute('role', 'button');
      word.tabIndex = 0;
      word.setAttribute('aria-controls', notes[i].id);
    });
    observer.observe(track);
    render(step);
    startDwell();
  }
  function disable() {
    enabled = false;
    timer?.cancel();
    timer = null;
    observer?.disconnect();
    inView = false;
    document.documentElement.classList.remove('label-enhanced');
    control.hidden = true;
    for (const word of words) {
      for (const name of ['role', 'tabindex', 'aria-controls', 'aria-current']) word.removeAttribute(name);
    }
    noteColumn.style.removeProperty('--note-y');
  }
  function syncMode() {
    const wanted = supported && !motionPreference.matches;
    if (wanted && !enabled) enable();
    else if (!wanted && enabled) disable();
  }
  words.forEach((word, i) => {
    word.addEventListener('click', () => { if (enabled) choose(i); });
    word.addEventListener('keydown', event => {
      if (!enabled || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      choose(i);
    });
  });
  control.addEventListener('click', () => {
    userPaused = !userPaused;
    sync();
  });
  // Tabbing onto an ingredient shows its note and holds it, like a tap.
  track.addEventListener('focusin', event => {
    const index = words.indexOf(event.target);
    if (!enabled || index < 0) return;
    let keyboard = false;
    try { keyboard = event.target.matches(':focus-visible'); } catch { keyboard = false; }
    if (keyboard) choose(index);
  });
  // The page's "Pause motion" button pauses and resumes the ingredients too.
  motionControl.addEventListener('click', () => {
    userPaused = paused;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(alignNote);
  });
  desktop.addEventListener('change', alignNote);
  motionPreference.addEventListener('change', syncMode);
  syncMode();
})();
