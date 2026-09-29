// North-to-south rows; triangle interpolation matches PlaneGeometry's diagonal.
export function sampleElevation(grid,u,v){
  const x=Math.max(0,Math.min(1,u))*(grid.columns-1),y=Math.max(0,Math.min(1,v))*(grid.rows-1);
  const i=Math.min(grid.columns-2,Math.floor(x)),j=Math.min(grid.rows-2,Math.floor(y)),a=x-i,b=y-j;
  const at=(dx,dy)=>grid.values[(j+dy)*grid.columns+i+dx];
  return a+b<=1?at(0,0)+(at(1,0)-at(0,0))*a+(at(0,1)-at(0,0))*b:at(1,1)+(at(0,1)-at(1,1))*(1-a)+(at(1,0)-at(1,1))*(1-b);
}
export function terrainHeight(grid,x,z){return grid?22+(sampleElevation(grid,(x+410)/820,(z+410)/820)-grid.minimum)*grid.unitsPerMeter:22;}

// Generalize sub-grid bumps for an itinerary overview, not a survey surface.
// The symmetric kernel preserves a planar slope away from the boundary.
export function generalizeElevation(values,columns,rows){
  let result=values.slice();
  for(let pass=0;pass<2;pass++){
    const previous=result;result=previous.map((_,i)=>{
      const x=i%columns,y=Math.floor(i/columns);let sum=0,weight=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const w=(dx===0?2:1)*(dy===0?2:1),cx=Math.max(0,Math.min(columns-1,x+dx)),cy=Math.max(0,Math.min(rows-1,y+dy));sum+=previous[cy*columns+cx]*w;weight+=w;
      }
      return sum/weight;
    });
  }
  return result;
}
