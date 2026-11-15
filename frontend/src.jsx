import React, {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import Globe from 'react-globe.gl';
import {AreaChart,Area,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,LineChart,Line,ReferenceArea,Legend} from 'recharts';
import {Flame,Download,Play,Pause,Globe2,RotateCcw,ArrowUpRight,Sun,Moon} from 'lucide-react';
import {motion} from 'motion/react';
import FlatMap from './FlatMap';
import './style.css';

const number = value => value == null ? '—' : value.toLocaleString();
const regions = {
  'worldwide': {name:'Worldwide', bounds:[-180,-90,180,90]},
  'north-america': {name:'North America area', bounds:[-170,7,-50,84]},
  'south-america': {name:'South America area', bounds:[-85,-56,-34,13]},
  'europe': {name:'Europe area', bounds:[-25,34,45,72]},
  'africa': {name:'Africa area', bounds:[-26,-36,52,38]},
  'asia': {name:'Asia area', bounds:[25,-12,180,82]},
  'oceania': {name:'Oceania area', bounds:[110,-50,-130,0]},
  'antarctica': {name:'Antarctica area', bounds:[-180,-90,180,-60]},
  'northern-australia': {name:'Northern Australia', bounds:[113,-24,147,-10]},
  'southern-amazon': {name:'Southern Amazon', bounds:[-72,-17,-48,-5]},
  'southern-africa': {name:'Southern Africa', bounds:[12,-28,36,-8]},
  'sri-lanka': {name:'Sri Lanka area', bounds:[79.4,5.8,82,10]},
};
const overview = {lat:10,lng:55,altitude:2.1};
function regionView([west,south,east,north]) {
  const width = (east-west+360)%360 || 360;
  const lng = ((west+width/2+180)%360)-180;
  return {lat:(south+north)/2,lng,altitude:Math.min(2.1,Math.max(.12,Math.max(width,north-south)/52))};
}
const comparisonColumns = ['date','phase','modis_detections','viirs_detections','MODIS','VIIRS','viirs_adjusted'];

function coverageLabel(day) {
  if (day.MODIS != null && day.VIIRS != null) return 'Records from both sensors';
  if (day.MODIS != null) return 'MODIS records only';
  if (day.VIIRS != null) return 'VIIRS records only';
  return 'No records available';
}

function downloadComparison(days,regionId) {
  const csv = [comparisonColumns.join(','), ...days.map(day =>
    comparisonColumns.map(column => day[column] ?? '').join(',')
  )].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'firebridge-'+regionId+'-comparison.csv';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function get(path,signal) {
  const response = await fetch(path,{signal});
  const data = await response.json();
  if(!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
function App(){
  const [mapView,setMapView]=useState('globe');
  const [theme,setTheme]=useState(()=>localStorage.getItem('firebridge-theme')==='light'?'light':'dark');
  const light=theme==='light';
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    localStorage.setItem('firebridge-theme',theme);
  },[theme]);
  const [days,setDays]=useState([]),[selected,setSelected]=useState('2026-09-16');
  const [sensor,setSensor]=useState(''),[points,setPoints]=useState([]),[mapError,setMapError]=useState('');
  const [calendarError,setCalendarError]=useState(''),[comparisonError,setComparisonError]=useState('');
  const [mapRetry,retryMap]=useState(0),[calendarRetry,retryCalendar]=useState(0);
  const [clusters,setClusters]=useState([]),[detailMode,setDetailMode]=useState(false),[listPage,setListPage]=useState(0);
  const [loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[rotate,setRotate]=useState(false);
  const [comparison,setComparison]=useState(null),[comparing,setComparing]=useState(false);
  const [study,setStudy]=useState(false),[hotspot,setHotspot]=useState(null);
  const [regionId,setRegionId]=useState('northern-australia');
  const region=regions[regionId];
  const [west,south,east,north]=region.bounds;
  const regionWidth=(east-west+360)%360 || 360;
  const edge=lat=>Array.from({length:Math.ceil(regionWidth)+1},(_,i)=>
    [((west+i*regionWidth/Math.ceil(regionWidth)+540)%360)-180,lat]);
  const studyOutline=regionId==='worldwide'?[]:[[...edge(south),...edge(north).reverse(),[west,south]]];
  const globe=useRef(),container=useRef();
  const [size,setSize]=useState({width:800,height:550});
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(container.current);return()=>observer.disconnect()},[]);
  const areaName=study?region.name:'Worldwide';
  const areaQuery=study?'bbox='+region.bounds.join(','):'';
  const mapQuery=new URLSearchParams({date:selected});
  if(study) mapQuery.set('bbox',region.bounds.join(','));
  if(sensor) mapQuery.set('sensor',sensor);
  const query=mapQuery.toString();
  useEffect(()=>{
    const controller=new AbortController();
    setDays([]);setCalendarError('');
    get('/api/daily?'+areaQuery,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setDays(data.days)})
      .catch(error=>{if(!controller.signal.aborted)setCalendarError(error.message)});
    return()=>controller.abort();
  },[areaQuery,calendarRetry]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setMapError('');setPoints([]);setClusters([]);setHotspot(null);setListPage(0);
    const request=detailMode
      ? Promise.all((sensor?[sensor]:['MODIS','VIIRS']).map(name=>{
        const params=new URLSearchParams(query);
        params.set('sensor',name);
        params.set('limit','1000');
        return get('/api/hotspots?'+params,controller.signal);
      })).then(results=>{
        if(!controller.signal.aborted)setPoints(results.flatMap(data=>data.features.map(f=>({
          ...f.properties,id:f.id,lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],
        }))));
      })
      : get('/api/map-clusters?'+query,controller.signal).then(data=>{
        if(!controller.signal.aborted)setClusters(data.clusters);
      });
    request.catch(error=>{if(!controller.signal.aborted)setMapError(error.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[query,sensor,detailMode,mapRetry]);
  const mapPoints=detailMode?points:clusters;
  function selectHotspot(point){
    setPlaying(false);
    setHotspot(point);
    globe.current?.pointOfView({lat:point.lat,lng:point.lng,altitude:.8},600);
  }
  useEffect(()=>{if(globe.current){globe.current.controls().autoRotate=rotate;globe.current.controls().autoRotateSpeed=.35}},[rotate]);
  useEffect(()=>{if(!playing||!days.length||loading)return;const timer=setTimeout(()=>setSelected(days[(days.findIndex(d=>d.date===selected)+1)%days.length].date),1800);return()=>clearTimeout(timer)},[playing,days,selected,loading]);
  const current=days.find(d=>d.date===selected)||{};
  const shownSensors=sensor?[sensor]:['MODIS','VIIRS'];
  const total=shownSensors.reduce((sum,name)=>sum+(current[name]??0),0);
  const hasRecords=shownSensors.some(name=>current[name]!=null);
  const mapStatus=loading?'Loading observations…':detailMode
    ? (mapError?'':!days.length?'Showing '+number(points.length)+' records':!hasRecords?'No records available for this selection':total===0?'No matching detections':(points.length<total?'Partial view · ':'')+number(points.length)+' of '+number(total)+' detections')
    : clusters.length?number(clusters.reduce((sum,cell)=>sum+cell.count,0))+' detections grouped in 5° map cells'
    : !days.length?'':hasRecords?'No matching detections':'No records available for this selection';
  const max=Math.max(1,...days.map(d=>(d.MODIS||0)+(d.VIIRS||0)));
  async function compare(){
    setComparing(true);setComparisonError('');
    try {
      setComparison(await get('/api/comparison?bbox='+region.bounds.join(',')));
    } catch(e) {
      setComparisonError(e.message);
    } finally {
      setComparing(false);
    }
  }
  return <div className="shell">
    <aside><a className="brand" href="#top"><Flame size={30}/> <span>firebridge<span className="brand-dot">.</span></span></a><div className="side-label">WORKSPACE</div><a className="nav active" href="#top"><Globe2 size={18}/> Earth observatory</a><a className="nav" href="#calendar">Burning calendar <ArrowUpRight size={16}/></a><a className="nav" href="#compare">Sensor comparison <ArrowUpRight size={16}/></a><div className="side-bottom"><span className="status-dot"/> NASA FIRMS data<p>MODIS · VIIRS NOAA-21<br/>September–October 2026</p></div></aside>
    <main id="top"><header><div><div className="eyebrow">EARTH OBSERVATION / ACTIVE FIRE</div><h1>A planet in motion.</h1><p>Explore satellite detections. Understand burning activity.</p></div><div className="header-actions"><button type="button" className="button" onClick={()=>setTheme(light?'dark':'light')}>{light?<Moon size={16}/>:<Sun size={16}/>} {light?'Dark mode':'Light mode'}</button><a className="button" href={'/api/export?'+query}><Download size={16}/> Export detections</a></div></header>
    <p className="view-scope"><strong>{areaName}</strong> · {selected} UTC · {sensor||"Both instruments"}</p><section className="stats">{[...(sensor!=='VIIRS'?[['MODIS detections',current.MODIS,'Terra + Aqua']]:[]),...(sensor!=='MODIS'?[['VIIRS detections',current.VIIRS,'NOAA-21 · 375 m']]:[]),['Observation date',selected,'UTC acquisition date']].map(([label,value,note],i)=><motion.div className="stat" key={label} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:i*.1}}><label>{label}</label><strong>{typeof value==='string'?value:number(value)}</strong><small>{note}</small></motion.div>)}</section>
    <section className="earth-panel"><div className="map-toolbar"><div><span className="status-dot"/> {study?region.name:"Global observations"}</div><div className="header-actions"><select aria-label="Map layer" value={detailMode?"details":"clusters"} onChange={e=>setDetailMode(e.target.value==="details")}><option value="clusters">Grouped detections</option><option value="details">Individual hotspots</option></select><select aria-label="Map view" value={mapView} onChange={event=>{setMapView(event.target.value);setRotate(false);setHotspot(null)}}><option value="globe">3D globe</option><option value="flat">Flat map</option></select><button className="button" onClick={()=>{setStudy(!study);setRotate(false);globe.current?.pointOfView(study||regionId==='worldwide'?overview:regionView(region.bounds),900)}}>{study?"Show worldwide":mapView==="flat"?"Show study area":"Fly to study area"}</button><select aria-label="Sensor" value={sensor} onChange={e=>setSensor(e.target.value)}><option value="">Both instruments</option><option>MODIS</option><option>VIIRS</option></select></div></div>
    <div ref={container} className="globe">{mapView==="flat"?<FlatMap light={light} points={mapPoints} selected={hotspot} bounds={study&&regionId!=="worldwide"?region.bounds:null} onPointClick={detailMode?selectHotspot:undefined}/>:<Globe ref={globe} width={size.width} height={size.height} backgroundColor={light?'#e5effa':'#060e21'} globeImageUrl={light ? "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg" : "https://unpkg.com/three-globe/example/img/earth-night.jpg"} bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png" atmosphereColor={light ? "#87baf4" : "#65adff"} atmosphereAltitude={.16} pointsData={mapPoints} pointLat="lat" pointLng="lng" pointColor={d=>d.sensor==='MODIS'?'#ffab66':'#a8ebbe'} pointAltitude={point=>point===hotspot ? .01 : .007} pointRadius={point=>point===hotspot ? .35 :point.count?Math.min(.75,.16+Math.log10(point.count)*.14):.13} pointsMerge={!detailMode} pointResolution={5} pointsTransitionDuration={0} onPointClick={detailMode?selectHotspot:undefined} pathsData={study?studyOutline:[]} pathPointLat={point=>point[1]} pathPointLng={point=>point[0]} pathPointAlt={.01} pathResolution={1} pathColor={()=>light?"#124eaa":"#78ceff"} pathStroke={1.5} onGlobeReady={()=>globe.current.pointOfView(study&&regionId!=="worldwide"?regionView(region.bounds):overview,1200)}/>}</div>
    <div className="map-caption"><div className="legend"><span className="orange"/> MODIS <span className="green"/> VIIRS</div><span role="status">{mapStatus}</span><button disabled={mapView==="flat"} aria-label="Toggle globe rotation" onClick={()=>setRotate(!rotate)}><RotateCcw size={16}/>{rotate?'Stop rotation':'Rotate'}</button></div>
    {mapError && <p className="panel-feedback" role="alert">Map observations could not load. <button className="button" onClick={()=>retryMap(value=>value+1)}>Retry map</button></p>}
    {detailMode && points.length>0 && <details className="visible-hotspots">
      <summary>Visible hotspots ({number(points.length)})</summary>
      <ul>{points.slice(listPage*10,listPage*10+10).map(point=><li key={point.id}>
        <button className="button" aria-pressed={point===hotspot} onClick={()=>selectHotspot(point)}>
          {point.sensor} · {point.time_utc} UTC · {point.lat.toFixed(3)}, {point.lng.toFixed(3)}
        </button></li>)}</ul>
      <button className="button" disabled={listPage===0} onClick={()=>setListPage(value=>value-1)}>Previous</button> {' '}
      <button className="button" disabled={(listPage+1)*10>=points.length} onClick={()=>setListPage(value=>value+1)}>Next</button>
    </details>}
    {hotspot && <div className="hotspot-detail">
      <div className="section-heading"><h2>{hotspot.sensor} hotspot</h2><button className="button" onClick={()=>setHotspot(null)}>Close details</button></div>
      <p>Satellite {hotspot.satellite} · {hotspot.day_utc} {hotspot.time_utc} UTC</p>
      <p>{hotspot.lat.toFixed(4)}°, {hotspot.lng.toFixed(4)}° · Confidence {hotspot.confidence_raw ?? 'Unavailable'} · Fire radiative power {hotspot.frp_mw == null ? 'Unavailable' : hotspot.frp_mw+' MW'}</p>
    </div>}</section>
    {calendarError&&<p className="panel-feedback" role="alert">Daily counts could not load. <button className="button" onClick={()=>retryCalendar(value=>value+1)}>Retry counts</button></p>}
    <section className="timeline"><button className="play" aria-label={playing?'Pause timeline':'Play timeline'} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><input aria-label="Observation day" disabled={!days.length} type="range" min="0" max={Math.max(0,days.length-1)} value={Math.max(0,days.findIndex(d=>d.date===selected))} onChange={e=>setSelected(days[+e.target.value].date)}/><time>{selected}</time><small>{days.length ? coverageLabel(current) : ""}</small></section>
    <section className="lower"><div className="panel" id="calendar"><div className="section-heading"><div><h2>Burning calendar</h2><p>Daily hotspot detections · UTC</p></div><span>20-day window</span></div><div className="calendar">{days.map(d=><button key={d.date} title={d.date+' · MODIS '+number(d.MODIS)+' · VIIRS '+number(d.VIIRS)} className={selected===d.date?'selected':''} style={{backgroundColor:'rgba(70,139,228,'+(.08+.65*((d.MODIS||0)+(d.VIIRS||0))/max)+')'}} onClick={()=>setSelected(d.date)}><small>{d.date.slice(5,7)==='09'?'SEP':'OCT'}</small><strong>{d.date.slice(-2)}</strong>{d.MODIS===null&&<span title="MODIS data unavailable">—</span>}</button>)}</div><p className="footnote">Coverage labels indicate records in the dataset. Counts are for {areaName}.</p></div>
    <div className="panel"><h2>Activity through time</h2><p>Raw detections by instrument</p><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={days}><CartesianGrid stroke={light?'#cfdaea':'#243759'} vertical={false}/><XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/><YAxis width={45} tickFormatter={v=>v/1000+'k'} tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/><Tooltip contentStyle={{background:light?'#ffffff':'#102548',border:'1px solid #7890ae',borderRadius:10}}/><Area dataKey="VIIRS" stroke={light?'#24714a':'#a8ebbe'} fill="#a8ebbe" fillOpacity={.08}/><Area dataKey="MODIS" stroke={light?'#a8460d':'#ffab66'} fill="#ffab66" fillOpacity={.12}/></AreaChart></ResponsiveContainer></div></div></section>
    <section className="panel comparison" id="compare"><div><div className="eyebrow">EXPERIMENTAL ANALYSIS</div><h2>{region.name} sensor comparison</h2><p>Compare detected active cells on a common 1 km equal-area grid.<br/>This comparison uses the full available date range and both sensors. Presets use geographic rectangles. The first 70% of shared days are used for fitting.</p></div><div className="header-actions"><select aria-label="Comparison region" value={regionId} disabled={comparing} onChange={event=>{
      const next=event.target.value;
      setComparisonError('');setRegionId(next);
      setComparison(null);
      if(study) globe.current?.pointOfView(next==='worldwide'?overview:regionView(regions[next].bounds),900);
    }}>{Object.entries(regions).map(([id,preset])=><option key={id} value={id}>{preset.name}</option>)}</select><button className="button" disabled={comparing} onClick={compare}>{comparing?'Calculating…':'Run comparison'} <ArrowUpRight size={16}/></button></div>{comparisonError&&<p role="alert">Comparison could not load. <button className="button" onClick={compare}>Retry comparison</button></p>}{comparison&&!comparison.validation&&<p role="status">There are too few usable paired observations to fit and evaluate an adjustment for this area.</p>}{comparison&&<div className="results">{comparison.validation&&<span>Average difference from MODIS<strong>{comparison.validation.raw_mae.toFixed(1)} → {comparison.validation.adjusted_mae.toFixed(1)}</strong> Active cells/day · {region.name} · {comparison.validation.holdout_days} held-out days</span>}<span>VIIRS adjustment <strong>{comparison.factor?.toFixed(3)??'Insufficient data'}</strong></span><span>Unadjusted holdout MAE <strong>{comparison.validation?.raw_mae.toFixed(1)??'—'}</strong></span><span>Adjusted holdout MAE <strong>{comparison.validation?.adjusted_mae.toFixed(1)??'—'}</strong></span></div>}</section>
    {comparison && <section className="panel" style={{marginTop:20}}>
      <div className="section-heading"><h2>Daily detections and adjusted activity</h2><button className="button" onClick={()=>downloadComparison(comparison.days,regionId)}><Download size={16}/> Download comparison CSV</button></div>
      <div className="chart comparison-chart"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={comparison.days}>
          <CartesianGrid stroke={light?'#cfdaea':'#243759'} vertical={false}/>
          <XAxis dataKey="date" tickFormatter={value=>value.slice(5)} tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/>
          <YAxis tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/>
          <Tooltip contentStyle={{background:light?'#fff':'#102548',border:'1px solid #7890ae'}}/>
          <Legend/>
          {comparison.validation && <ReferenceArea x1={comparison.validation.holdout_start} x2={comparison.validation.holdout_end} fill="#448bde" fillOpacity={.22} label={{value:'Held-out days',position:'insideTopRight',fill:light?'#173c6b':'#b7d9ff',fontSize:11}}/>}
          <Line dataKey="MODIS" name="MODIS cells" stroke={light?'#a8460d':'#ffab66'} strokeWidth={2} dot={false}/>
          <Line dataKey="VIIRS" name="Original VIIRS cells" stroke={light?'#24714a':'#a8ebbe'} strokeWidth={2} dot={false}/>
          <Line dataKey="viirs_adjusted" name="Adjusted VIIRS cells" stroke={light?'#155ab4':'#78bdff'} strokeWidth={2} strokeDasharray="5 3" dot={false}/>
        </LineChart>
      </ResponsiveContainer></div>
      <p>MAE is measured in detected grid cells per UTC day. Each cell counts once per sensor per day.</p>
      {comparison.validation && <p>Fit on {comparison.validation.training_days} days. Tested on {comparison.validation.holdout_days} days ({comparison.validation.holdout_start} to {comparison.validation.holdout_end}).</p>}
      <div style={{overflowX:'auto'}}>
        <table className="comparison-table">
          <thead><tr>{['Date (UTC)', 'Split', 'MODIS detections', 'VIIRS detections', 'MODIS cells', 'VIIRS cells', 'Adjusted VIIRS cells'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{comparison.days.map(day=><tr key={day.date} className={day.phase==='holdout'?'holdout':''}>
            <th scope="row">{day.date}</th><td>{day.phase ?? '—'}</td>
            <td>{number(day.modis_detections)}</td><td>{number(day.viirs_detections)}</td>
            <td>{number(day.MODIS)}</td><td>{number(day.VIIRS)}</td>
            <td>{day.viirs_adjusted?.toFixed(1) ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}
    <footer>NASA FIRMS · Near-real-time observations <span>Hotspot detections may represent repeated observations of the same fire. Seasonal analysis requires a longer historical record.</span></footer></main></div>
}
createRoot(document.getElementById('root')).render(<App/>);














