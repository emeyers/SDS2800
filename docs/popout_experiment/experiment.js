/*
 * Pop-out search experiment: web version of interface.psyexp / interface.py.
 *
 * Same design as the PsychoPy version:
 *   5 instruction images -> 6 practice trials with feedback -> CONFIG.nBlocks blocks of
 *   72 trials (random order, no feedback) with a break screen after each -> end screen.
 *
 * Each trial (times from trial start, as in PsychoPy):
 *   0-200 ms blank | 200-400 ms fixation cross | 400-800 ms blank |
 *   800 ms: stimulus for 100 ms, then blank; response window 2 s from stimulus onset.
 *   Z = left side cut off, M = right side cut off. A response ends the trial.
 *   Q ends the current practice/block early (handy for testing).
 *
 * Everything on screen is drawn in requestAnimationFrame callbacks, so the stimulus is
 * shown for a whole number of screen refreshes, and RT is measured from the refresh on
 * which the stimulus appeared.
 *
 * URL options: ?blocks=1 runs a shorter version (e.g. for a quick demo).
 */
'use strict';

// ===================== Settings =====================
const CONFIG = {
  expName: 'interface',          // same as the PsychoPy version (used in the data file name)
  nBlocks: 4,                    // total_num_of_blocks in PsychoPy
  crossOnset: 200,               // ms from trial start
  crossOffset: 400,
  stimOnset: 800,
  stimDuration: 100,             // rounded to a whole number of screen refreshes
  responseWindow: 2000,          // ms from stimulus onset
  instructionMinTime: 1000,      // space bar is ignored for this long on instruction images
  responseKeys: ['z', 'm'],
  quitKey: 'q',
  stimSize: 0.9,                 // stimulus and cross size, as a fraction of screen height
  instrSize: [1.2, 0.9],         // instruction image width/height, as a fraction of screen height
  // Optional: to have data sent to you automatically, create an experiment at
  // https://pipe.jspsych.org (it stores files on OSF) and paste its experiment ID here.
  // Students still get a local copy of their data either way.
  dataPipeExperimentID: '',
};

const urlBlocks = parseInt(new URLSearchParams(location.search).get('blocks'), 10);
if (urlBlocks > 0) CONFIG.nBlocks = urlBlocks;

// ===================== Display =====================
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const messageBox = document.getElementById('message');
const messageInner = messageBox.querySelector('.inner');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function clearScreen() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Draw an image centred, sized in "height units" like PsychoPy (1 = screen height).
function drawImage(img, widthH, heightH) {
  let w = widthH * canvas.height, h = heightH * canvas.height;
  const maxW = 0.98 * canvas.width;          // keep it on screen in narrow windows
  if (w > maxW) { h *= maxW / w; w = maxW; }
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function showImageScreen(img, widthH, heightH) {
  hideMessage();
  clearScreen();
  drawImage(img, widthH, heightH);
}

function showMessage(text, html) {
  clearScreen();
  if (html !== undefined) messageInner.innerHTML = html;
  else messageInner.textContent = text;
  messageBox.style.display = 'flex';
}

function hideMessage() {
  messageBox.style.display = 'none';
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

// Median time between screen refreshes, in ms.
async function measureFrameDuration(nFrames = 60) {
  const deltas = [];
  let prev = await nextFrame();
  for (let i = 0; i < nFrames; i++) {
    const t = await nextFrame();
    deltas.push(t - prev);
    prev = t;
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(nFrames / 2)];
}

// ===================== Keyboard =====================
let keyHandler = null;
let experimentRunning = false;

// Key event time on the same clock as performance.now() and requestAnimationFrame.
function eventTime(e) {
  const now = performance.now();
  return (e.timeStamp > 0 && e.timeStamp <= now + 1) ? e.timeStamp : now;
}

window.addEventListener('keydown', e => {
  if (!experimentRunning) return;
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (key === 'space') e.preventDefault();   // don't scroll the page
  if (e.repeat || !keyHandler) return;
  keyHandler(key, eventTime(e));
});

// Resolves with {key, rt} on the first allowed key pressed after minDelay ms.
function waitForKey(keys, minDelay = 0) {
  const start = performance.now();
  return new Promise(resolve => {
    keyHandler = (key, t) => {
      if (keys.includes(key) && t - start >= minDelay) {
        keyHandler = null;
        resolve({ key, rt: (t - start) / 1000 });
      }
    };
  });
}

// ===================== Images =====================
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + src));
    img.src = src;
  }).then(img => (img.decode ? img.decode().then(() => img, () => img) : img));
}

