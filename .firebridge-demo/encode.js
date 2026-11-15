(async()=>{
 const shots=await Promise.all(Array.from({length:5},(_,i)=>new Promise((yes,no)=>{const img=new Image();img.onload=()=>yes(img);img.onerror=no;img.src='/frame'+i+'.jpg'})));
 const c=document.createElement('canvas');c.width=1600;c.height=900;document.body.append(c);
 const g=c.getContext('2d',{alpha:false});
 const scenes=[
  [0,0,'Explore active fire detections','Historical NASA FIRMS observations from MODIS and VIIRS'],
  [5.5,1,'Focus on a region','Filter the map to Northern Australia to see local detection groups'],
  [11,2,'Explore activity by date','The burning calendar and activity chart show daily detections'],
  [15.5,3,'Select a day','Choose a date to update the map and inspect the counts for that day'],
  [20,4,'Compare the two instruments','Count detected cells on a shared 1 km grid and test an adjustment on held-out days']
 ];
 function fill(color,x,y,w,h){g.fillStyle=color;g.fillRect(x,y,w,h);}
 function text(s,color,font,x,y){g.fillStyle=color;g.font=font;g.fillText(s,x,y);}
 function draw(t){
  const idx=scenes.findLastIndex(s=>t>=s[0]), [start,shot,title,caption]=scenes[Math.max(0,idx)];
  const light=g.createLinearGradient(0,0,1600,900);light.addColorStop(0,'#172a44');light.addColorStop(1,'#071121');g.fillStyle=light;g.fillRect(0,0,1600,900);
  text('FireBridge','#f7faff','700 38px "Segoe UI",sans-serif',112,52);
  text('NASA FIRMS  /  MODIS + VIIRS','#a9c7e8','600 19px "Segoe UI",sans-serif',1155,47);
  const w=1210,h=729,x=(1600-w)/2,y=73;
  fill('#4d6a8b',x-1,y-1,w+2,h+2);
  g.drawImage(shots[shot],x,y,w,h);
  if(shot===3){
   const zoom=1+.019*Math.min(1,(t-start)/1.7);g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.drawImage(shots[shot],x-(zoom-1)*w/4,y,w*zoom,h*zoom);g.restore();
  }
  fill('#ffaf6d',192,825,4,55);
  text(title,'#f7faff','700 28px "Segoe UI",sans-serif',211,847);
  text(caption,'#c4d8ed','400 21px "Segoe UI",sans-serif',211,877);
  fill('#37516d',0,896,1600,4);fill('#ffaf6d',0,896,1600*Math.min(1,t/29.4),4);
 }
 draw(0);
 const mime=['video/mp4;codecs=avc1.420033','video/mp4;codecs=avc1','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
 if(!mime)throw Error('MP4 MediaRecorder not available');
 const stream=c.captureStream(30), rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8500000});
 const chunks=[];rec.ondataavailable=e=>chunks.push(e.data);
 const done=new Promise((resolve,reject)=>{rec.onerror=e=>reject(e.error);rec.onstop=resolve});
 rec.start();const start=performance.now();
 await new Promise(resolve=>{function tick(){const elapsed=performance.now()-start;draw(elapsed/1000);if(elapsed<29300)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});
 rec.stop();await done;stream.getTracks().forEach(t=>t.stop());
 const blob=new Blob(chunks,{type:'video/mp4'});
 const v=document.createElement('video');v.preload='metadata';v.src=URL.createObjectURL(blob);
 let duration=await new Promise((yes,no)=>{v.onloadedmetadata=()=>yes(v.duration);v.onerror=()=>no(new Error('Failed to decode MP4'))});
 if(!Number.isFinite(duration)){await new Promise(resolve=>{v.onseeked=resolve;v.currentTime=1e8});duration=v.currentTime}
 if(!(duration>28&&duration<=30))throw Error('Unexpected duration '+duration);
 const bytes=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob)});
 return {mime,duration,bytes};
})()
