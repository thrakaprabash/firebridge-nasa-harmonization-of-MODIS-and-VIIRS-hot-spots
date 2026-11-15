const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),data=require('./data.cjs');
const local=path.resolve('.firebridge-demo');
const p=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--remote-debugging-pipe','--user-data-dir='+process.env.TEMP+'/firebridge-capture','--disable-background-networking','--hide-scrollbars','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
let id=0,buffer='',session;const pending=new Map();
function send(method,params={},sessionId=session){
 return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});p.stdio[3].write(JSON.stringify({id:n,method,params,sessionId})+'\0')});
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
p.stdio[4].on('data',raw=>{buffer+=raw.toString();let end;while((end=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
 if(m.id){const h=pending.get(m.id);pending.delete(m.id);m.error?h.reject(Error(JSON.stringify(m.error))):h.resolve(m.result)}
 if(m.method==='Fetch.requestPaused') fulfill(m.params).catch(console.error);
}});
async function fulfill({requestId,request}){
 const u=new URL(request.url);let body,type;
 try{
 if(u.pathname.startsWith('/api/')){type='application/json'; body=Buffer.from(JSON.stringify(data(u)));}
 else if(u.hostname==='cdn.jsdelivr.net'){type='application/json';body=fs.readFileSync('frontend/node_modules/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson');}
 else if(u.pathname==='/encode'){type='text/html';body=Buffer.from('<!doctype html><title>FireBridge demo</title>');}
 else if(u.pathname.startsWith('/frame')){type='image/jpeg';body=fs.readFileSync(path.join(local,u.pathname.slice(1)));}
 else{const file=u.pathname==='/'?'index.html':u.pathname.slice(1);type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';body=fs.readFileSync(path.join('frontend/dist',file));}
 await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type},{name:'Access-Control-Allow-Origin',value:'*'}],body:body.toString('base64')});
 }catch(e){console.error(request.url,e.message);await send('Fetch.failRequest',{requestId,errorReason:'Failed'});}
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){
 for(let i=0;i<90;i++){if(await evaluate(expression))return;await wait(160)}
 throw Error('Timed out: '+expression+' / '+await evaluate('document.body.innerText.slice(-1000)'));
}
async function shot(i){
 const r=await send('Page.captureScreenshot',{format:'jpeg',quality:94,fromSurface:true});
 fs.writeFileSync(path.join(local,'frame'+i+'.jpg'),Buffer.from(r.data,'base64')); console.log('Captured',i);
}
async function target(){
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 ({sessionId:session}=await send('Target.attachToTarget',{targetId,flatten:true}));
 await send('Page.enable'); await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1360,height:820,deviceScaleFactor:1,mobile:false});
}
async function capture(){
 await send('Page.navigate',{url:'https://firebridge.demo/'});
 await until("document.querySelectorAll('.map-country').length && document.querySelectorAll('circle[data-hotspot]').length > 20");
 await evaluate(`(()=>{const day=document.querySelectorAll('.map-filters select')[1];day.value='2026-09-27';day.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until("document.querySelectorAll('.map-modis').length > 10 && document.querySelectorAll('.map-viirs').length > 10");
 await shot(0);
 await evaluate(`(()=>{const area=document.querySelector('.map-filters select');area.value='northern-australia';area.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until("document.querySelector('.map-study-outline') && document.querySelectorAll('circle[data-hotspot]').length > 3");
 await wait(300);
 await shot(1);
 await evaluate("window.scrollTo(0,document.querySelector('.timeline').offsetTop-40)");
 await until("document.querySelector('.recharts-surface') && document.querySelectorAll('#calendar button').length >= 20");
 await wait(1700);await shot(2);
 await evaluate("document.querySelectorAll('#calendar button')[8].click()");
 await wait(650);await shot(3);
 await evaluate("window.scrollTo(0,document.querySelector('#compare').offsetTop-95);document.querySelector('#compare button').click()");
 await until("document.querySelector('.comparison-metrics') && document.querySelectorAll('.recharts-surface').length>=2");
 await wait(1700);
 await evaluate("window.scrollTo(0,document.querySelector('#compare').offsetTop-24)");
 await shot(4);
 console.log(await evaluate("document.querySelector('.comparison-metrics').innerText"));
 return;
}
(async()=>{try{await target();if(process.argv[2]==='encode'){
 await send('Page.navigate',{url:'https://firebridge.demo/encode'});
 await until("document.title==='FireBridge demo'");
 const video=await evaluate(fs.readFileSync(path.join(local,'encode.js'),'utf8'));
 console.log(video.mime,video.duration, video.bytes.length);
 fs.writeFileSync(path.resolve('FireBridge_30s_Demo.mp4'),Buffer.from(video.bytes,'base64'));
 }else await capture();
 }finally{p.kill()}})().catch(e=>{console.error(e);process.exitCode=1});

