/**
 * SafeCircle Interactive Prototype Engine
 * Powers multi-device simulation, 5s long press, Web Audio siren/heartbeat,
 * stealth calculator, live GPS canvas, DigiLocker, and Civic Tally.
 */

// Global State
const state = {
  currentView: 'split', // split | mobile | iot | tracker | civic
  emergencyStatus: 'IDLE', // IDLE | HOLDING | GRACE | ACTIVE | COVERT_DURESS | DISARMED
  holdProgressMs: 0,
  holdTargetMs: 5000,
  graceDurationMs: 1000,
  activeToken: 'tk-8942',
  citizenHandle: 'Verified Citizen #8942',
  safePin: '1234',
  duressPin: '4321', // or 9999
  isSirenActive: true,
  isStrobeActive: true,
  currentPinInput: '',
  // Live GPS Telemetry
  location: {
    lat: 28.6139,
    lng: 77.2090,
    speed: 18.4,
    battery: 94,
  },
  breadcrumbs: [],
  // Calculator state
  calc: {
    current: '0',
    prev: null,
    op: null,
    clearOnNext: false,
  }
};

// ==========================================
// AUDIO SYNTHESIZER (Web Audio API)
// ==========================================
let audioCtx = null;
let sirenOsc = null;
let sirenGain = null;
let sirenInterval = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Synthesize tactile haptic heartbeat pulse
function playHeartbeatClick(freq = 140, duration = 0.04) {
  try {
    initAudio();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio context may be restricted before user gesture
  }
}

// Start dual-tone emergency siren
function startSiren() {
  try {
    initAudio();
    if (!audioCtx || sirenOsc) return;
    sirenOsc = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();
    sirenOsc.type = 'sawtooth';
    sirenOsc.frequency.setValueAtTime(800, audioCtx.currentTime);
    sirenGain.gain.setValueAtTime(0.25, audioCtx.currentTime);

    sirenOsc.connect(sirenGain);
    sirenGain.connect(audioCtx.destination);
    sirenOsc.start();

    let toggle = false;
    sirenInterval = setInterval(() => {
      if (!audioCtx || !sirenOsc) return;
      toggle = !toggle;
      const targetFreq = toggle ? 1400 : 750;
      sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, audioCtx.currentTime + 0.35);
    }, 400);
  } catch (e) {
    console.warn('Siren init:', e);
  }
}

function stopSiren() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (sirenOsc) {
    try {
      sirenOsc.stop();
      sirenOsc.disconnect();
    } catch (e) {}
    sirenOsc = null;
  }
}

// ==========================================
// 5-SECOND CONTINUOUS PRESS LOGIC
// ==========================================
let pressTimer = null;
let pressStartTime = 0;
let graceTimer = null;
let heartbeatInterval = null;

const sosMainBtn = document.getElementById('sosMainBtn');
const ringTactileBtn = document.getElementById('ringTactileBtn');
const ringProgressCircle = document.getElementById('ringProgressCircle');
const sosCounter = document.getElementById('sosCounter');
const graceWindowBanner = document.getElementById('graceWindowBanner');
const btnAbortGrace = document.getElementById('btnAbortGrace');
const hapticWave = document.getElementById('hapticWave');
const gattLogs = document.getElementById('gattLogs');

function logGatt(msg, type = '') {
  if (!gattLogs) return;
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.textContent = msg;
  gattLogs.appendChild(div);
  gattLogs.scrollTop = gattLogs.scrollHeight;
}

function triggerHapticPulseVisual() {
  if (hapticWave) {
    hapticWave.classList.remove('pulsing');
    void hapticWave.offsetWidth; // Trigger reflow
    hapticWave.classList.add('pulsing');
  }
  playHeartbeatClick(160, 0.05);
}

function startLongPress() {
  if (state.emergencyStatus === 'ACTIVE' || state.emergencyStatus === 'GRACE') return;

  initAudio();
  state.emergencyStatus = 'HOLDING';
  pressStartTime = Date.now();
  state.holdProgressMs = 0;
  triggerHapticPulseVisual();
  logGatt('[0xFD01] Button Pressed: Triggering 5s Debounce...', 'info');

  // Progressive Heartbeat Pulses
  let lastPulseTime = 0;
  pressTimer = setInterval(() => {
    const elapsed = Date.now() - pressStartTime;
    state.holdProgressMs = elapsed;
    const progressFrac = Math.min(elapsed / state.holdTargetMs, 1.0);

    // Update Progress Ring (stroke-dashoffset from 565.48 to 0)
    const maxOffset = 565.48;
    const offset = maxOffset * (1.0 - progressFrac);
    ringProgressCircle.style.strokeDashoffset = offset;

    const remainingSec = ((state.holdTargetMs - elapsed) / 1000).toFixed(1);
    sosCounter.textContent = `${remainingSec}s HOLD`;

    // Accelerating Heartbeat Pulses
    let pulseInterval = 700;
    if (elapsed > 3500) pulseInterval = 180;
    else if (elapsed > 1800) pulseInterval = 350;

    if (Date.now() - lastPulseTime >= pulseInterval) {
      lastPulseTime = Date.now();
      triggerHapticPulseVisual();
    }

    if (elapsed >= state.holdTargetMs) {
      clearInterval(pressTimer);
      enterGraceWindow();
    }
  }, 30);
}

function cancelLongPress() {
  if (state.emergencyStatus === 'HOLDING') {
    clearInterval(pressTimer);
    pressTimer = null;
    state.emergencyStatus = 'IDLE';
    state.holdProgressMs = 0;
    ringProgressCircle.style.strokeDashoffset = 565.48;
    sosCounter.textContent = 'HOLD 5s';
    logGatt('[0xFD01] Press Released < 5s: False Positive Filtered', 'info');
  }
}

