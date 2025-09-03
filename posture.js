// Basic posture analysis using MediaPipe Pose
async function ensurePose(){
  if(window.Pose && window.Pose.Pose){return true;}
  try{
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose.min.js';
      s.onload=res;
      s.onerror=rej;
      document.head.appendChild(s);
    });
  }catch(_){return false;}
  return !!(window.Pose && window.Pose.Pose);
}

// blob: video file; transcript: optional text to map timeline events
async function analyzeBodyLanguage(blob, transcript=''){
  if(!await ensurePose()){
    return {score:0,posture:0,gesture:0,movement:0,advice:'Pose model unavailable',events:[]};
  }
  const pose=new window.Pose.Pose({
    locateFile:file=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`
  });
  pose.setOptions({modelComplexity:1,smoothLandmarks:true,minDetectionConfidence:0.5,minTrackingConfidence:0.5});

  const video=document.createElement('video');
  video.src=URL.createObjectURL(blob);
  video.muted=true;
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');

  let frames=0,spine=0,shoulder=0,elbow=0,knee=0;
  let wristMove=0,bodyMove=0,lastL=null,lastR=null,lastHip=null;
  let wristStill=0;
  const events=[];
  const lines=(transcript||'').split(/\n+/).filter(Boolean);
  let done=false, finish;

  function angle(a,b,c){
    const ab={x:a.x-b.x,y:a.y-b.y};
    const cb={x:c.x-b.x,y:c.y-b.y};
    const dot=ab.x*cb.x+ab.y*cb.y;
    const magA=Math.hypot(ab.x,ab.y),magB=Math.hypot(cb.x,cb.y);
    return Math.acos(Math.min(1,Math.max(-1,dot/(magA*magB))))*180/Math.PI;
  }

  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

  async function process(){
    if(video.ended){finish();return;}
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    await pose.send({image:canvas});
    requestAnimationFrame(process);
  }

  pose.onResults(r=>{
    try{
    frames++;
    const lm=r.poseLandmarks;
    if(!lm || lm.length<29){return;}
    const L=lm[11],R=lm[12];
    const H=lm[23],H2=lm[24];
    const wristL=lm[15],wristR=lm[16];
    const elbowL=lm[13],elbowR=lm[14];
    const kneeL=lm[25],kneeR=lm[26],ankleL=lm[27],ankleR=lm[28];
    if(!L||!R||!H||!H2||!wristL||!wristR||!elbowL||!elbowR||!kneeL||!kneeR||!ankleL||!ankleR){return;}
    const spineAng=angle(L,H,H2);
    const spineDiff=Math.abs(spineAng-180);
    const shoulderDiff=Math.abs(L.y-R.y);
    const elbowAng=angle(elbowL,L,wristL)+angle(elbowR,R,wristR);
    const kneeAng=angle(kneeL,H,ankleL)+angle(kneeR,H2,ankleR);
    spine+=spineDiff;
    shoulder+=shoulderDiff;
    elbow+=elbowAng;
    knee+=kneeAng;
    const handMove=lastL&&lastR?dist(wristL,lastL)+dist(wristR,lastR):0;
    const hipMove=lastHip?dist(H,lastHip):0;
    wristMove+=handMove;
    bodyMove+=hipMove;
    if(handMove<0.01){wristStill++;}else{wristStill=0;}
    function mark(issue){
      const t=video.currentTime;
      events.push({time:+t.toFixed(1),issue});
    }
    if(wristStill>30){mark('add hand gesture to emphasize point');wristStill=0;}
    if(hipMove>0.1) mark('transition—keep movements smooth');
    const handLevel=(wristL.y+wristR.y)/2;
    const shoulderLevel=(L.y+R.y)/2;
    if(handLevel>H.y+0.1) mark('raise hands toward waist level');
    else if(handLevel<shoulderLevel-0.1) mark('lower hands to chest height');
    if(spineDiff>5) mark('keep your back straighter');
    if(shoulderDiff>0.03) mark('level your shoulders');
    if(elbowAng/2>25) mark('keep elbows near 90°');
    if(kneeAng/2>25) mark('avoid locking knees');
    lastL=wristL;
    lastR=wristR;
    lastHip=H;
    }catch(_){/* ignore frame errors */}
  });

  return new Promise(resolve=>{
    finish=function(){
      if(done) return;
      done=true;
      pose.close();
      URL.revokeObjectURL(video.src);
      video.remove();
      canvas.remove();
      if(frames===0){resolve({score:0,posture:0,gesture:0,movement:0,advice:'No posture data',events:[]});return;}
      const sAvg=spine/frames;
      const shAvg=shoulder/frames;
      const elAvg=elbow/frames/2;
      const knAvg=knee/frames/2;
      const sScore=Math.max(0,10-sAvg*0.2);
      const shScore=Math.max(0,10-shAvg*40);
      const elScore=Math.max(0,10-elAvg/9);
      const knScore=Math.max(0,10-knAvg/9);
      const wristAvg=wristMove/frames;
      const bodyAvg=bodyMove/frames;
      const gestScore=Math.max(0,10-wristAvg*50);
      const moveScore=Math.max(0,10-bodyAvg*50);
      const postureScore=(sScore+shScore+elScore+knScore)/4;
      const final=(postureScore+gestScore+moveScore)/3;
      const tips=[];
      if(sAvg>5) tips.push('keep your back straighter');
      if(shAvg>0.03) tips.push('level your shoulders');
      if(elAvg>25) tips.push('steady your elbows');
      if(knAvg>25) tips.push('avoid locking knees');
      if(wristAvg>0.02) tips.push('steady your hand gestures');
      if(bodyAvg>0.01) tips.push('reduce body movement');
      // Attach transcript snippets to events for context
      if(lines.length && video.duration){
        const seg=video.duration/lines.length;
        events.forEach(ev=>{
          const idx=Math.min(lines.length-1,Math.floor(ev.time/seg));
          ev.text=lines[idx]||'';
        });
      }

      resolve({
        score:+final.toFixed(1),
        posture:+postureScore.toFixed(1),
        gesture:+gestScore.toFixed(1),
        movement:+moveScore.toFixed(1),
        advice:tips.join('; '),
        events
      });
    };
    video.onloadeddata=()=>{
      canvas.width=video.videoWidth;
      canvas.height=video.videoHeight;
      video.play();
      requestAnimationFrame(process);
    };
    video.onended=finish;
    video.onerror=finish;
  });
}

if(typeof window!=='undefined'){
  window.analyzeBodyLanguage = analyzeBodyLanguage;
}

