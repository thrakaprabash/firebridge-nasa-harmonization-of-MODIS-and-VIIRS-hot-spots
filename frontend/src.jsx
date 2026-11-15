import React, {lazy,Suspense,useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Flame,Download,Play,Pause,Globe2,RotateCcw,ArrowUpRight,Sun,Moon} from 'lucide-react';
import FlatMap from './FlatMap';
import './style.css';

const Globe = lazy(()=>import('react-globe.gl'));
const ActivityChart = lazy(()=>import('./Charts').then(module=>({default:module.ActivityChart})));
const ComparisonChart = lazy(()=>import('./Charts').then(module=>({default:module.ComparisonChart})));

class GlobeErrorBoundary extends React.Component {
  state = {failed:false};

  static getDerivedStateFromError() {
    return {failed:true};
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const sensors = ['MODIS','VIIRS'];
const sensorColors = {MODIS:['#ffab66','#a8460d'],VIIRS:['#a8ebbe','#24714a']};
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

function coverageLabel(day,sensor) {
  if (sensor) return day[sensor]==null ? sensor+' records unavailable' : sensor+' records available';
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
  const [mapView,setMapView]=useState('flat');
  const [globeFailed,setGlobeFailed]=useState(false);
  const [theme,setTheme]=useState(()=>localStorage.getItem('firebridge-theme')==='light'?'light':'dark');
  const light=theme==='light';
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    localStorage.setItem('firebridge-theme',theme);
  },[theme]);
  const [days,setDays]=useState([]),[selected,setSelected]=useState('');
  const [calendarLoading,setCalendarLoading]=useState(true);
  const [sensor,setSensor]=useState(''),[points,setPoints]=useState([]),[mapError,setMapError]=useState('');
  const [calendarError,setCalendarError]=useState(''),[comparisonError,setComparisonError]=useState('');
  const [mapRetry,retryMap]=useState(0),[calendarRetry,retryCalendar]=useState(0);
  const [clusters,setClusters]=useState([]),[detailMode,setDetailMode]=useState(false),[listPage,setListPage]=useState(0);
  const [loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[rotate,setRotate]=useState(false);
  const [comparison,setComparison]=useState(null),[comparing,setComparing]=useState(false);
  const [areaId,setAreaId]=useState('worldwide');
  const [group,setGroup]=useState(null),[inspectedGroup,setInspectedGroup]=useState(null);
  const [hotspot,setHotspot]=useState(null);
  const [partial,setPartial]=useState(false);
  const [regionId,setRegionId]=useState('northern-australia');
  const region=regions[regionId];
  const area=regions[areaId];
  const [west,south,east,north]=area.bounds;
  const regionWidth=(east-west+360)%360 || 360;
  const edge=lat=>Array.from({length:Math.ceil(regionWidth)+1},(_,i)=>
    [((west+i*regionWidth/Math.ceil(regionWidth)+540)%360)-180,lat]);
  const studyOutline=areaId==='worldwide'?[]:[[...edge(south),...edge(north).reverse(),[west,south]]];
  const globe=useRef(),container=useRef();
  const activityChart=useRef();
  const [showActivityChart,setShowActivityChart]=useState(false);
  const [size,setSize]=useState({width:800,height:550});
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(container.current);return()=>observer.disconnect()},[]);
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>{
      if(entry.isIntersecting){
        setShowActivityChart(true);
        observer.disconnect();
      }
    },{rootMargin:'200px'});
    observer.observe(activityChart.current);
    return()=>observer.disconnect();
  },[]);
  const areaBounds=areaId==='worldwide'?null:area.bounds;
  const areaParams=new URLSearchParams();
  if(areaBounds) areaParams.set('bbox',areaBounds.join(','));
  if(sensor) areaParams.set('sensor',sensor);
  const areaQuery=areaParams.toString();
  const mapQuery=new URLSearchParams(areaQuery);
  mapQuery.set('date',selected);
  const query=mapQuery.toString();
  const detailQuery=new URLSearchParams(query);
  if(inspectedGroup){
    detailQuery.set('sensor',inspectedGroup.sensor);
    detailQuery.set('cell',inspectedGroup.lat_cell+','+inspectedGroup.lng_cell);
  }
  const requestQuery=detailQuery.toString();
  const exportQuery=inspectedGroup?requestQuery:query;
  const shownSensors=sensor?[sensor]:sensors;
  const activeSensors=inspectedGroup?[inspectedGroup.sensor]:shownSensors;
  const mapBounds=inspectedGroup?.bounds ?? areaBounds;

  function clearGroup(){
    setGroup(null);
    setInspectedGroup(null);
  }

  function recoverGlobe(){
    setRotate(false);
    setMapView('flat');
    setGlobeFailed(true);
  }

  function chooseDate(date){
    setSelected(date);
    clearGroup();
  }

  function openGroup(point){
    setPlaying(false);
    setGroup(point);
  }

  function inspectGroup(){
    const west=group.lng_cell*5-180, south=group.lat_cell*5-90;
    setInspectedGroup({...group,bounds:[west,south,west+5,south+5]});
    setGroup(null);
    setDetailMode(true);
  }

  useEffect(()=>{
    globe.current?.pointOfView(mapBounds?regionView(mapBounds):overview,650);
  },[mapBounds]);
  useEffect(()=>{
    const controller=new AbortController();
    setDays([]);setCalendarError('');setCalendarLoading(true);
    get('/api/daily?'+areaQuery,controller.signal)
      .then(({days:availableDays})=>{
        if(controller.signal.aborted) return;
        setDays(availableDays);
        setSelected(previous=>availableDays.some(day=>day.date===previous)
          ? previous
          : availableDays.findLast(day=>day.MODIS!=null||day.VIIRS!=null)?.date ?? '');
      })
      .catch(error=>{if(!controller.signal.aborted)setCalendarError(error.message)})
      .finally(()=>{if(!controller.signal.aborted)setCalendarLoading(false)});
    return()=>controller.abort();
  },[areaQuery,calendarRetry]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(Boolean(selected));setMapError('');setPoints([]);setClusters([]);setHotspot(null);setListPage(0);setPartial(false);
    if(!selected) return;
    const request=detailMode
      ? Promise.all((inspectedGroup?[inspectedGroup.sensor]:sensor?[sensor]:sensors).map(name=>{
        const params=new URLSearchParams(requestQuery);
        params.set('sensor',name);
        params.set('limit','1000');
        return get('/api/hotspots?'+params,controller.signal);
      })).then(results=>{
        if(controller.signal.aborted) return;
        setPartial(results.some(data=>data.next_after!=null));
        setPoints(results.flatMap(data=>data.features.map(f=>({
          ...f.properties,id:f.id,lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],
        }))));
      })
      : get('/api/map-clusters?'+query,controller.signal).then(data=>{
        if(!controller.signal.aborted)setClusters(data.clusters);
      });
    request.catch(error=>{if(!controller.signal.aborted)setMapError(error.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[selected,requestQuery,sensor,inspectedGroup,detailMode,mapRetry]);
  const mapPoints=detailMode?points:clusters;
  function selectHotspot(point){
    setPlaying(false);
    setHotspot(point);
    globe.current?.pointOfView({lat:point.lat,lng:point.lng,altitude:.8},600);
  }
  useEffect(()=>{if(globe.current){globe.current.controls().autoRotate=rotate;globe.current.controls().autoRotateSpeed=.35}},[rotate]);
  useEffect(()=>{if(!playing||!days.length||loading)return;const timer=setTimeout(()=>chooseDate(days[(days.findIndex(d=>d.date===selected)+1)%days.length].date),1800);return()=>clearTimeout(timer)},[playing,days,selected,loading]);
  const current=days.find(d=>d.date===selected)||{};
  const count=day=>shownSensors.reduce((sum,name)=>sum+(day[name]??0),0);
  const total=inspectedGroup?.count ?? (days.length?count(current):null);
  const hasRecords=shownSensors.some(name=>current[name]!=null);
  const mapStatus=loading||calendarLoading?'Loading observations.'
    : mapError||(!selected&&calendarError)?'':!selected?'No observation dates available.':detailMode
    ? points.length ? 'Showing '+number(points.length)+(total!=null?' of '+number(total):'')+' detections'
      : days.length&&!hasRecords?'No records available for this selection':'No matching detections'
    : clusters.length?number(clusters.reduce((sum,cell)=>sum+cell.count,0))+' detections grouped in 5° map cells'
    : days.length&&!hasRecords?'No records available for this selection':'No matching detections';
  const max=Math.max(1,...days.map(count));
  const datasetPeriod=days.length ? days[0].date+' to '+days.at(-1).date+' UTC' : '';
  async function compare(){
    setComparing(true);setComparisonError('');setComparison(null);
    try {
      setComparison(await get('/api/comparison?bbox='+region.bounds.join(',')));
    } catch(e) {
      setComparisonError(e.message);
    } finally {
      setComparing(false);
    }
  }
  return <div className="shell">
    <aside><a className="brand" href="#top"><Flame size={30}/> <span>firebridge<span className="brand-dot">.</span></span></a><div className="side-label">WORKSPACE</div><nav className="desktop-nav" aria-label="Workspace"><a className="nav" href="#map"><Globe2 size={18}/> Earth observatory</a><a className="nav" href="#calendar">Burning calendar <ArrowUpRight size={16}/></a><a className="nav" href="#compare">Sensor comparison <ArrowUpRight size={16}/></a></nav><div className="side-bottom"><span className="status-dot"/> NASA FIRMS data<p>MODIS · VIIRS NOAA-21</p></div></aside>
    <main id="top"><header><div><div className="eyebrow">EARTH OBSERVATION / ACTIVE FIRE</div><h1>Explore active fire detections</h1><p>Explore and compare satellite observations from MODIS and VIIRS.</p></div><div className="header-actions"><button type="button" className="button" onClick={()=>setTheme(light?'dark':'light')}>{light?<Moon size={16}/>:<Sun size={16}/>} {light?'Dark mode':'Light mode'}</button>{selected?<a className="button" href={'/api/export?'+exportQuery}><Download size={16}/> {inspectedGroup?'Export group detections':'Export detections'}</a>:<button type="button" className="button" disabled><Download size={16}/> Export detections</button>}</div></header>
    <nav className="mobile-nav" aria-label="Workspace"><a href="#map">Map</a><a href="#calendar">Calendar</a><a href="#compare">Comparison</a></nav>
    <section className="stats">{[...(sensor!=='VIIRS'?[['MODIS detections',current.MODIS,'Terra + Aqua']]:[]),...(sensor!=='MODIS'?[['VIIRS detections',current.VIIRS,'NOAA-21 · 375 m']]:[]),['Observation date',selected,'UTC acquisition date']].map(([label,value,note])=><div className="stat" key={label}><label>{label}</label><strong>{typeof value==='string'?value:number(value)}</strong><small>{note}</small></div>)}</section>
    <section className="earth-panel" id="map" aria-labelledby="map-heading">
      <div className="map-toolbar">
        <div><h2 id="map-heading">Earth observatory</h2>{datasetPeriod&&<p>Dataset period · {datasetPeriod}</p>}</div>
        <div className="map-filters">
          <label>Area<select value={areaId} onChange={event=>{setAreaId(event.target.value);setRotate(false);clearGroup()}}>
            {Object.entries(regions).map(([id,preset])=><option key={id} value={id}>{preset.name}</option>)}
          </select></label>
          <label>Date (UTC)<select value={selected} onChange={event=>chooseDate(event.target.value)} disabled={!days.length}>
            {!selected&&<option value="" disabled>{calendarLoading?'Loading dates…':'Select a date'}</option>}
            {days.map(day=><option key={day.date}>{day.date}</option>)}
          </select></label>
          <label>Sensor<select value={sensor} onChange={event=>{setSensor(event.target.value);clearGroup()}}>
            <option value="">Both instruments</option><option>MODIS</option><option>VIIRS</option>
          </select></label>
        </div>
        <div className="map-filters map-display">
          <label>Map view<select value={mapView} onChange={event=>{setMapView(event.target.value);setRotate(false)}}>
            <option value="globe" disabled={globeFailed}>3D globe</option><option value="flat">Flat map</option>
          </select></label>
          <label>Display mode<select value={detailMode?'details':'clusters'} onChange={event=>{clearGroup();setDetailMode(event.target.value==='details')}}>
            <option value="clusters">Grouped detections</option><option value="details">Individual hotspots</option>
          </select></label>
        </div>
      </div>
      {inspectedGroup&&<div className="group-panel"><p>{inspectedGroup.sensor} group · {number(inspectedGroup.count)} detections</p><button className="button" onClick={()=>{clearGroup();setDetailMode(false)}}>Back to grouped detections</button></div>}
    {globeFailed&&<p className="panel-feedback" role="status">The 3D globe could not load. Showing the flat map.</p>}
    <div ref={container} className="globe">{mapView==="flat"?<FlatMap light={light} points={mapPoints} selected={hotspot??group} bounds={mapBounds} onPointClick={detailMode?selectHotspot:openGroup}/>:<GlobeErrorBoundary onFailure={recoverGlobe}><Suspense fallback={<p className="map-placeholder" role="status">Loading 3D globe.</p>}><Globe ref={globe} width={size.width} height={size.height} backgroundColor={light?'#e5effa':'#060e21'} globeImageUrl={light ? "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg" : "https://unpkg.com/three-globe/example/img/earth-night.jpg"} bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png" atmosphereColor={light ? "#87baf4" : "#65adff"} atmosphereAltitude={.16} pointsData={mapPoints} pointLat="lat" pointLng="lng" pointColor={d=>d.sensor==='MODIS'?'#ffab66':'#a8ebbe'} pointAltitude={point=>(point===hotspot || point===group) ? .01 : .007} pointRadius={point=>(point===hotspot || point===group) ? .35 :point.count?Math.min(.75,.16+Math.log10(point.count)*.14):.13} pointsMerge={false} pointResolution={5} pointsTransitionDuration={0} onPointClick={detailMode?selectHotspot:openGroup} pathsData={studyOutline} pathPointLat={point=>point[1]} pathPointLng={point=>point[0]} pathPointAlt={.01} pathResolution={1} pathColor={()=>light?"#124eaa":"#78ceff"} pathStroke={1.5} onGlobeReady={()=>globe.current?.pointOfView(mapBounds?regionView(mapBounds):overview,850)}/></Suspense></GlobeErrorBoundary>}</div>
    <div className="map-caption">
      <div className="legend">{activeSensors.map(name=><span key={name}><i style={{background:sensorColors[name][+light]}}/> {name}</span>)}</div>
      <span role="status">{mapStatus}</span>
      {mapView==='globe'&&<button type="button" onClick={()=>setRotate(!rotate)}><RotateCcw size={16}/>{rotate?'Stop rotation':'Rotate'}</button>}
    </div>
    {partial&&<p className="panel-feedback">Hotspots are limited to 1,000 per sensor. {inspectedGroup?'Export group detections to download all records in this group.':'Choose a smaller area or select a group to inspect its hotspots.'}</p>}
    {group&&<section className="group-panel" aria-label="Selected detection group">
      <h3>{group.sensor} group · {number(group.count)} detections</h3>
      <button className="button" onClick={inspectGroup}>View hotspots in this area</button>
      <button className="button" onClick={()=>setGroup(null)}>Close group</button>
    </section>}
    {mapError && <p className="panel-feedback" role="alert">Map observations could not load. <button className="button" onClick={()=>retryMap(value=>value+1)}>Retry map</button></p>}
    {!detailMode && clusters.length>0 && <details className="visible-hotspots">
      <summary>Browse detection groups ({number(clusters.length)})</summary>
      <label>Detection group <select value={group?clusters.indexOf(group):''} onChange={event=>{
        if(event.target.value==='') setGroup(null);
        else openGroup(clusters[Number(event.target.value)]);
      }}>
        <option value="">Select a group</option>
        {clusters.map((cell,index)=><option key={cell.sensor+':'+cell.lat_cell+':'+cell.lng_cell} value={index}>
          {cell.sensor} · {number(cell.count)} detections · {cell.lat.toFixed(1)}, {cell.lng.toFixed(1)}
        </option>)}
      </select></label>
    </details>}
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
    <section className="timeline"><button className="play" aria-label={playing?'Pause timeline':'Play timeline'} disabled={!days.length} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><input aria-label="Observation day" disabled={!days.length} type="range" min="0" max={Math.max(0,days.length-1)} value={Math.max(0,days.findIndex(d=>d.date===selected))} aria-valuetext={selected} onChange={e=>chooseDate(days[+e.target.value].date)}/><time>{selected}</time><small>{days.length ? coverageLabel(current,sensor) : ""}</small></section>
    <section className="lower">
      <div className="panel" id="calendar">
        <div className="section-heading"><div><h2>Burning calendar</h2><p>Daily hotspot detections · UTC</p></div>{days.length>0&&<span>{days.length}-day window</span>}</div>
        <div className="calendar">{days.map(day=>{
          const date=new Date(day.date+'T00:00:00Z');
          const label=day.date+' · '+shownSensors.map(name=>name+' '+(day[name]==null?'unavailable':number(day[name]))).join(' · ');
          return <button key={day.date} title={label} aria-label={label} aria-pressed={selected===day.date}
            className={selected===day.date?'selected':''} style={{backgroundColor:'rgba(70,139,228,'+(.08+.65*count(day)/max)+')'}}
            onClick={()=>chooseDate(day.date)}>
            <small>{date.toLocaleDateString('en',{month:'short',timeZone:'UTC'}).toUpperCase()}</small><strong>{day.date.slice(-2)}</strong>
            {shownSensors.some(name=>day[name]==null)&&<span aria-hidden="true">–</span>}
          </button>;
        })}</div>
        <p className="footnote">Counts are for {area.name}. A dash marks missing sensor data.</p>
      </div>
      <div className="panel">
        <h2>Activity through time</h2><p>Raw detections by instrument · {area.name}</p>
          <div ref={activityChart} className="chart">
          {showActivityChart&&<Suspense fallback={<p role="status">Loading chart.</p>}>
            <ActivityChart days={days} light={light} shownSensors={shownSensors} sensorColors={sensorColors}/>
          </Suspense>}
        </div>
      </div>
    </section>
    <section className="panel comparison" id="compare">
      <div><h2>{region.name} sensor comparison</h2><p>Both sensors · Full dataset period</p><p>Compares detections on a common 1 km equal-area grid. The adjustment is fitted on the first 70% of shared days.</p></div>
      <div className="header-actions"><label>Comparison region <select value={regionId} disabled={comparing} onChange={event=>{
        setRegionId(event.target.value);
        setComparisonError('');
        setComparison(null);
      }}>{Object.entries(regions).map(([id,preset])=><option key={id} value={id}>{preset.name}</option>)}</select></label>
      <button className="button" disabled={comparing} onClick={compare}>{comparing?'Calculating…':'Run comparison'} <ArrowUpRight size={16}/></button></div>
      {comparisonError&&<p role="alert">Comparison could not load. <button className="button" onClick={compare}>Retry comparison</button></p>}
      {comparison&&!comparison.validation&&<p role="status">There are too few usable paired observations to fit and evaluate an adjustment for this area.</p>}
      {comparison?.validation&&<div className="results" role="status">
        <div><h3>Average difference from MODIS on held-out days</h3><div className="comparison-metrics">
          <span>Before adjustment<strong>{comparison.validation.raw_mae.toFixed(1)}</strong> detected cells per day</span>
          <span>After adjustment<strong>{comparison.validation.adjusted_mae.toFixed(1)}</strong> detected cells per day</span>
          <span>VIIRS adjustment factor<strong>{comparison.factor.toFixed(3)}×</strong></span>
        </div></div>
      </div>}
    </section>
    {comparison && <section className="panel" style={{marginTop:20}}>
      <div className="section-heading"><h2>Detected grid cells per day</h2><button className="button" onClick={()=>downloadComparison(comparison.days,regionId)}><Download size={16}/> Download comparison CSV</button></div>
      <Suspense fallback={<div className="chart comparison-chart" role="status">Loading chart.</div>}>
        <ComparisonChart comparison={comparison} light={light}/>
      </Suspense>
      <p>Average difference is the mean absolute error in detected grid cells per UTC day. Each cell counts once per sensor per day.</p>
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
    <footer>Historical NASA FIRMS observations <span>Hotspot detections may represent repeated observations of the same fire. Seasonal analysis requires a longer historical record.</span></footer></main></div>
}
createRoot(document.getElementById('root')).render(<App/>);














