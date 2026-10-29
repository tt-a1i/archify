import collections, json, math
from pathlib import Path
p=Path('ARCHIVED_SOURCE/sqlite.coz')
events=collections.Counter(); selected=set(); points=collections.Counter(); data={}; current=None
for line in p.read_text().splitlines():
    parts=line.split('\t'); typ=parts[0]; events[typ]+=1
    attrs=dict(s.split('=',1) for s in parts[1:] if '=' in s)
    if typ=='experiment':
        current=attrs; selected.add(attrs['selected'])
    elif typ in ('progress-point','throughput-point','throughput_point'):
        points[attrs['name']]+=1
        if current is None: continue
        key=(current['selected'],attrs['name'],float(current['speedup']))
        row=data.setdefault(key,{'duration':0,'delta':0,'records':0})
        row['duration']+=int(current['duration']); row['delta']+=int(attrs['delta']); row['records']+=1
by=collections.defaultdict(dict)
for (sel,point,speed),v in data.items(): by[(sel,point)][speed]=v
result=[]
for (sel,pt),speeds in sorted(by.items()):
    def calc(min_delta):
        base=speeds.get(0.0)
        def valid(v): return v['delta'] >= min_delta and v['delta'] != 0 and v['duration'] >= 0
        if not base or not valid(base): return []
        baseline=base['duration']/base['delta']
        if baseline==0 or not math.isfinite(baseline): return []
        out=[]
        for speed,v in sorted(speeds.items()):
            if valid(v):
                change=(baseline-v['duration']/v['delta'])/baseline
                if math.isfinite(change) and -1 <= change <= 2: out.append({'virtual':speed,'progress':round(change,8),'delta':v['delta'],'records':v['records']})
        return out
    result.append({'selected':sel,'point':pt,'zero_present':0.0 in speeds,'raw_speedups':sorted(speeds),'online_points':calc(0),'current_points':calc(5)})
summary={'event_types':dict(events),'selected_source_lines':len(selected),'progress_point_records':dict(points),'selected_point_pairs':len(by),'zero_present_pairs':sum(x['zero_present'] for x in result),'online_threshold10':sum(len(x['online_points'])>=10 for x in result),'current_threshold10':sum(len(x['current_points'])>=10 for x in result),'online_threshold5':sum(len(x['online_points'])>=5 for x in result),'current_threshold5':sum(len(x['current_points'])>=5 for x in result),'lines':result}
Path('ARCHIVED_SOURCE/analysis.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='lines'},indent=2))
for x in result:
 if 5 <= len(x['online_points']) < 10 and max([abs(y['progress']) for y in x['online_points']] or [0])>.05:
  print(x['selected'], 'raw',len(x['raw_speedups']),'online',len(x['online_points']),'current',len(x['current_points']), 'points',x['online_points'])