function enterGraceWindow() {
  state.emergencyStatus = 'GRACE';
  graceWindowBanner.classList.remove('hidden');
  sosCounter.textContent = 'CANCEL WINDOW';
  logGatt('[0xFD01] 5s Reached! 1-Second False-Positive Window Open', 'alert');
  playHeartbeatClick(300, 0.1);

  graceTimer = setTimeout(() => {
    // 1-second grace expired -> Trigger IRREVERSIBLE SOS
    executeEmergencySos();
  }, state.graceDurationMs);
}

function abortDuringGrace() {
  if (state.emergencyStatus === 'GRACE') {
    clearTimeout(graceTimer);
    graceTimer = null;
    graceWindowBanner.classList.add('hidden');
    state.emergencyStatus = 'IDLE';
    state.holdProgressMs = 0;
    ringProgressCircle.style.strokeDashoffset = 565.48;
    sosCounter.textContent = 'HOLD 5s';
    logGatt('[0xFD01] USER ABORTED IN GRACE PERIOD -> Reset to Safe Armed', 'success');
  }
}

// Bind Button Listeners
sosMainBtn.addEventListener('mousedown', startLongPress);
sosMainBtn.addEventListener('mouseup', cancelLongPress);
sosMainBtn.addEventListener('mouseleave', cancelLongPress);
sosMainBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startLongPress(); });
sosMainBtn.addEventListener('touchend', (e) => { e.preventDefault(); cancelLongPress(); });

ringTactileBtn.addEventListener('mousedown', startLongPress);
ringTactileBtn.addEventListener('mouseup', cancelLongPress);
ringTactileBtn.addEventListener('mouseleave', cancelLongPress);
ringTactileBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startLongPress(); });
ringTactileBtn.addEventListener('touchend', (e) => { e.preventDefault(); cancelLongPress(); });

btnAbortGrace.addEventListener('click', abortDuringGrace);

// ==========================================
// EMERGENCY SOS TRIGGER EXECUTION
// ==========================================
const armedView = document.getElementById('armedView');
const emergencyActiveView = document.getElementById('emergencyActiveView');
const threatBadge = document.getElementById('threatBadge');
const threatBadgeText = document.getElementById('threatBadgeText');
const btnToggleSiren = document.getElementById('btnToggleSiren');
const sirenBtnIcon = document.getElementById('sirenBtnIcon');
const sirenBtnText = document.getElementById('sirenBtnText');
const tStatus = document.getElementById('tStatus');

function executeEmergencySos(isCovert = false) {
  state.emergencyStatus = isCovert ? 'COVERT_DURESS' : 'ACTIVE';
  graceWindowBanner.classList.add('hidden');

  if (isCovert) {
    threatBadge.className = 'threat-status-badge status-duress';
    threatBadgeText.textContent = 'STATUS: COVERT DURESS ACTIVE';
    tStatus.textContent = '⚠️ COVERT DURESS (HIGH ALERT)';
    tStatus.style.color = '#ffaa00';
    logGatt('[0xFD01] HIGH-PRIORITY COVERT DURESS ACTIVATED!', 'alert');
  } else {
    threatBadge.className = 'threat-status-badge status-sos';
    threatBadgeText.textContent = '🚨 EMERGENCY SOS ACTIVE';
    tStatus.textContent = '🚨 ACTIVE SOS BROADCAST';
    tStatus.style.color = '#ff0055';
    logGatt('[0xFD01] IRREVERSIBLE EMERGENCY SOS DISPATCHED TO 112 & CONTACTS!', 'alert');

    // Switch phone screen to emergency view
    armedView.classList.add('hidden');
    emergencyActiveView.classList.remove('hidden');

    // Play siren
    if (state.isSirenActive) {
      startSiren();
    }
  }

  // Generate Evidence Snapshot Timestamp
  const now = new Date();
  document.getElementById('snapshotTimestamp').textContent = now.toLocaleTimeString() + ' IST';
  document.getElementById('camGpsWatermark').textContent = `${state.location.lat.toFixed(4)}° N, ${state.location.lng.toFixed(4)}° E | Speed: ${state.location.speed}km/h`;
}

// Siren Toggle
btnToggleSiren.addEventListener('click', () => {
  state.isSirenActive = !state.isSirenActive;
  if (state.isSirenActive) {
    btnToggleSiren.classList.add('active');
    sirenBtnIcon.textContent = '🔊';
    sirenBtnText.textContent = 'Siren: 110dB Active';
    startSiren();
  } else {
    btnToggleSiren.classList.remove('active');
    sirenBtnIcon.textContent = '🔈';
    sirenBtnText.textContent = 'Siren: Muted';
    stopSiren();
  }
});

// ==========================================
// DISARM PIN MODAL (Safe vs Duress PIN)
// ==========================================
const btnOpenDisarmModal = document.getElementById('btnOpenDisarmModal');
const pinModal = document.getElementById('pinModal');
const btnPinClose = document.getElementById('btnPinClose');
const btnPinClear = document.getElementById('btnPinClear');
const pinDots = document.querySelectorAll('.pin-dot');
const covertDuressBanner = document.getElementById('covertDuressBanner');

btnOpenDisarmModal.addEventListener('click', () => {
  state.currentPinInput = '';
  updatePinDots();
  pinModal.classList.remove('hidden');
});

btnPinClose.addEventListener('click', () => {
  pinModal.classList.add('hidden');
});

btnPinClear.addEventListener('click', () => {
  state.currentPinInput = '';
  updatePinDots();
});

