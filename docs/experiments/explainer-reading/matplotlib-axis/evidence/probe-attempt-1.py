import json,sys,hashlib,math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':14,'axes.labelsize':14,'axes.titlesize':16,'xtick.labelsize':14,'ytick.labelsize':14,'figure.facecolor':'white','axes.facecolor':'white','text.color':'#202b38','axes.labelcolor':'#202b38','xtick.color':'#202b38','ytick.color':'#202b38'})
results=[]
for name,lower in [('zero',0),('cropped',70)]:
 fig,ax=plt.subplots(figsize=(4.8,3.6),dpi=160)
 fig.subplots_adjust(left=.18,right=.97,bottom=.16,top=.90)
 bars=ax.bar(['A','B'],[80,100],width=.58,color=['#477eaa','#3d947d'],zorder=3)
 ax.set_ylim(0,110)
 before=[{'bottom':float(b.get_y()),'height':float(b.get_height())} for b in bars]
 ax.set_ylim(lower,110)
 ax.set_ylabel('Value');ax.spines[['top','right']].set_visible(False)
 ax.spines[['left','bottom']].set_color('#9aa5af')
 ax.grid(axis='y',color='#dce2e7',linewidth=.8,zorder=0)
 ax.bar_label(bars,padding=5,fontsize=16,fontweight='bold')
 fig.canvas.draw();renderer=fig.canvas.get_renderer();clip=ax.get_window_extent(renderer)
 data=[]
 for bar in bars:
  box=bar.get_window_extent(renderer)
  visible=max(0,min(box.y1,clip.y1)-max(box.y0,clip.y0))
  data.append({'bottom':float(bar.get_y()),'height':float(bar.get_height()),'visibleDataLength':max(0,min(bar.get_y()+bar.get_height(),110)-max(bar.get_y(),lower)),'visiblePixelHeight':round(visible,6),'clipOn':bar.get_clip_on()})
 assert before==[{'bottom':x['bottom'],'height':x['height']} for x in data]
 ratio=data[1]['visiblePixelHeight']/data[0]['visiblePixelHeight'];expected=1.25 if lower==0 else3
 assert math.isclose(ratio,expected,abs_tol=1e-6)
 file=out/(name+'.png');fig.savefig(file,dpi=160,facecolor='white',metadata={'Software':'Matplotlib '+matplotlib.__version__})
 results.append({'name':name,'values':[80,100],'before':before,'ylim':[float(x) for x in ax.get_ylim()],'yticks':[float(x) for x in ax.get_yticks()],'bars':data,'visiblePixelRatio':round(ratio,8),'dataRatio':1.25,'difference':20,'relativeIncrease':.25,'pngSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'pngSize':[int(fig.bbox.width),int(fig.bbox.height)]})
 plt.close(fig)
print(json.dumps({'python':sys.version.split()[0],'matplotlib':matplotlib.__version__,'backend':matplotlib.get_backend(),'scope':'Two positive synthetic values; linear y axis; default zero-bottom bars. PNGs are actual Matplotlib outputs, not illustrative recreations.','cases':results},indent=2))
