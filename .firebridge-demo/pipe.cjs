const {spawn}=require('child_process');
const p=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--remote-debugging-pipe','--user-data-dir='+process.env.TEMP+'/firebridge-pipe','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
p.stderr.on('data',d=>process.stderr.write(d)); p.stdio[4].on('data',d=>{console.log(d.toString());p.kill()});p.stdio[3].on('error',console.error);p.stdio[3].write(JSON.stringify({id:1,method:'Browser.getVersion'})+'\0');setTimeout(()=>p.kill(),3000).unref();
