/* ==================== Posture & Gesture Coach (free, on-device) ====================

What it does
- Uses Human (client-side) to sample your video (recorded or uploaded) at ~2 FPS
- Extracts pose/face/hands landmarks and computes:
  * Head tilt (°), slouch/forward-head posture, shoulder symmetry
  * Hand visibility, gesture activity, arm openness/closedness
  * Movement pacing (too static vs. too fidgety)
- Produces timestamped tips that you can align with your speech
- Draws an optional skeleton overlay on top of the video

Optional
- If you paste a Gemini API key, it sends ONLY your transcript + compact posture summary
  to get additional coaching text (no video is uploaded; all vision runs locally).

============================================================================= */

const PostureCoach = (() => {
  // Tunables
  const SAMPLE_FPS = 2;        // analysis framerate
  const MIN_SECONDS = 3;       // guard for super short clips
  const HEAD_TILT_WARN = 8;    // degrees
  const SLOUCH_WARN = 10;      // degrees (neck->torso angle forward)
  const SHOULDER_DIFF_WARN = 0.04; // normalized width diff
  const FIDGET_WARN = 0.35;    // per-second movement variance
  const HANDS_LOST_WARN = 0.55;// fraction of seconds without both hands visible
  const GESTURE_LOW_WARN = 0.08; // gestures/sec too low
  const GESTURE_HIGH_WARN = 0.6; // gestures/sec too high

  let human = null;
  let overlayEnabled = false;
  let analyzing = false;

  // Utils
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function getActiveVideoEl() {
    const v = $('videoPreview');
    return v;
  }

  function ensureOverlayCanvasSized(video) {
    const canvas = $('poseOverlay');
    if (!canvas) return null;
    const rect = video.getBoundingClientRect();
    // Match rendered CSS size for overlay
    canvas.width = video.videoWidth || Math.max(640, Math.round(rect.width));
    canvas.height = video.videoHeight || Math.max(360, Math.round(rect.height));
    return canvas.getContext('2d');
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function angleDeg(ax, ay, bx, by) {
    const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
    return ang;
  }

  function torsoAngle(keypoints) {
    // Use shoulders and hips to estimate lean (forward-head/slouch proxy)
    const lShoulder = keypoints.find(k => k.part === 'leftShoulder');
    const rShoulder = keypoints.find(k => k.part === 'rightShoulder');
    const lHip = keypoints.find(k => k.part === 'leftHip');
    const rHip = keypoints.find(k => k.part === 'rightHip');
    if (!(lShoulder && rShoulder && lHip && rHip)) return null;

    const midShoulder = { x: (lShoulder.x + rShoulder.x)/2, y: (lShoulder.y + rShoulder.y)/2 };
    const midHip = { x: (lHip.x + rHip.x)/2, y: (lHip.y + rHip.y)/2 };
    // Angle of vector hip->shoulder relative to vertical
    const ang = angleDeg(midHip.x, midHip.y, midShoulder.x, midShoulder.y);
    const rel = Math.abs(90 - Math.abs(ang)); // 0 is upright, higher = lean
    return rel;
  }

  function headTiltDeg(keypoints) {
    const lEar = keypoints.find(k => k.part === 'leftEar') || keypoints.find(k => k.part === 'leftEyeOuter');
    const rEar = keypoints.find(k => k.part === 'rightEar') || keypoints.find(k => k.part === 'rightEyeOuter');
    const nose = keypoints.find(k => k.part === 'nose');
    if (!(lEar && rEar && nose)) return null;
    // Angle of ear->ear vs horizontal
    const deg = Math.abs(angleDeg(lEar.x, lEar.y, rEar.x, rEar.y));
    const tilt = Math.min(Math.abs(180 - deg), Math.abs(deg)); // deviation from horizontal
    return tilt;
    // (Smaller deviation -> more level; big deviation -> head tilt)
  }

  function shoulderSymmetry(keypoints) {
    const lShoulder = keypoints.find(k => k.part === 'leftShoulder');
    const rShoulder = keypoints.find(k => k.part === 'rightShoulder');
    if (!(lShoulder && rShoulder)) return null;
    return Math.abs(lShoulder.y - rShoulder.y); // normalized in [0..1] coordinates
  }

  function handsVisible(hands) {
    // True if both wrists found with decent score
    const left = hands.some(h => h.label === 'left' && h.score > 0.3);
    const right = hands.some(h => h.label === 'right' && h.score > 0.3);
    return { left, right, both: left && right };
  }

  function gestureActivity(handsSeries) {
    // crude: count significant wrist movement between frames
    let moves = 0, checks = 0;
    for (let i = 1; i < handsSeries.length; i++) {
      const prev = handsSeries[i-1];
      const curr = handsSeries[i];
      ['left', 'right'].forEach(side => {
        const p = prev.find(h => h.label === side);
        const c = curr.find(h => h.label === side);
        if (p && c) {
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d > 0.025) moves++;
          checks++;
        }
      });
    }
    return checks ? (moves / checks) : 0;
  }

  function movementVariance(series) {
    // track nose movement variance as fidget proxy
    const arr = series.map(kps => {
      const nose = kps.find(k => k.part === 'nose');
      return nose ? [nose.x, nose.y] : null;
    }).filter(Boolean);
    if (arr.length < 3) return 0;
    const mean = arr.reduce((a,b)=>[a[0]+b[0], a[1]+b[1]],[0,0]).map(v=>v/arr.length);
    const varSum = arr.reduce((s,[x,y]) => s + Math.pow(x-mean[0],2) + Math.pow(y-mean[1],2), 0);
    return varSum / arr.length;
  }

  function drawOverlay(ctx, res) {
    if (!ctx || !overlayEnabled) return;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0,0,width,height);
    const kp = res?.body?.keypoints || [];
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    kp.forEach(k=>{
      if (k.score > 0.4) {
        ctx.beginPath();
        ctx.arc(k.x*width, k.y*height, 3, 0, Math.PI*2);
        ctx.fill();
      }
    });
    // Simple lines (shoulders / arms)
    function link(a,b){
      const A = kp.find(k=>k.part===a), B = kp.find(k=>k.part===b);
      if (A && B && A.score>0.4 && B.score>0.4) {
        ctx.beginPath();
        ctx.moveTo(A.x*width, A.y*height);
        ctx.lineTo(B.x*width, B.y*height);
        ctx.stroke();
      }
    }
    ['leftShoulder-rightShoulder','leftShoulder-leftElbow','leftElbow-leftWrist',
     'rightShoulder-rightElbow','rightElbow-rightWrist',
     'leftShoulder-leftHip','rightShoulder-rightHip','leftHip-rightHip'
    ].forEach(pair=>{
      const [a,b]=pair.split('-'); link(a,b);
    });
  }

  async function ensureHuman() {
    if (human) return human;
    human = new Human.Human({
      backend: 'webgl',
      filter: { enabled: true },
      modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models',
      face: { enabled: true },
      body: { enabled: true, modelPath: 'blazepose.json' },
      hand: { enabled: true },
    });
    await human.load();
    return human;
  }

  async function analyze() {
    if (analyzing) return;
    const video = getActiveVideoEl();
    if (!video || (!video.src && !video.srcObject)) {
      $('videoStatus').textContent = 'Load or record a video first.';
      return;
    }
    analyzing = true;
    $('postureResults').innerHTML = 'Analyzing posture & gestures (on-device)…';
    $('videoStatus').textContent = 'Analyzing posture & gestures (free, private)…';

    const h = await ensureHuman();

    // Make sure we have duration to sample
    const duration = isFinite(video.duration) && video.duration > 0 ? video.duration : Math.max( $('videoTimer').textContent ? 1 : 0, MIN_SECONDS );
    const totalSamples = Math.max( Math.floor(duration * SAMPLE_FPS), 6 );

    // Prepare drawing
    const ctx = ensureOverlayCanvasSized(video);
    if (ctx && overlayEnabled) {
      $('poseOverlay').style.display = 'block';
      $('poseOverlay').style.maxHeight = '50vh';
    }

    // If the video is playing, we sample live. If not, try to play silently.
    try { await video.play(); } catch (_) {}

    const samples = [];
    const handsSeries = [];
    const keySeries = [];

    // We sample by timeupdate seeking when possible
    let i = 0;
    const stepSec = duration / totalSamples;

    // If video is seekable, seek to frames; else just read current
    const seekable = video.seekable && video.seekable.length > 0 && isFinite(duration);

    async function sampleAt(t) {
      if (seekable) {
        video.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
        await new Promise(r => video.onseeked = () => r());
      }
      const res = await h.detect(video);

      // body keypoints normalized
      const bodyK = (res?.body?.keypoints || []).map(p => ({ part: p.part, x: p.normX ?? p.x, y: p.normY ?? p.y, score: p.score ?? 0 }));
      keySeries.push(bodyK);

      // hands simplified (use wrist keypoints if available)
      const hands = [];
      (res?.hand || []).forEach(hand => {
        // estimate wrist as average of first few keypoints if needed
        const kps = hand.keypoints || [];
        if (kps.length) {
          const wx = kps[0].x, wy = kps[0].y;
          hands.push({ label: hand.label || 'unknown', x: kps[0].normX ?? wx, y: kps[0].normY ?? wy, score: hand.score ?? 0.5 });
        }
      });
      handsSeries.push(hands);

      // metrics
      const tilt = headTiltDeg(bodyK);
      const lean = torsoAngle(bodyK);
      const sh = shoulderSymmetry(bodyK);
      const hv = handsVisible(hands);

      const stamp = clamp(t, 0, duration);
      samples.push({
        t: stamp,
        headTilt: tilt ?? 0,
        slouch: lean ?? 0,
        shoulderOffset: sh ?? 0,
        handsBoth: hv.both,
        handsLeft: hv.left,
        handsRight: hv.right,
        raw: { bodyK }
      });

      drawOverlay(ctx, res);
    }

    // Run samples
    for (i = 0; i < totalSamples; i++) {
      const t = i * stepSec;
      // eslint-disable-next-line no-await-in-loop
      await sampleAt(t);
    }

    // Aggregate
    const secCount = Math.max(1, Math.round(duration));
    const handsLostFrac = 1 - (samples.filter(s => s.handsBoth).length / samples.length);
    const headTiltAvg = samples.reduce((a,s)=>a+s.headTilt,0)/samples.length;
    const slouchAvg = samples.reduce((a,s)=>a+s.slouch,0)/samples.length;
    const shoulderAvg = samples.reduce((a,s)=>a+s.shoulderOffset,0)/samples.length;
    const mvVar = movementVariance(keySeries);
    const gestRate = gestureActivity(handsSeries) * SAMPLE_FPS; // rough gestures/sec

    // Timestamped suggestions (pick the worst slices)
    function topMoments(fn, label, direction='high') {
      const scored = samples.map(s => ({ t: s.t, v: fn(s) ?? 0 }));
      const sorted = scored.sort((a,b) => direction==='high' ? b.v - a.v : a.v - b.v).slice(0, 4);
      return sorted.map(m => ({ t: m.t, label, value: +m.v.toFixed(3) }));
    }

    const tsTips = [];
    // Head tilt
    if (headTiltAvg > HEAD_TILT_WARN) {
      topMoments(s=>s.headTilt, 'Head tilt high').forEach(x => tsTips.push({
        t: x.t, tip: `Keep head level (tilt ${Math.round(x.value)}°). Imagine balancing a book.`
      }));
    }
    // Slouch
    if (slouchAvg > SLOUCH_WARN) {
      topMoments(s=>s.slouch, 'Forward head/lean').forEach(x => tsTips.push({
        t: x.t, tip: `Straighten posture (reduce forward lean ~${Math.round(x.value)}°). Roll shoulders back.`
      }));
    }
    // Shoulder symmetry
    if (shoulderAvg > SHOULDER_DIFF_WARN) {
      topMoments(s=>s.shoulderOffset, 'Shoulders uneven').forEach(x => tsTips.push({
        t: x.t, tip: `Square shoulders; keep them level. Quick reset breath can help.`
      }));
    }
    // Hand visibility
    if (handsLostFrac > HANDS_LOST_WARN) {
      topMoments(s=> (s.handsBoth?0:1), 'Hands off-frame', 'high').forEach(x => tsTips.push({
        t: x.t, tip: `Bring both hands into frame; use open, mid-torso gestures for clarity.`
      }));
    }
    // Gesture rate
    if (gestRate < GESTURE_LOW_WARN) {
      tsTips.push({ t: clamp(duration*0.25,0,duration), tip: `Use purposeful gestures to mark key points (e.g., counting on fingers for your roadmap).`});
    } else if (gestRate > GESTURE_HIGH_WARN) {
      tsTips.push({ t: clamp(duration*0.25,0,duration), tip: `Reduce fidgeting; freeze for emphasis at key lines, then gesture deliberately.`});
    }
    // Fidgeting
    if (mvVar > FIDGET_WARN) {
      tsTips.push({ t: clamp(duration*0.5,0,duration), tip: `Anchor your stance (feet shoulder-width). Reset hands to neutral between points.`});
    }

    // Align tips with transcript beats (rough heuristic)
    const transcript = ($('videoTranscript').value || '').trim();
    const lines = transcript.split(/\n+/).filter(Boolean);
    const beats = lines.length ? lines : (transcript ? transcript.split(/[.?!]\s+/).filter(Boolean) : []);
    const beatAt = (t) => {
      if (!beats.length || !isFinite(duration) || duration <= 0) return '';
      const idx = clamp(Math.floor((t / duration) * beats.length), 0, beats.length - 1);
      return beats[idx];
    };

    // Render results
    function fmtTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    const summary = `
      <div class="kv" style="margin-top:8px">
        <div>Avg head tilt</div><div>${headTiltAvg.toFixed(1)}° ${headTiltAvg > HEAD_TILT_WARN ? ' (try to level more)' : ''}</div>
        <div>Avg forward lean</div><div>${slouchAvg.toFixed(1)}° ${slouchAvg > SLOUCH_WARN ? ' (reduce slouch)' : ''}</div>
        <div>Shoulder offset</div><div>${(shoulderAvg*100).toFixed(1)}% ${shoulderAvg > SHOULDER_DIFF_WARN ? ' (square up)' : ''}</div>
        <div>Hands visible both</div><div>${Math.round((1 - handsLostFrac)*100)}%</div>
        <div>Gesture rate</div><div>${gestRate.toFixed(2)} per sec</div>
        <div>Fidget variance</div><div>${mvVar.toFixed(3)}</div>
      </div>
    `;

    const rows = tsTips.sort((a,b)=>a.t-b.t).map(x => `
      <tr>
        <td>${fmtTime(x.t)}</td>
        <td>${Human.utils.escape(beatAt(x.t)) || '(beat)'}</td>
        <td>${Human.utils.escape(x.tip)}</td>
      </tr>
    `).join('');

    $('postureResults').innerHTML = `
      <div class="small" style="margin-bottom:6px"><strong>Posture & Gesture Coach</strong> — on-device analysis complete.</div>
      ${summary}
      <div style="margin-top:8px"><strong>Timestamped tips</strong></div>
      <table class="table"><thead><tr><th>Time</th><th>Nearby line</th><th>Suggestion</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">Looks solid! Minor tweaks: keep head level, square shoulders, mid-torso gestures.</td></tr>'}</tbody>
      </table>
    `;

    $('videoStatus').textContent = 'Posture/gesture analysis complete.';
    analyzing = false;

    // Expose compact summary for Gemini (optional)
    PostureCoach._lastSummary = {
      duration,
      headTiltAvg: +headTiltAvg.toFixed(2),
      slouchAvg: +slouchAvg.toFixed(2),
      shoulderAvg: +shoulderAvg.toFixed(4),
      handsBothPct: +((1 - handsLostFrac)*100).toFixed(1),
      gestureRate: +gestRate.toFixed(2),
      fidgetVar: +mvVar.toFixed(3),
      tips: tsTips.sort((a,b)=>a.t-b.t).map(t => ({ t: fmtTime(t.t), tip: t.tip, line: beatAt(t.t).slice(0,140) }))
    };
  }

  async function geminiCoach() {
    const key = ($('geminiKey')?.value || '').trim();
    if (!key) { alert('Paste a Gemini API key (from AI Studio) or skip this step.'); return; }
    if (!PostureCoach._lastSummary) { alert('Run the on-device analysis first.'); return; }
    const transcript = ($('videoTranscript').value || '').trim();
    if (!transcript) { alert('Add a transcript to get tailored coaching.'); return; }

    $('videoStatus').textContent = 'Contacting Gemini for extra coaching…';
    try {
      // Minimal JSON payload; model name can be changed by you later
      const body = {
        contents: [{
          parts: [{ text:
`You are a presentation coach. Given the speech transcript and objective posture metrics with timestamps,
give a concise, timestamped posture/gesture coaching plan.
- Do NOT comment on content quality, only delivery.
- Use bullets with timecodes (MM:SS).
- Include specific gestures (e.g., "open palms at chest height", "count on fingers", "pause hands").

TRANSCRIPT:
${transcript.slice(0, 12000)}

METRICS(JSON):
${JSON.stringify(PostureCoach._lastSummary, null, 2)}
` }]
        }]
      };
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='+encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n') || 'Gemini returned no text.';
      const box = document.createElement('div');
      box.className = 'small';
      box.style.cssText = 'margin-top:8px; padding:8px; background:var(--secondary); border-radius:6px';
      box.innerHTML = `<div><strong>Gemini Coach (optional)</strong></div><div style="white-space:pre-wrap">${Human.utils.escape(text)}</div>`;
      $('postureResults').appendChild(box);
      $('videoStatus').textContent = 'Gemini coaching added below.';
    } catch (e) {
      $('videoStatus').textContent = 'Gemini request failed (see console).';
      console.error(e);
    }
  }

  function toggleOverlay() {
    overlayEnabled = !overlayEnabled;
    const canvas = $('poseOverlay');
    if (!canvas) return;
    if (overlayEnabled) {
      canvas.style.display = 'block';
      canvas.style.maxHeight = '50vh';
    } else {
      canvas.style.display = 'none';
    }
  }

  function wire() {
    $('btnAnalyzePosture')?.addEventListener('click', analyze);
    $('btnToggleOverlay')?.addEventListener('click', toggleOverlay);
    $('btnGeminiCoach')?.addEventListener('click', geminiCoach);
  }

  return { wire, analyze, toggleOverlay };
})();

document.addEventListener('DOMContentLoaded', () => {
  try { PostureCoach.wire(); } catch (e) { console.error(e); }
});