function updatePinDots() {
  pinDots.forEach((dot, idx) => {
    if (idx < state.currentPinInput.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

document.querySelectorAll('.num-key[data-digit]').forEach((key) => {
  key.addEventListener('click', () => {
    if (state.currentPinInput.length < 4) {
      state.currentPinInput += key.getAttribute('data-digit');
      updatePinDots();

      if (state.currentPinInput.length === 4) {
        setTimeout(processPinEntry, 120);
      }
    }
  });
});

function processPinEntry() {
  const pin = state.currentPinInput;
  pinModal.classList.add('hidden');

  if (pin === state.safePin) {
    // SAFE DISARM: Reset cleanly
    stopSiren();
    state.emergencyStatus = 'DISARMED';
    armedView.classList.remove('hidden');
    emergencyActiveView.classList.add('hidden');
    covertDuressBanner.classList.add('hidden');

    threatBadge.className = 'threat-status-badge status-idle';
    threatBadgeText.textContent = 'STATUS: ARMED & SECURE';
    tStatus.textContent = 'ARMED (READY)';
    tStatus.style.color = '#00f2fe';

    logGatt('[0xFD01] Safe PIN Entered: Disarmed successfully', 'success');
  } else if (pin === state.duressPin || pin === '9999') {
    // DURESS FAKE DISARM:
    // Silence siren and change screen to safe to appease assailant,
    // but secretly keep background GPS streaming with covert duress alert!
    stopSiren();
    state.emergencyStatus = 'COVERT_DURESS';
    armedView.classList.remove('hidden');
    emergencyActiveView.classList.add('hidden');
    covertDuressBanner.classList.remove('hidden'); // Shown for prototype inspection

    threatBadge.className = 'threat-status-badge status-duress';
    threatBadgeText.textContent = 'STATUS: COVERT DURESS ACTIVE';
    tStatus.textContent = '⚠️ COVERT DURESS (HIGH ALERT)';
    tStatus.style.color = '#ffaa00';

    logGatt('[0xFD01] DURESS PIN ENTERED! Fake Disarm displayed to assailant; covert tracking streaming!', 'alert');
  } else {
    alert('Invalid PIN code entered. Disarm rejected.');
    state.currentPinInput = '';
    updatePinDots();
  }
}

// ==========================================
// STEALTH CALCULATOR DISGUISE
// ==========================================
const phoneAppScreen = document.getElementById('phoneAppScreen');
const phoneCalculatorScreen = document.getElementById('phoneCalculatorScreen');
const btnQuickStealth = document.getElementById('btnQuickStealth');
const btnAppStealth = document.getElementById('btnAppStealth');
const calcDisplay = document.getElementById('calcDisplay');
const calcCovertDot = document.getElementById('calcCovertDot');
const calcEqualsBtn = document.getElementById('calcEqualsBtn');

function toggleStealthMode() {
  const isCurrentlyCalc = phoneCalculatorScreen.classList.contains('active-screen');
  if (isCurrentlyCalc) {
    phoneCalculatorScreen.classList.remove('active-screen');
    phoneAppScreen.classList.add('active-screen');
  } else {
    phoneAppScreen.classList.remove('active-screen');
    phoneCalculatorScreen.classList.add('active-screen');
  }
}

btnQuickStealth.addEventListener('click', toggleStealthMode);
btnAppStealth.addEventListener('click', toggleStealthMode);

// Calculator Operations
document.querySelectorAll('.cbtn[data-calc]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-calc');

    if (!isNaN(action)) {
      // Digit
      if (state.calc.current === '0' || state.calc.clearOnNext) {
        state.calc.current = action;
        state.calc.clearOnNext = false;
      } else {
        state.calc.current += action;
      }
      calcDisplay.textContent = state.calc.current;
    } else if (action === 'AC') {
      state.calc.current = '0';
      state.calc.prev = null;
      state.calc.op = null;
      state.calc.clearOnNext = false;
      calcDisplay.textContent = '0';
    } else if (action === 'DOT') {
      if (!state.calc.current.includes('.')) {
        state.calc.current += '.';
        calcDisplay.textContent = state.calc.current;
      }
    } else if (action === 'NEG') {
      state.calc.current = String(parseFloat(state.calc.current) * -1);
      calcDisplay.textContent = state.calc.current;
    } else if (action === 'PCT') {
      state.calc.current = String(parseFloat(state.calc.current) / 100);
      calcDisplay.textContent = state.calc.current;
    } else if (['ADD', 'SUB', 'MUL', 'DIV'].includes(action)) {
      state.calc.prev = parseFloat(state.calc.current);
      state.calc.op = action;
      state.calc.clearOnNext = true;
    } else if (action === 'EQ') {
      handleCalcEquals();
    }
  });
});

function handleCalcEquals() {
  const expr = state.calc.current;

  // Secret Safe PIN Uncloak Check: "1234="
  if (expr === state.safePin) {
    state.calc.current = '0';
    calcDisplay.textContent = '0';
    toggleStealthMode();
    return;
  }

  // Secret Duress / Covert SOS Check: "9999=" or "0000="
  if (expr === state.duressPin || expr === '9999' || expr === '0000') {
    calcCovertDot.classList.add('active');
    state.calc.current = '0';
    calcDisplay.textContent = '0';
    executeEmergencySos(true); // covert = true
    return;
  }

  // Standard Arithmetic
  if (state.calc.prev !== null && state.calc.op) {
    const curr = parseFloat(state.calc.current);
    let result = 0;
    switch (state.calc.op) {
      case 'ADD': result = state.calc.prev + curr; break;
      case 'SUB': result = state.calc.prev - curr; break;
      case 'MUL': result = state.calc.prev * curr; break;
      case 'DIV': result = curr !== 0 ? state.calc.prev / curr : 0; break;
    }
    state.calc.current = String(Number(result.toFixed(6)));
    calcDisplay.textContent = state.calc.current;
    state.calc.prev = null;
    state.calc.op = null;
    state.calc.clearOnNext = true;
  }
}

// Long hold equals for 3s also triggers covert SOS
let equalsHoldTimer = null;
calcEqualsBtn.addEventListener('mousedown', () => {
  equalsHoldTimer = setTimeout(() => {
    calcCovertDot.classList.add('active');
    executeEmergencySos(true);
  }, 3000);
});
calcEqualsBtn.addEventListener('mouseup', () => clearTimeout(equalsHoldTimer));
calcEqualsBtn.addEventListener('mouseleave', () => clearTimeout(equalsHoldTimer));

// ==========================================
// DIGILOCKER & KYC OVERLAYS
// ==========================================
const tileLocker = document.getElementById('tileLocker');
const lockerOverlay = document.getElementById('lockerOverlay');
const btnCloseLocker = document.getElementById('btnCloseLocker');