const images = {};   // path -> Image

async function preloadImages() {
  const paths = ['images/cross.png',
                 ...INSTRUCTION_IMAGES.map(f => 'images/' + f),
                 ...new Set([...PRACTICE_TRIALS, ...MAIN_TRIALS].map(c => c.linux_file_name))];
  const loaded = await Promise.all(paths.map(loadImage));
  paths.forEach((p, i) => { images[p] = loaded[i]; });
}

// ===================== One trial =====================
let frameMs = 1000 / 60;
let nStimFrames = 6;
let currentTrial = null;   // used to flag trials where the tab was hidden

document.addEventListener('visibilitychange', () => {
  if (document.hidden && currentTrial) currentTrial.tabHidden = true;
});

function runTrial(cond) {
  const stimImg = images[cond.linux_file_name];
  const crossImg = images['images/cross.png'];
  const r = { key: null, rt: null, onset: null, stimMs: null, tabHidden: false };
  currentTrial = r;
  hideMessage();

  return new Promise(resolve => {
    const half = frameMs / 2;
    let t0 = null, phase = 'blank1', framesShown = 0, done = false;

    function finish() {
      done = true;
      keyHandler = null;
      currentTrial = null;
      clearScreen();
      resolve(r);
    }

    // The keyboard opens when the stimulus is drawn (PsychoPy: keyboard and image both start at 0.8 s).
    keyHandler = (key, t) => {
      if (r.onset === null) return;
      if (!CONFIG.responseKeys.includes(key) && key !== CONFIG.quitKey) return;
      r.key = key;
      r.rt = (t - r.onset) / 1000;
      finish();
    };

    function frame(now) {
      if (done) return;
      if (t0 === null) { t0 = now; clearScreen(); }
      const t = now - t0;

      if (phase === 'blank1' && t >= CONFIG.crossOnset - half) {
        clearScreen(); drawImage(crossImg, CONFIG.stimSize, CONFIG.stimSize); phase = 'cross';
      } else if (phase === 'cross' && t >= CONFIG.crossOffset - half) {
        clearScreen(); phase = 'blank2';
      } else if (phase === 'blank2' && t >= CONFIG.stimOnset - half) {
        // Drawn now, visible from the next refresh. Provisional onset until that refresh happens.
        clearScreen(); drawImage(stimImg, CONFIG.stimSize, CONFIG.stimSize);
        r.onset = now + frameMs;
        phase = 'stim';
      } else if (phase === 'stim') {
        framesShown++;
        if (framesShown === 1) r.onset = now;               // refresh on which the stimulus appeared
        if (framesShown >= nStimFrames) { clearScreen(); phase = 'offset'; }
      } else if (phase === 'offset') {
        r.stimMs = now - r.onset;                           // refresh on which it disappeared
        phase = 'response';
      }

      if (r.onset !== null && phase !== 'stim' && now - r.onset >= CONFIG.responseWindow) {
        finish();   // no response
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// ===================== Data =====================
const COLUMNS = ['participant', 'date', 'expName', 'phase', 'block', 'trial',
  'distract_or_no_levels', 'target_color_levels', 'cutoff_side_levels', 'target_pos_levels',
  'key_correlate', 'linux_file_name', 'kTrial.keys', 'kTrial.corr', 'kTrial.rt',
  'stim_frames', 'stim_duration_ms', 'frameRate', 'tab_hidden', 'screen_size', 'browser'];

const session = {};
const rows = [];

function recordTrial(phase, block, trialNum, cond, r) {
  const corr = r.key === cond.key_correlate ? 1 : 0;
  rows.push({
    ...session, phase, block, trial: trialNum, ...cond,
    'kTrial.keys': r.key ?? '',
    'kTrial.corr': corr,
    'kTrial.rt': r.rt === null ? '' : r.rt.toFixed(4),
    stim_frames: nStimFrames,
    stim_duration_ms: r.stimMs === null ? '' : r.stimMs.toFixed(1),
    tab_hidden: r.tabHidden ? 1 : 0,
  });
  return corr;
}

function toCSV() {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [COLUMNS.join(','), ...rows.map(row => COLUMNS.map(c => esc(row[c])).join(','))].join('\n') + '\n';
}

function dataFileName() {
  const safeId = session.participant.replace(/[^\w.-]+/g, '_');
  return `${safeId}_${CONFIG.expName}_${session.date}.csv`;
}

function downloadData() {
  const blob = new Blob([toCSV()], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dataFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function sendToDataPipe() {
  const response = await fetch('https://pipe.jspsych.org/api/data/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({ experimentID: CONFIG.dataPipeExperimentID,
                           filename: dataFileName(), data: toCSV() }),
  });
  if (!response.ok) throw new Error('DataPipe returned ' + response.status);
}

// Same format as PsychoPy's data.getDateStr(), e.g. 2026-10-02_14h05.09.123
function dateStr(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
         `${p(d.getHours())}h${p(d.getMinutes())}.${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SIDE_NAMES = { L: 'left', R: 'right' };

// ===================== Experiment flow =====================
async function runExperiment() {
  // Instructions
  for (const file of INSTRUCTION_IMAGES) {
    showImageScreen(images['images/' + file], ...CONFIG.instrSize);
    await waitForKey(['space'], CONFIG.instructionMinTime);
  }
  showMessage('We ask you to do a few practice trials before you start the main task. ' +
              'Press the space bar to continue.');
  await waitForKey(['space']);

  // Practice, with feedback
  const practice = shuffle(PRACTICE_TRIALS);
  for (let i = 0; i < practice.length; i++) {
    const cond = practice[i];
    const r = await runTrial(cond);
    const corr = recordTrial('practice', 0, i + 1, cond, r);
    let text;
    if (corr) {
      text = 'Correct';
    } else {
      text = (r.key === null ? 'No response' : 'Wrong') +
             `\n\nThe cutoff side of the target diamond was ${SIDE_NAMES[cond.cutoff_side_levels]}. ` +
             `You should have pressed ${cond.key_correlate.toUpperCase()}.`;
    }
    showMessage(text + '\n\nTo proceed to the next image, press the space bar.');
    await waitForKey(['space']);
    if (r.key === CONFIG.quitKey) break;
  }

  showMessage('The main task is coming up.\nDuring the main task you will not get feedback on ' +
              'whether your response was correct.\nPlease be as fast and accurate as possible.' +
              '\n\nPress the space bar to continue.');
  await waitForKey(['space']);

  // Main blocks
  for (let block = 1; block <= CONFIG.nBlocks; block++) {
    const trials = shuffle(MAIN_TRIALS);
    let nCorrect = 0, nDone = 0;
    for (let i = 0; i < trials.length; i++) {
      const r = await runTrial(trials[i]);
      nCorrect += recordTrial('main', block, i + 1, trials[i], r);
      nDone++;
      if (r.key === CONFIG.quitKey) break;
    }
    const pct = Math.round(100 * nCorrect / nDone);
    const left = CONFIG.nBlocks - block;
    showMessage(`You got ${pct}% correct in the past section.\n\n` +
                `${block} section(s) finished! ` +
                (left > 0 ? `${left} more section(s) to go! Take a short break as needed. ` +
                            'Press the space bar to start the next section.'
                          : 'Press the space bar to continue.'));
    await waitForKey(['space']);
  }

  await finishExperiment();
}

function median(xs) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summaryTableHTML() {
  const main = rows.filter(r => r.phase === 'main');
  const line = (label, subset) => {
    const acc = subset.length ? Math.round(100 * subset.filter(r => r['kTrial.corr']).length / subset.length) : NaN;
    const rt = median(subset.filter(r => r['kTrial.corr']).map(r => Number(r['kTrial.rt'])));
    return `<tr><td>${label}</td><td>${subset.length}</td><td>${isNaN(acc) ? '–' : acc + '%'}</td>` +
           `<td>${isNaN(rt) ? '–' : Math.round(rt * 1000) + ' ms'}</td></tr>`;
  };
  return '<table><tr><th></th><th>Trials</th><th>Accuracy</th><th>Median RT (correct)</th></tr>' +
         line('Single diamond', main.filter(r => r.distract_or_no_levels === 0)) +
         line('With distractors', main.filter(r => r.distract_or_no_levels === 1)) +
         '</table>';
}

async function finishExperiment() {
  showMessage('You are done. Thank you!\n\nPress the space bar to save your data file.');
  await waitForKey(['space']);
  downloadData();   // the key press counts as a user action, so browsers allow the download

  experimentRunning = false;
  document.body.classList.remove('running');
  document.body.classList.add('finished');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

  const fileName = dataFileName().replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const render = pipeStatus => showMessage(null,
    `Your data was saved as <b>${fileName}</b> (check your Downloads folder).` +
    (pipeStatus ? `<br>${pipeStatus}` : '') +
    '<br><button id="download-again">Download data again</button>' +
    summaryTableHTML());
  const wire = () => { document.getElementById('download-again').onclick = downloadData; };

  if (CONFIG.dataPipeExperimentID) {
    render('Uploading a copy to your instructor…'); wire();
    try {
      await sendToDataPipe();
      render('A copy was also sent to your instructor.');
    } catch (err) {
      console.error(err);
      render('The automatic upload failed, so please send your downloaded file to your instructor.');
    }
  } else {
    render();
  }
  wire();
}

// ===================== Start page =====================
async function setup() {
  const form = document.getElementById('start-form');
  const button = document.getElementById('start-button');
  const status = document.getElementById('status');

  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) {
    document.getElementById('touch-warning').style.display = 'block';
  }

  try {
    await preloadImages();
  } catch (err) {
    status.textContent = err.message + '. Try reloading the page.';
    status.classList.add('error');
    return;
  }
  button.disabled = false;
  button.textContent = 'Start';

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const participant = document.getElementById('participant').value.trim();
    if (!participant) return;
    button.disabled = true;

    try { await document.documentElement.requestFullscreen(); } catch (err) { /* continue windowed */ }
    document.getElementById('start').style.display = 'none';
    document.body.classList.add('running');
    resizeCanvas();
    clearScreen();
    showMessage('Getting ready…');

    frameMs = await measureFrameDuration();
    nStimFrames = Math.max(1, Math.round(CONFIG.stimDuration / frameMs));
    Object.assign(session, {
      participant,
      date: dateStr(),
      expName: CONFIG.expName,
      frameRate: (1000 / frameMs).toFixed(1),
      screen_size: `${screen.width}x${screen.height}`,
      browser: navigator.userAgent,
    });

    experimentRunning = true;
    runExperiment().catch(err => {
      console.error(err);
      showMessage('Something went wrong: ' + err.message + '\n\nPress the space bar to save the data collected so far.');
      waitForKey(['space']).then(downloadData);
    });
  });
}

setup();
