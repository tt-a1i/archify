// North-to-south rows; triangle interpolation matches PlaneGeometry's diagonal.
export function sampleElevation(grid,u,v){
  const x=Math.max(0,Math.min(1,u))*(grid.columns-1),y=Math.max(0,Math.min(1,v))*(grid.rows-1);
  const i=Math.min(grid.columns-2,Math.floor(x)),j=Math.min(grid.rows-2,Math.floor(y)),a=x-i,b=y-j;
  const at=(dx,dy)=>grid.values[(j+dy)*grid.columns+i+dx];
  return a+b<=1?at(0,0)+(at(1,0)-at(0,0))*a+(at(0,1)-at(0,0))*b:at(1,1)+(at(0,1)-at(1,1))*(1-a)+(at(1,0)-at(1,1))*(1-b);
}
export function terrainHeight(grid,x,z){return grid?22+(sampleElevation(grid,(x+410)/820,(z+410)/820)-grid.minimum)*grid.unitsPerMeter:22;}