tileLocker.addEventListener('click', () => lockerOverlay.classList.remove('hidden'));
btnCloseLocker.addEventListener('click', () => lockerOverlay.classList.add('hidden'));

// Locker Item Attach Toggles
document.querySelectorAll('.attach-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('attached')) {
      btn.classList.remove('attached');
      btn.textContent = 'Attach';
    } else {
      btn.classList.add('attached');
      btn.textContent = '✓ Attached';
    }
  });
});

const tileKYC = document.getElementById('tileKYC');
const kycOverlay = document.getElementById('kycOverlay');
const btnCloseKyc = document.getElementById('btnCloseKyc');
const btnRunOcrKyc = document.getElementById('btnRunOcrKyc');
const kycVerifiedHandleDisplay = document.getElementById('kycVerifiedHandleDisplay');

tileKYC.addEventListener('click', () => kycOverlay.classList.remove('hidden'));
btnCloseKyc.addEventListener('click', () => kycOverlay.classList.add('hidden'));

btnRunOcrKyc.addEventListener('click', () => {
  btnRunOcrKyc.textContent = '⏳ RUNNING OCR SCAN & HASHING...';
  setTimeout(() => {
    btnRunOcrKyc.textContent = '⚡ RUN AUTOMATED OCR VERIFICATION';
    kycVerifiedHandleDisplay.textContent = 'Verified Citizen #8942';
    alert('KYC Verified! Real PII encrypted in isolated vault; anonymous handle "Verified Citizen #8942" issued.');
  }, 1200);
});

// ==========================================
// LIVE MAP VECTOR CANVAS & TELEMETRY STREAM
// ==========================================
const canvas = document.getElementById('mapCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const mapPinPulse = document.getElementById('mapPinPulse');
const tLat = document.getElementById('tLat');
const tSpeed = document.getElementById('tSpeed');
const tBattery = document.getElementById('tBattery');
const mapSpeedTag = document.getElementById('mapSpeedTag');

let carX = 180;
let carY = 170;
let carVx = 1.2;
let carVy = 0.5;

function drawMap() {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  // Clear map background
  ctx.fillStyle = '#060a10';
  ctx.fillRect(0, 0, w, h);

  // Draw Grid Blocks (Urban City Layout)
  ctx.strokeStyle = '#0d1522';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw Primary Arterial Roads
  ctx.strokeStyle = '#182538';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(w, 170);
  ctx.moveTo(250, 0);
  ctx.lineTo(250, h);
  ctx.stroke();

  // Draw Road Centerlines (Dashed)
  ctx.strokeStyle = '#253752';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(w, 170);
  ctx.moveTo(250, 0);
  ctx.lineTo(250, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Breadcrumbs Trail
  if (state.breadcrumbs.length > 1) {
    ctx.strokeStyle = state.emergencyStatus === 'ACTIVE' ? '#ff0055' : '#00f2fe';
    ctx.lineWidth = 4;
    ctx.beginPath();
    state.breadcrumbs.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  }

  // Move vehicle simulation
  carX += carVx;
  carY += carVy;

  // Turn around bounds
  if (carX > w - 40 || carX < 40) carVx *= -1;
  if (carY > h - 40 || carY < 40) carVy *= -1;

  // Record breadcrumb point
  if (Math.random() < 0.2) {
    state.breadcrumbs.push({ x: carX, y: carY });
    if (state.breadcrumbs.length > 40) state.breadcrumbs.shift();
  }

  // Draw Current Location Ping
  ctx.fillStyle = state.emergencyStatus === 'ACTIVE' ? '#ff0055' : '#00f2fe';
  ctx.beginPath();
  ctx.arc(carX, carY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Position Pin Overlay
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / w;
  const scaleY = rect.height / h;
  if (mapPinPulse) {
    mapPinPulse.style.left = `${carX * scaleX}px`;
    mapPinPulse.style.top = `${carY * scaleY}px`;
  }

  requestAnimationFrame(drawMap);
}

// Periodic Telemetry Update (every 3 seconds)
setInterval(() => {
  state.location.lat += (Math.random() - 0.49) * 0.0002;
  state.location.lng += (Math.random() - 0.49) * 0.0002;
  state.location.speed = Math.max(8, Math.min(55, state.location.speed + (Math.random() * 4 - 2)));
  state.location.battery = Math.max(20, state.location.battery - 0.05);

  tLat.textContent = `${state.location.lat.toFixed(4)}° N, ${state.location.lng.toFixed(4)}° E`;
  tSpeed.textContent = `${state.location.speed.toFixed(1)} km/h`;
  mapSpeedTag.textContent = `${state.location.speed.toFixed(1)} km/h`;
  tBattery.textContent = `${Math.round(state.location.battery)}%`;
}, 3000);

drawMap();

// ==========================================
// VIEW SWITCHER TABS
// ==========================================
const viewTabs = document.querySelectorAll('.nav-tab');
viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    viewTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.getAttribute('data-view');
    document.body.className = `theme-dark view-${view}`;
  });
});

// ==========================================
// PUBLIC ACCOUNTABILITY TALLY
// ==========================================
const tallyCitySelect = document.getElementById('tallyCitySelect');
const tallyTotal = document.getElementById('tallyTotal');
const tallyResolved = document.getElementById('tallyResolved');
const tallyPending = document.getElementById('tallyPending');
const tallyResponse = document.getElementById('tallyResponse');

const CITY_METRICS = {
  'Delhi NCR': { total: '1,842', res: '1,490', pend: '352', resp: '4.2 min' },
  'Mumbai': { total: '1,510', res: '1,280', pend: '230', resp: '4.5 min' },
  'Bengaluru': { total: '1,120', res: '980', pend: '140', resp: '4.9 min' },
  'Hyderabad': { total: '890', res: '750', pend: '140', resp: '5.1 min' },
};

