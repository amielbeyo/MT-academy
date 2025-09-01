// Basic posture analysis using MediaPipe Pose
(function(global){
  async function score(blob){
    if(!global.Pose||!global.Pose.Pose){
      throw new Error('Mediapipe Pose not loaded');
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

    function angle(a,b,c){
      const ab={x:a.x-b.x,y:a.y-b.y};
      const cb={x:c.x-b.x,y:c.y-b.y};
      const dot=ab.x*cb.x+ab.y*cb.y;
      const magA=Math.hypot(ab.x,ab.y),magB=Math.hypot(cb.x,cb.y);
      return Math.acos(Math.min(1,Math.max(-1,dot/(magA*magB))))*180/Math.PI;
    }
    function spineAngle(lm){
      const hip=lm[24],shoulderPt=lm[12];
      const dx=shoulderPt.x-hip.x,dy=shoulderPt.y-hip.y;
      const ang=Math.atan2(dy,dx)*180/Math.PI;
      return Math.abs(90-ang);
    }

    return new Promise(resolve=>{
      pose.onResults(res=>{
        if(res.poseLandmarks){
          const lm=res.poseLandmarks;
          spine+=spineAngle(lm);
          shoulder+=Math.abs(lm[11].y-lm[12].y);
          const lEl=angle(lm[11],lm[13],lm[15]);
          const rEl=angle(lm[12],lm[14],lm[16]);
          elbow+=Math.abs(90-lEl)+Math.abs(90-rEl);
          const lKn=angle(lm[23],lm[25],lm[27]);
          const rKn=angle(lm[24],lm[26],lm[28]);
          knee+=Math.abs(180-lKn)+Math.abs(180-rKn);
          frames++;
        }
      });

      function process(){
        if(video.paused||video.ended){finish();return;}
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        pose.send({image:canvas});
        setTimeout(process,200);
      }
      function finish(){
        if(frames===0){resolve({score:0,advice:'No posture data'});return;}
        const sAvg=spine/frames;
        const shAvg=shoulder/frames;
        const elAvg=elbow/frames/2;
        const knAvg=knee/frames/2;
        const sScore=Math.max(0,10-sAvg*0.2);
        const shScore=Math.max(0,10-shAvg*40);
        const elScore=Math.max(0,10-elAvg/9);
        const knScore=Math.max(0,10-knAvg/9);
        const final=(sScore+shScore+elScore+knScore)/4;
        const tips=[];
        if(sAvg>5) tips.push('keep your back straighter');
        if(shAvg>0.03) tips.push('level your shoulders');
        if(elAvg>25) tips.push('steady your elbows');
        if(knAvg>25) tips.push('avoid locking knees');
        resolve({score:+final.toFixed(1),advice:tips.join('; ')});
      }
      video.onloadeddata=()=>{video.play();process();};
      video.onerror=()=>finish();
    });
  }

  global.Posture={score};
})(window);

