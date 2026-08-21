// Módulo de alarma: sonido (Web Audio API) + vibración.
// Funciona solo con la app abierta. El sonido se genera por código,
// no necesita archivo externo.

let audioCtx = null;
let habilitado = true;

// La reproducción de audio requiere que el usuario haya interactuado
// con la página al menos una vez (regla de los navegadores). Por eso
// "desbloqueamos" el audio en el primer toque.
let desbloqueado = false;

export function desbloquearAudio() {
  if (desbloqueado) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    desbloqueado = true;
  } catch (e) {
    // Si falla, no pasa nada; simplemente no habrá sonido.
  }
}

export function setAlarmaHabilitada(v) {
  habilitado = v;
  try { localStorage.setItem("itask_alarma", v ? "1" : "0"); } catch (e) {}
}

export function alarmaHabilitada() {
  try {
    const v = localStorage.getItem("itask_alarma");
    if (v !== null) habilitado = v === "1";
  } catch (e) {}
  return habilitado;
}

// Reproduce un pequeño patrón de tonos tipo "campana de alerta"
function reproducirTono(prioridad = false) {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();

  const ahora = audioCtx.currentTime;
  // Prioridad: 3 tonos; normal: 2 tonos
  const notas = prioridad ? [880, 1046, 880, 1046] : [784, 988];
  notas.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ahora + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

// Vibración (Android soporta; iPhone la ignora silenciosamente)
function vibrar(prioridad = false) {
  if (!("vibrate" in navigator)) return;
  try {
    navigator.vibrate(prioridad ? [200, 100, 200, 100, 200] : [150, 80, 150]);
  } catch (e) {}
}

// Dispara la alarma completa (sonido + vibración)
export function sonarAlarma(prioridad = false) {
  if (!alarmaHabilitada()) return;
  reproducirTono(prioridad);
  vibrar(prioridad);
}