tallyCitySelect.addEventListener('change', () => {
  const city = tallyCitySelect.value;
  const data = CITY_METRICS[city] || CITY_METRICS['Delhi NCR'];
  tallyTotal.textContent = data.total;
  tallyResolved.textContent = `${data.res} (81%)`;
  tallyPending.textContent = data.pend;
  tallyResponse.textContent = data.resp;
});

// Complaint Search
const btnSearchComplaint = document.getElementById('btnSearchComplaint');
btnSearchComplaint.addEventListener('click', () => {
  alert('Loaded real-time investigation log for case SC-DL-2026-8942. Status: Under Investigation (Hauz Khas Police Station).');
});

// Copy live tracking link
const btnCopyUrl = document.getElementById('btnCopyUrl');
const btnShareTracking = document.getElementById('btnShareTracking');
const handleCopyUrl = () => {
  navigator.clipboard?.writeText('https://app.safecircle.id/track/tk-8942');
  alert('Copied Live Tracking Link: https://app.safecircle.id/track/tk-8942 (No login required for emergency contacts)');
};
btnCopyUrl.addEventListener('click', handleCopyUrl);
btnShareTracking.addEventListener('click', handleCopyUrl);

// ==========================================
// AI CONSTITUTIONAL LEGAL & VICTIM SHIELD ENGINE
// ==========================================

// 1. Mobile In-App Overlay Controls
const tileLegal = document.getElementById('tileLegal');
const legalOverlay = document.getElementById('legalOverlay');
const btnCloseLegal = document.getElementById('btnCloseLegal');
const btnMobileVictimSos = document.getElementById('btnMobileVictimSos');
const mobileLegalInput = document.getElementById('mobileLegalInput');
const btnMobileSendLegal = document.getElementById('btnMobileSendLegal');
const mobileLegalChatBox = document.getElementById('mobileLegalChatBox');

if (tileLegal && legalOverlay) {
  tileLegal.addEventListener('click', () => legalOverlay.classList.remove('hidden'));
  btnCloseLegal.addEventListener('click', () => legalOverlay.classList.add('hidden'));
}

if (btnMobileVictimSos) {
  btnMobileVictimSos.addEventListener('click', () => {
    legalOverlay.classList.add('hidden');
    executeEmergencySos();
  });
}

// 2. Main Stage Panel 5 AI Controls
const aiLegalQueryInput = document.getElementById('aiLegalQueryInput');
const btnSendAiQuery = document.getElementById('btnSendAiQuery');
const btnSimulateVoice = document.getElementById('btnSimulateVoice');
const btnClearChat = document.getElementById('btnClearChat');
const btnAiTriggerSos = document.getElementById('btnAiTriggerSos');
const aiConversationStream = document.getElementById('aiConversationStream');
const knowledgeTabsBar = document.getElementById('knowledgeTabsBar');
const kTabs = document.querySelectorAll('.k-tab');
const kTabPanes = document.querySelectorAll('.k-tab-pane');

if (btnAiTriggerSos) {
  btnAiTriggerSos.addEventListener('click', () => {
    executeEmergencySos();
  });
}

// Knowledge Tabs Switcher
kTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    kTabs.forEach((t) => t.classList.remove('active'));
    kTabPanes.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const targetPaneId = `pane-${tab.getAttribute('data-ktab')}`;
    const targetPane = document.getElementById(targetPaneId);
    if (targetPane) targetPane.classList.add('active');
  });
});

function switchKnowledgeTab(tabKey) {
  const targetTab = document.querySelector(`.k-tab[data-ktab="${tabKey}"]`);
  if (targetTab) {
    kTabs.forEach((t) => t.classList.remove('active'));
    kTabPanes.forEach((p) => p.classList.remove('active'));
    targetTab.classList.add('active');
    const targetPane = document.getElementById(`pane-${tabKey}`);
    if (targetPane) targetPane.classList.add('active');
  }
}

// Clear Chat to Default
if (btnClearChat) {
  btnClearChat.addEventListener('click', () => {
    aiConversationStream.innerHTML = `
      <div class="chat-msg msg-ai">
        <div class="msg-meta">
          <span class="msg-sender">SAFECIRCLE AI LEGAL ADVOCATE</span>
          <span class="msg-time">Just now</span>
        </div>
        <div class="msg-content">
          <p><strong>Namaste. I am your SafeCircle AI Legal & Victim Shield.</strong></p>
          <p>Ask any question on the Constitution of India (Articles 14, 15(3), 21, 39A), anti-rape laws (BNS 64 / IPC 376), Zero FIR mandates, or tap a fast prompt below if you or someone you know has been assaulted.</p>
        </div>
      </div>
    `;
  });
}

