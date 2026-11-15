const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('hotspots.sqlite',{readOnly:true});
const {first,last}=db.prepare('SELECT min(day_utc) first,max(day_utc) last FROM daily_counts').get();
const rad=Math.PI/180, radius=6371.0088, scale=Math.cos(Math.PI/6);
db.function('grid_x',lon=>Math.floor(radius*scale*rad*lon));
db.function('grid_y',lat=>Math.floor(radius*Math.sin(rad*lat)/scale));
const sensors=['MODIS','VIIRS'];
const names=db.prepare('SELECT DISTINCT day_utc,sensor FROM daily_counts').all();
const dates=[...new Set(names.map(row=>row.day_utc))].sort();
const available=new Set(names.map(row=>row.day_utc+row.sensor));
function data(url) {
 const q=url.searchParams;
 const sensor=q.get('sensor');
 const bounds=q.get('bbox')?.split(',').map(Number);
 const where=['day_utc BETWEEN ? AND ?'], params=[q.get('date')||first,q.get('date')||last];
 if(sensor){where.push('sensor=?');params.push(sensor)}
 if(bounds){where.push('latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?');params.push(bounds[1],bounds[3],bounds[0],bounds[2])}
 const filter=where.join(' AND ');
 const rows=(sql)=>db.prepare(sql).all(...params);
 const cal=(grid)=> {
   const source=grid?'(SELECT DISTINCT day_utc,sensor,grid_x(longitude),grid_y(latitude) FROM hotspots WHERE '+filter+')':'hotspots WHERE '+filter;
   const counts=new Map(rows('SELECT day_utc,sensor,count(*) n FROM '+source+' GROUP BY day_utc,sensor').map(r=>[r.day_utc+r.sensor,r.n]));
   return dates.map(date=>({date,...Object.fromEntries((sensor?[sensor]:sensors).map(s=>[s,available.has(date+s)?counts.get(date+s)||0:null]))}));
 };
 if(url.pathname==='/api/daily') return {days:cal(false)};
 if(url.pathname==='/api/map-clusters'){
   const clusters=rows('SELECT sensor,avg(latitude) lat,avg(longitude) lng,count(*) count,min(35,cast((latitude+90)/5 AS integer)) lat_cell,min(71,cast((longitude+180)/5 AS integer)) lng_cell FROM hotspots WHERE '+filter+' GROUP BY sensor,lat_cell,lng_cell');
   return {clusters,total:clusters.reduce((sum,row)=>sum+row.count,0)};
 }
 if(url.pathname==='/api/comparison'){
   const days=cal(true),raw=cal(false), paired=days.filter(r=>sensors.every(s=>r[s]!=null));
   const split=Math.floor(paired.length*.7),train=paired.slice(0,split),hold=paired.slice(split);
   const sum=s=>train.reduce((n,r)=>n+r[s],0);
   const factor=sum('MODIS')/sum('VIIRS');
   const mae=f=>hold.reduce((n,r)=>n+Math.abs(r.MODIS-f*r.VIIRS),0)/hold.length;
   const validation={training_days:train.length,holdout_days:hold.length,holdout_start:hold[0].date,holdout_end:hold.at(-1).date,raw_mae:mae(1),adjusted_mae:mae(factor)};
   days.forEach((r,i)=>Object.assign(r,{modis_detections:raw[i].MODIS,viirs_detections:raw[i].VIIRS,phase:paired.includes(r)?(r.date>=validation.holdout_start?'holdout':'training'):null,viirs_adjusted:r.VIIRS==null?null:r.VIIRS*factor}));
   return {days,validation,factor,experimental:true,grid_size_m:1000};
 }
 throw Error(url.pathname);
}
module.exports=data;
