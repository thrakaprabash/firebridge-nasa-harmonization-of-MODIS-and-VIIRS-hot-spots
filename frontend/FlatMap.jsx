import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Minus, Plus, RotateCcw} from 'lucide-react';
import {geoArea, geoEquirectangular, geoPath} from 'd3-geo';

const boundariesUrl = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
const palette = ['#f3d58a','#f5b38e','#c7d995','#e0b6c9','#acd8c8','#e6ba81'];
const projection = geoEquirectangular().scale(1000/(2*Math.PI)).translate([500,250]).precision(.2);
const path = geoPath(projection);
const world = {x:0,y:0,width:1000,height:500};

function constrain(x,y,width) {
  const height=width/2;
  return {x:Math.max(0,Math.min(1000-width,x)),y:Math.max(0,Math.min(500-height,y)),width,height};
}

function focusBounds(bounds) {
  if(!bounds || bounds[0]>bounds[2]) return world;
  const [west,south,east,north]=bounds;
  const [x,y]=projection([west,north]);
  const [right,bottom]=projection([east,south]);
  const width=Math.min(1000,Math.max(80,1.35*(right-x),2.7*(bottom-y)));
  return constrain((x+right-width)/2,(y+bottom-width/2)/2,width);
}

function normalizeCountry(feature) {
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return {
    ...feature,
    geometry: {
      type:'MultiPolygon',
      coordinates:polygons.map(rings =>
        geoArea({type:'Polygon',coordinates:rings}) > 2*Math.PI
          ? rings.map(ring => [...ring].reverse())
          : rings),
    },
  };
}

export default function FlatMap({points, bounds, light, selected, onPointClick}) {
  const [countries,setCountries]=useState([]);
  const [status,setStatus]=useState('loading');
  const [view,setView]=useState(()=>focusBounds(bounds));
  const drag=useRef(null);
  useEffect(()=>setView(focusBounds(bounds)),[bounds]);
  useEffect(()=>{
    if(!selected) return;
    const [x,y]=projection([selected.lng,selected.lat]);
    setView(current=>{
      if(x>=current.x && x<=current.x+current.width &&
         y>=current.y && y<=current.y+current.height) return current;
      return constrain(x-current.width/2,y-current.height/2,current.width);
    });
  },[selected]);

  function zoom(factor) {
    setView(current=>{
      const width=Math.max(40,Math.min(1000,current.width*factor));
      return constrain(current.x+(current.width-width)/2,current.y+(current.width-width)/4,width);
    });
  }

  function startPan(event) {
    if(event.button!==0 || event.target.closest('circle[data-hotspot]') || view.width===1000) return;
    const scale=event.currentTarget.getScreenCTM()?.a;
    if(!scale) return;
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,view,scale};
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pan(event) {
    const start=drag.current;
    if(start?.id!==event.pointerId) return;
    setView(constrain(start.view.x-(event.clientX-start.x)/start.scale,
      start.view.y-(event.clientY-start.y)/start.scale,start.view.width));
  }
  useEffect(()=>{
    const controller=new AbortController();
    fetch(boundariesUrl,{signal:controller.signal}).then(response=>{
      if(!response.ok) throw new Error('Boundary download failed');
      return response.json();
    }).then(data=>{
      setCountries(data.features.filter(feature=>feature.geometry).map(normalizeCountry));
      setStatus('ready');
    }).catch(error=>{if(error.name!=='AbortError')setStatus('error')});
    return()=>controller.abort();
  },[]);
  const countryShapes=useMemo(()=>countries.map((country,index)=>{
    const [x,y]=path.centroid(country);
    return {name:country.properties.NAME, shape:path(country), color:palette[index%palette.length],x,y,area:path.area(country)};
  }),[countries]);

  const rectangles = bounds ? (() => {
    const [west,south,east,north]=bounds;
    return (west>east?[[west,180],[-180,east]]:[[west,east]]).map(([left,right])=>{
      const [x,y]=projection([left,north]);
      const [endX,endY]=projection([right,south]);
      return {x,y,width:endX-x,height:endY-y};
    });
  })() : [];

  return <div className={light?'flat-map':'flat-map flat-map-dark'}>
    {status!=='ready' && <p className="flat-map-status" role="status">
      {status==='loading'?'Loading country boundaries…':'Country boundaries unavailable. Hotspots are still shown.'}
    </p>}
    <svg viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      className={view.width<1000?'map-pannable':undefined}
      onPointerDown={startPan} onPointerMove={pan} onLostPointerCapture={()=>{drag.current=null}}
      aria-label="Flat world map with satellite hotspot detections">
      <rect width="1000" height="500" className="map-ocean"/>
      <path d={path({type:'MultiLineString',coordinates:[
        ...Array.from({length:11},(_,i)=>[[-150+i*30,-89],[-150+i*30,89]]),
        ...Array.from({length:5},(_,i)=>Array.from({length:37},(_,j)=>[-180+j*10,-60+i*30])),
      ]})} className="map-graticule"/>
      {countryShapes.map((country,index)=><path key={index} d={country.shape} fill={country.color} className="map-country">
        <title>{country.name}</title>
      </path>)}
      {countryShapes.filter(country=>country.area>1300*(view.width/1000)**2).map((country,index)=>
        <text key={index} x={country.x} y={country.y} style={{fontSize:10*view.width/1000}}
          className="map-country-label">{country.name}</text>)}
      {rectangles.map((rectangle,index)=><rect key={index} {...rectangle} className="map-study-outline"/>)}
      {points.map((point,index)=>{
        const [x,y]=projection([point.lng,point.lat]);
        return <circle key={index} cx={x} cy={y} r={(point===selected ? 5 : point.count ? 2+Math.min(9,Math.log10(point.count)*2.4) : 2.7)*view.width/1000} data-hotspot={onPointClick?true:undefined} data-selected={point===selected?true:undefined} className={point.sensor==='MODIS'?'map-modis':'map-viirs'}
          onClick={onPointClick ? ()=>onPointClick(point) : undefined}>
          <title>{point.count ? point.sensor+" · "+point.count.toLocaleString()+" detections" : point.sensor+" · "+point.lat.toFixed(3)+", "+point.lng.toFixed(3)}</title>
        </circle>;
      })}
    </svg>
    <div className="map-tools" aria-label="Flat map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={view.width<=40} onClick={()=>zoom(.7)}><Plus size={17}/></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={view.width>=1000} onClick={()=>zoom(1/.7)}><Minus size={17}/></button>
      <button type="button" aria-label="Reset map view" title="Reset map view" onClick={()=>setView(focusBounds(bounds))}><RotateCcw size={15}/></button>
    </div>
    <a className="map-source" href="https://www.naturalearthdata.com/">Country boundaries: Natural Earth</a>
  </div>;
}