// Helper: Format AI markdown-style text to clean HTML
function formatAiTextToHtml(rawText) {
  let html = rawText
    .replace(/^### (.*$)/gim, '<h3 style="color:#ffffff; font-size:13px; margin-bottom:8px;">$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4 style="color:var(--cyan-primary); font-size:12px; margin:10px 0 6px 0;">$1</h4>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`(.*?)`/gim, '<code>$1</code>')
    .replace(/\n\n/gim, '</p><p>')
    .replace(/\n- (.*)/gim, '<li>$1</li>');

  if (html.includes('<li>')) {
    html = html.replace(/(<li>.*<\/li>)/gis, '<ul>$1</ul>');
  }
  return `<p>${html}</p>`;
}

// Core Legal Knowledge Engine
function generateLegalResponse(query) {
  const q = query.toLowerCase().trim();

  // 1. VICTIM CRISIS / ACTIVE ASSAULT INQUIRY
  if (
    q.includes('help') ||
    q.includes('assault') ||
    q.includes('rape') && (q.includes('me') || q.includes('was') || q.includes('now') || q.includes('attack') || q.includes('happened')) ||
    q.includes('danger') ||
    q.includes('scared') ||
    q.includes('following me') ||
    q.includes('what to do after')
  ) {
    return {
      isVictimHelp: true,
      text: `### 🛡️ Immediate Victim Assistance & Survivor Protection Protocol\n\n` +
        `**You are safe with SafeCircle. What happened is not your fault, and you are not alone.** Take a breath. Here are your vital, legally protected next steps:\n\n` +
        `#### 🚨 6-Step Action Plan:\n` +
        `1. **Immediate Physical Safety**: If the perpetrator is nearby, call \`112\` immediately or tap the red SOS button. Move to a well-lit public space, ATM, or shelter.\n` +
        `2. **Preserve Forensic DNA (Golden Hours)**: Do NOT shower, wash, bathe, or brush teeth yet. Place worn clothing in clean dry **PAPER bags** (not plastic). Vital for DNA forensics under Section 164A CrPC / Sec 184 BNSS.\n` +
        `3. **Free Emergency Medical Treatment (Section 357C CrPC)**: ALL hospitals (private and government) are mandated by law to provide 100% free emergency medical treatment, HIV Post-Exposure Prophylaxis (PEP within 72 hrs), and emergency contraception.\n` +
        `4. **Absolute Refusal of Two-Finger Test**: Strictly declared unconstitutional and illegal by the Supreme Court under Article 21 (*Lillu v. State of Haryana* & *State of Jharkhand 2022*). Refuse firmly; doctors face prosecution for conducting it.\n` +
        `5. **Lodge a Zero FIR (Section 154 CrPC / Section 173 BNSS)**: File at ANY police station in India without jurisdictional refusal. Refusing officers face up to 2 years prison under Section 166A IPC / Section 199 BNS. Demand a free signed copy.\n` +
        `6. **Appoint Free Legal Aid Advocate (Article 39A)**: Call NALSA helpline \`15100\`. You are entitled to a free, qualified court advocate to oppose bail and claim Nirbhaya Fund compensation.\n\n` +
        `#### 📞 24/7 National Emergency Helplines:\n` +
        `- **National Police Emergency**: \`112\` (Toll-Free)\n` +
        `- **Women Helpline**: \`1091\` (Toll-Free)\n` +
        `- **Women in Distress & Sakhi Centres**: \`181\` (Toll-Free)\n` +
        `- **NALSA Free Legal Aid**: \`15100\` (Toll-Free)`
    };
  }

  // 2. CONSTITUTIONAL PROVISIONS (Article 21, 14, 15(3), 39A, 32, 226)
  if (q.includes('21') || q.includes('dignity') || q.includes('bodily') || q.includes('constitution') || q.includes('fundamental right')) {
    return {
      isVictimHelp: false,
      text: `### 🏛️ Constitution of India — Article 21 & Women's Bodily Dignity\n\n` +
        `**Article 21** guarantees the fundamental Right to Life and Personal Liberty. The Supreme Court has repeatedly expanded this to include physical autonomy, sexual privacy, and living free from violence.\n\n` +
        `#### ⚖️ Key Constitutional Principles Established by Supreme Court:\n` +
        `- **Bodily Integrity & Autonomy**: In *Justice K.S. Puttaswamy (2017)*, the 9-judge Constitution Bench held that bodily autonomy and privacy are core elements of Article 21. No person or authority can violate your physical boundaries.\n` +
        `- **Gender Equality & Safety**: In *Vishaka & Ors v. State of Rajasthan (1997)*, the Supreme Court ruled that gender equality and freedom from sexual harassment are fundamental human rights under Articles 14, 15, and 21.\n` +
        `- **Strict Ban on Two-Finger Test**: In *Lillu @ Rajesh v. State of Haryana (2013)* and *State of Jharkhand v. Shailendra Kumar Rai (2022)*, the Supreme Court ruled that the invasive virginity/two-finger test violates a rape victim’s right to dignity, privacy, and bodily integrity under Article 21. Doctors conducting it are guilty of professional misconduct.\n` +
        `- **Immediate Medical Care Without Police Delay**: In *Parmanand Katara (1989)*, the SC affirmed that every injured citizen has an absolute right to immediate emergency medical care without waiting for police clearance.\n` +
        `- **Constitutional Writs (Articles 32 & 226)**: If the police refuse to investigate or shield accused persons, victims have the right to file direct Writ Petitions before the High Court (Art 226) or Supreme Court (Art 32) for a court-monitored investigation or transfer to SIT/CBI.`
    };
  }

  // 3. ZERO FIR & POLICE ACCOUNTABILITY (Sec 154 CrPC, Sec 173 BNSS, Sec 166A IPC)
  if (q.includes('zero fir') || q.includes('police refuse') || q.includes('fir') || q.includes('station')) {
    return {
      isVictimHelp: false,
      text: `### 🚔 Zero FIR Mandate & Police Criminal Accountability\n\n` +
        `**What is a Zero FIR?**\n` +
        `Under Section 154 CrPC (now **Section 173 BNSS 2023**), a Zero FIR allows a victim to register an FIR at **ANY police station in India**, irrespective of where the crime took place. The station cannot refuse on grounds that the crime scene lies outside its jurisdiction. It is registered under serial number '0' and immediately forwarded to the jurisdictional station after starting preliminary emergency inquiry.\n\n` +
        `#### ⚖️ Supreme Court Mandate (*Lalita Kumari v. Govt of U.P. 2014*):\n` +
        `The 5-judge Supreme Court Constitution Bench held that registration of an FIR is **MANDATORY** under Section 154 if the information discloses commission of a cognizable offence like rape or sexual assault. No preliminary inquiry is permitted to delay the FIR.\n\n` +
        `#### 🚨 Criminal Punishment for Police Refusing FIR (Section 166A IPC / Section 199 BNS):\n` +
        `Any police officer or station in-charge who fails to record an FIR for rape, molestation, or sexual harassment commits a cognizable offence under **Section 166A(c) IPC / Section 199 BNS**, punishable with **6 months to 2 years rigorous imprisonment** and fine.\n\n` +
        `#### 📋 Non-Negotiable Procedural Rights:\n` +
        `- Right to statement recorded by a **woman police officer**.\n` +
        `- Right to receive a **free, signed copy of the FIR** on the spot (Section 154(2) CrPC).\n` +
        `- In-camera statement recording before a Judicial Magistrate under Section 164(5A) CrPC / Sec 183 BNSS.`
    };
  }

  // 4. PENAL CODE & BNS SECTIONS (BNS 64 vs IPC 376, Gang rape BNS 70, False Promise BNS 69)
  if (q.includes('bns') || q.includes('376') || q.includes('64') || q.includes('penalty') || q.includes('punishment') || q.includes('rape law')) {
    return {
      isVictimHelp: false,
      text: `### ⚖️ Anti-Rape Laws: IPC vs Bharatiya Nyaya Sanhita (BNS 2023)\n\n` +
        `With the new criminal laws effective from July 1, 2024, sexual offences are categorized with enhanced statutory penalties:\n\n` +
        `| Crime Description | IPC Section | BNS (2023) Section | Prescribed Punishment |\n` +
        `| :--- | :--- | :--- | :--- |\n` +
        `| **Rape (Non-consensual)** | Section 376 | **Section 64** | Rigorous imprisonment **10 years to Life** + Fine |\n` +
        `| **Gang Rape** | Section 376D | **Section 70** | Rigorous imprisonment **20 years to Natural Life or Death** |\n` +
        `| **Deceitful Promise of Marriage** | Previously Sec 376/417 | **Section 69 (New)** | Imprisonment up to **10 years** + Fine |\n` +
        `| **Assault to Outrage Modesty** | Section 354 | **Section 74** | Imprisonment **1 to 5 years** + Fine (Non-bailable) |\n` +
        `| **Sexual Harassment / Lewd Remarks** | Section 354A | **Section 75** | Rigorous imprisonment up to **3 years** |\n` +
        `| **Voyeurism (Secret Cameras)** | Section 354C | **Section 77** | Imprisonment **1 to 3 years** (up to 7 for repeat) |\n` +
        `| **Stalking (Physical & Cyber)** | Section 354D | **Section 78** | Imprisonment up to **3 years** (up to 5 for repeat) |\n` +
        `| **Leaking Victim Identity** | Section 228A | **Section 72** | Imprisonment up to **2 years** + Fine |\n\n` +
        `*Note: Under both IPC and BNS, fines collected from convicted perpetrators are ordered to be paid directly to the survivor to cover medical treatment, rehabilitation, and legal expenses.*`
    };
  }

  // 5. MEDICAL EXAMINATION RIGHTS (Sec 164A / 357C)
  if (q.includes('medical') || q.includes('hospital') || q.includes('164a') || q.includes('357c') || q.includes('doctor')) {
    return {
      isVictimHelp: false,
      text: `### 🏥 Medical Rights & Forensic Evidence Protocol\n\n` +
        `#### 1. Mandatory Free Emergency Care in ALL Hospitals (Section 357C CrPC / Sec 397 BNSS):\n` +
        `- All hospitals, whether run by government, municipal bodies, or **PRIVATE hospital chains**, are mandated by law to provide immediate first-aid and medical treatment **100% free of cost**.\n` +
        `- Private hospitals CANNOT demand deposit money, advance fees, or refuse admission before an FIR is lodged.\n` +
        `- Hospital management turning away a victim faces up to 1 year imprisonment under Section 166B IPC / Section 200 BNS.\n\n` +
        `#### 2. Forensic Medical Examination (Section 164A CrPC / Sec 184 BNSS):\n` +
        `- Must be conducted by a registered female medical practitioner (or in presence of a female staff member).\n` +
        `- Requires explicit, voluntary consent of the victim.\n` +
        `- A complete, free copy of the medical examination report must be handed over to the survivor immediately.\n\n` +
        `#### 3. Strict Supreme Court Prohibition of Two-Finger Test:\n` +
        `- The archaic hymen/two-finger test is declared illegal and medically unscientific. Survivors have an absolute legal right to decline it.`
    };
  }

  // 6. FREE LEGAL AID (Article 39A & NALSA)
  if (q.includes('legal aid') || q.includes('39a') || q.includes('lawyer') || q.includes('nalsa') || q.includes('court') || q.includes('free')) {
    return {
      isVictimHelp: false,
      text: `### 🤝 Article 39A & Free Legal Aid for Survivors\n\n` +
        `Under **Article 39A** of the Constitution of India and the Legal Services Authorities Act 1987, the State guarantees free, competent legal services to victims of sexual assault and domestic violence, regardless of financial means.\n\n` +
        `#### ⚖️ How to Access Free Legal Aid:\n` +
        `1. **Toll-Free Helpline**: Dial \`15100\` (National Legal Services Authority - NALSA).\n` +
        `2. **District Legal Services Authority (DLSA)**: Located at every District Court in India. A Front Office operates 24/7 to assign a dedicated advocate.\n` +
        `3. **Police Obligation**: The investigating officer is duty-bound to inform the victim of her right to a DLSA legal aid counsel.\n` +
        `4. **Advocate Scope**: Your assigned DLSA advocate represents you in opposing bail applications filed by the accused, attends witness depositions, and files applications for interim compensation under **Section 357A CrPC / Nirbhaya Fund**.`
    };
  }

  // Default General Summary
  return {
    isVictimHelp: false,
    text: `### ⚖️ SafeCircle Constitutional & Legal Protection Engine\n\n` +
      `Here is a summary of sovereign constitutional and legal guarantees regarding rape and women's safety in India:\n\n` +
      `- **Article 21 (Bodily Autonomy & Dignity)**: SC judgments in *Puttaswamy (2017)*, *Vishaka (1997)*, and *Lillu (2013)* affirm that physical integrity and freedom from sexual assault are inviolable fundamental rights.\n` +
      `- **Article 14 & 15(3)**: Equality before law combined with affirmative state protective power for women.\n` +
      `- **Article 39A**: Absolute entitlement to free legal counsel through DLSA (Helpline: 15100).\n` +
      `- **Section 64 BNS / Section 376 IPC**: Rape is punishable by a minimum of 10 years up to life imprisonment.\n` +
      `- **Section 173 BNSS / Section 154 CrPC**: Mandatory Zero FIR at any police station; police refusal is punishable under Section 199 BNS / Section 166A IPC.\n` +
      `- **Section 357C CrPC**: Free emergency medical care across all private and public hospitals.\n\n` +
      `*Feel free to ask a specific question on any section, FIR rules, or victim assistance.*`
  };
}

// Send Query in Main Stage Panel 5
function sendAiLegalQuery(queryText) {
  const query = (queryText || aiLegalQueryInput.value).trim();
  if (!query) return;

  // Append user message
  const userMsgDiv = document.createElement('div');
  userMsgDiv.className = 'chat-msg msg-user';
  userMsgDiv.innerHTML = `
    <div class="msg-meta">
      <span class="msg-sender">YOU</span>
      <span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    <div class="msg-content"><p>${query}</p></div>
  `;
  aiConversationStream.appendChild(userMsgDiv);
  if (!queryText) aiLegalQueryInput.value = '';
  aiConversationStream.scrollTop = aiConversationStream.scrollHeight;

  // Show temporary typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-msg msg-ai typing-msg';
  typingDiv.innerHTML = `
    <div class="msg-meta">
      <span class="msg-sender">SAFECIRCLE AI LEGAL ADVOCATE</span>
      <span class="msg-time">Analyzing Legal Sections...</span>
    </div>
    <div class="msg-content"><p><em>Cross-referencing Constitution of India, BNS 2023 & CrPC...</em></p></div>
  `;
  aiConversationStream.appendChild(typingDiv);
  aiConversationStream.scrollTop = aiConversationStream.scrollHeight;

  // Process response (call backend API if reachable, fallback to local engine)
  setTimeout(async () => {
    let result = null;
    try {
      const res = await fetch('http://localhost:4000/api/ai/legal-clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        const data = await res.json();
        result = {
          isVictimHelp: data.isVictimAssistance,
          text: data.answer,
        };
      }
    } catch (e) {
      // Backend not running locally -> local engine handles seamlessly
    }

    if (!result) {
      result = generateLegalResponse(query);
    }

    typingDiv.remove();

    const aiMsgDiv = document.createElement('div');
    aiMsgDiv.className = `chat-msg msg-ai ${result.isVictimHelp ? 'victim-alert-msg' : ''}`;
    aiMsgDiv.innerHTML = `
      <div class="msg-meta">
        <span class="msg-sender">${result.isVictimHelp ? '🚨 SAFECIRCLE EMERGENCY VICTIM ASSIST' : 'SAFECIRCLE AI LEGAL ADVOCATE'}</span>
        <span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="msg-content">${formatAiTextToHtml(result.text)}</div>
    `;
    aiConversationStream.appendChild(aiMsgDiv);
    aiConversationStream.scrollTop = aiConversationStream.scrollHeight;

    if (result.isVictimHelp) {
      switchKnowledgeTab('victim-checklist');
    }
  }, 350);
}

// Bind Main Stage Input
if (btnSendAiQuery && aiLegalQueryInput) {
  btnSendAiQuery.addEventListener('click', () => sendAiLegalQuery());
  aiLegalQueryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAiLegalQuery();
  });
}

