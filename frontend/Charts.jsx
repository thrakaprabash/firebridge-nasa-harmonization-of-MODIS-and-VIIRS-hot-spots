import React from 'react';
import {AreaChart,Area,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,LineChart,Line,ReferenceArea,Legend} from 'recharts';

export function ActivityChart({days, light, shownSensors, sensorColors}) {
  return <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={days}><CartesianGrid stroke={light?'#cfdaea':'#243759'} vertical={false}/>
            <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/>
            <YAxis width={45} tickFormatter={v=>v>=1000?v/1000+'k':v} tick={{fill:light?'#435773':'#91a1b3',fontSize:10}}/>
            <Tooltip contentStyle={{background:light?'#fff':'#102548',border:'1px solid #7890ae',borderRadius:10}}/>
            <Legend/>
            {shownSensors.map(name=><Area key={name} dataKey={name} stroke={sensorColors[name][+light]} fill={sensorColors[name][+light]} fillOpacity={.12}/>)}
          </AreaChart>
        </ResponsiveContainer>;
}

export function ComparisonChart({comparison, light}) {
  return <div className="chart comparison-chart"><ResponsiveContainer width="100%" height="100%">
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
      </ResponsiveContainer></div>;
}
