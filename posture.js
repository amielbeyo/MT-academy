// Basic posture analysis using MediaPipe Pose
(function(global){
  async function ensurePose(){
    if(global.Pose&&global.Pose.Pose){return true;}
    try{
      await new Promise((res,rej)=>{
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose.min.js';
        s.onload=res;
        s.onerror=rej;
        document.head.appendChild(s);
      });
    }catch(_){return false;}
    return !!(global.Pose&&global.Pose.Pose);
  }

  async function score(blob){
    if(!await ensurePose()){
      return {score:0,posture:0,gesture:0,movement:0,advice:'Pose model unavailable'};
    }
    const pose=new global.Pose.Pose({
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
    const events=[]; // timestamped posture issues
    const eventLast={};

    function angle(a,b,c){
      const ab={x:a.x-b.x,y:a.y-b.y};
      const cb={x:c.x-b.x,y:c.y-b.y};
      const dot=ab.x*cb.x+ab.y*cb.y;
      const magA=Math.hypot(ab.x,ab.y),magB=Math.hypot(cb.x,cb.y);
      return Math.acos(Math.min(1,Math.max(-1,dot/(magA*magB))))*180/Math.PI;
    }

    function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

    function process(){
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      pose.send({image:canvas});
    }

    pose.onResults(r=>{
      frames++;
      const lm=r.poseLandmarks;
      if(!lm){return;}
      const L=lm[11],R=lm[12];
      const H=lm[23],H2=lm[24];
      const spineAng=angle(L,H,H2);
      const spineDiff=Math.abs(spineAng-180);
      const shoulderDiff=Math.abs(L.y-R.y);
      const elbowAng=angle(lm[13],lm[11],lm[15])+angle(lm[14],lm[12],lm[16]);
      const kneeAng=angle(lm[25],lm[23],lm[27])+angle(lm[26],lm[24],lm[28]);
      spine+=spineDiff;
      shoulder+=shoulderDiff;
      elbow+=elbowAng;
      knee+=kneeAng;
      if(lastL&&lastR){
        wristMove+=dist(lm[15],lastL)+dist(lm[16],lastR);
      }
      if(lastHip){
        bodyMove+=dist(H,lastHip);
      }
      function mark(issue){
        const t=video.currentTime;
        if(!eventLast[issue]||t-eventLast[issue]>1){
          events.push({time:+t.toFixed(1),issue});
          eventLast[issue]=t;
        }
      }
      if(spineDiff>5) mark('keep your back straighter');
      if(shoulderDiff>0.03) mark('level your shoulders');
      if(elbowAng/2>25) mark('steady your elbows');
      if(kneeAng/2>25) mark('avoid locking knees');
      lastL=lm[15];
      lastR=lm[16];
      lastHip=H;
    });

    return new Promise(resolve=>{
      function finish(){
        pose.close();
        video.remove();
        canvas.remove();
        if(frames===0){resolve({score:0,posture:0,gesture:0,movement:0,advice:'No posture data'});return;}
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
        resolve({
          score:+final.toFixed(1),
          posture:+postureScore.toFixed(1),
          gesture:+gestScore.toFixed(1),
          movement:+moveScore.toFixed(1),
          advice:tips.join('; '),
          events
        });
      }
      video.onloadeddata=()=>{video.play();process();};
      video.onerror=()=>finish();
    });
  }

  async function ratePosture(){
    try{
      const blob=await fetch($('videoPreview').src).then(r=>r.blob());
      setStatus('Scoring body language...');
      const res=await score(blob);
      let tips=res.advice;
      const transcript=$('videoTranscript').value.trim();
      if(transcript&&EngineState.openaiKey){
        try{
          const timeline=res.events.map(e=>`${e.time}s ${e.issue}`).join(' | ');
          const msgs=[
            {role:'system',content:'You are a helpful posture coach.'},
            {role:'user',content:`Transcript: "${transcript}"\nPosture score: ${res.posture}/10\nGesture score: ${res.gesture}/10\nMovement score: ${res.movement}/10\nTimeline: ${timeline}\nGive concise body language improvement tips.`}
          ];
          const resp=await fetch('https://api.openai.com/v1/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${EngineState.openaiKey}`},
            body:JSON.stringify({model:EngineState.openaiModel||'gpt-4o-mini',messages:msgs,max_tokens:120,temperature:0.7})
          });
          const data=await resp.json();
          const text=data?.choices?.[0]?.message?.content?.trim();
          if(text) tips=text;
        }catch(e){}
      }
      const timelineHtml=res.events.map(e=>`<li>${e.time}s: ${escHTML(e.issue)}</li>`).join('');
      $('videoFeedback').innerHTML=`<div class="kv small"><div>Final Body Score</div><div>${res.score}/10</div><div>Posture</div><div>${res.posture}/10</div><div>Gesture</div><div>${res.gesture}/10</div><div>Movement</div><div>${res.movement}/10</div></div><div class="small" style="margin-top:4px"><strong>Body Tips:</strong> ${escHTML(tips)}</div>${res.events.length?`<div class="small" style="margin-top:4px"><strong>Timeline:</strong><ul>${timelineHtml}</ul></div>`:''}`;
      $('videoStatus').textContent='Body language scored.';
    }catch(e){
      $('videoStatus').textContent='Body analysis failed.';
    }
  }

  global.Posture={score,ratePosture};
})(window);