// Fast Suggestion Chips in Main Stage
document.querySelectorAll('.qs-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const prompt = chip.getAttribute('data-prompt');
    if (prompt) sendAiLegalQuery(prompt);
  });
});

// Voice Simulation Button
if (btnSimulateVoice && aiLegalQueryInput) {
  btnSimulateVoice.addEventListener('click', () => {
    const voicePrompts = [
      'What are my rights under Article 21 if police refuse my FIR?',
      'I was assaulted — what are the immediate steps I should take right now?',
      'What is the penalty for rape under BNS 64 vs IPC 376?',
      'Can a private hospital refuse free treatment under Section 357C?',
      'How can I get free legal aid under Article 39A?'
    ];
    const picked = voicePrompts[Math.floor(Math.random() * voicePrompts.length)];
    aiLegalQueryInput.value = '';
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < picked.length) {
        aiLegalQueryInput.value += picked[idx];
        idx++;
      } else {
        clearInterval(interval);
        setTimeout(() => sendAiLegalQuery(picked), 300);
      }
    }, 20);
  });
}

// Mobile in-app chat engine
function sendMobileLegalQuery(queryText) {
  const query = (queryText || mobileLegalInput.value).trim();
  if (!query || !mobileLegalChatBox) return;

  const userDiv = document.createElement('div');
  userDiv.className = 'm-msg user';
  userDiv.textContent = query;
  mobileLegalChatBox.appendChild(userDiv);
  if (!queryText) mobileLegalInput.value = '';
  mobileLegalChatBox.scrollTop = mobileLegalChatBox.scrollHeight;

  setTimeout(() => {
    const result = generateLegalResponse(query);
    const aiDiv = document.createElement('div');
    aiDiv.className = `m-msg ai ${result.isVictimHelp ? 'victim' : ''}`;
    aiDiv.innerHTML = `
      <div class="m-msg-header">${result.isVictimHelp ? '🚨 VICTIM ASSIST' : '🤖 AI LEGAL ADVOCATE'}</div>
      <div>${result.isVictimHelp ? '<strong>Emergency Protocol:</strong> 1. Reach safe place 2. Do not bathe/wash (preserve DNA) 3. Free hospital care (Sec 357C) 4. Zero FIR at any station (Sec 154) 5. Free lawyer (NALSA 15100). Dial 112 or trigger SOS.' : result.text.substring(0, 320) + '...'}</div>
    `;
    mobileLegalChatBox.appendChild(aiDiv);
    mobileLegalChatBox.scrollTop = mobileLegalChatBox.scrollHeight;
  }, 300);
}

if (btnMobileSendLegal && mobileLegalInput) {
  btnMobileSendLegal.addEventListener('click', () => sendMobileLegalQuery());
  mobileLegalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMobileLegalQuery();
  });
}

document.querySelectorAll('.m-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const prompt = chip.getAttribute('data-prompt');
    if (prompt) sendMobileLegalQuery(prompt);
  });
});

