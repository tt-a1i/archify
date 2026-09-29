import * as THREE from 'three';
import {terrainHeight} from './elevation.js';
import {VISUAL} from './visual-style.js';

export function addRelief(world,grid){
  const geometry=new THREE.PlaneGeometry(820,820,grid.columns-1,grid.rows-1);geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position,colors=[],levels=[];
  // Use the generalized range; percentile stretching exaggerated tiny bumps.
  const low=grid.minimum,high=grid.maximum;
  const palette=VISUAL.terrainColors.map(c=>new THREE.Color(c));
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),y=terrainHeight(grid,x,z);positions.setY(i,y);
    const fraction=Math.max(0,Math.min(1,(grid.values[i]-low)/Math.max(1,high-low))),step=fraction*(palette.length-1),band=Math.min(palette.length-2,Math.floor(step));
    levels.push(fraction);
    const color=palette[band].clone().lerp(palette[band+1],step-band);colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  geometry.setAttribute('terrainLevel',new THREE.Float32BufferAttribute(levels,1));
  const groundMaterial=new THREE.MeshStandardMaterial({roughness:1});
  // Classify height in the fragment shader instead of blurring vertex colors
  // across triangles. Narrow screen-antialiased transitions keep bands legible.
  groundMaterial.onBeforeCompile=shader=>{
    palette.forEach((color,i)=>shader.uniforms['terrainColor'+i]={value:color});
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float terrainLevel; varying float vTerrainLevel;').replace('#include <begin_vertex>','#include <begin_vertex>\nvTerrainLevel = terrainLevel;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vTerrainLevel; uniform vec3 terrainColor0; uniform vec3 terrainColor1; uniform vec3 terrainColor2; uniform vec3 terrainColor3;').replace('#include <color_fragment>',`#include <color_fragment>
      float bandWidth = max(fwidth(vTerrainLevel), 0.002);
      vec3 terrainTint = mix(terrainColor0, terrainColor1, smoothstep(0.3-bandWidth,0.3+bandWidth,vTerrainLevel));
      terrainTint = mix(terrainTint, terrainColor2, smoothstep(0.6-bandWidth,0.6+bandWidth,vTerrainLevel));
      terrainTint = mix(terrainTint, terrainColor3, smoothstep(0.85-bandWidth,0.85+bandWidth,vTerrainLevel));
      diffuseColor.rgb *= terrainTint;`);
  };
  const mesh=new THREE.Mesh(geometry,groundMaterial);mesh.receiveShadow=true;mesh.castShadow=true;mesh.userData.disposeMaterial=true;world.add(mesh);
  // Close the uneven perimeter down to the existing soil base.
  const edge=[];for(let c=0;c<grid.columns;c++)edge.push(c);for(let r=1;r<grid.rows;r++)edge.push(r*grid.columns+grid.columns-1);for(let c=grid.columns-2;c>=0;c--)edge.push((grid.rows-1)*grid.columns+c);for(let r=grid.rows-2;r>0;r--)edge.push(r*grid.columns);
  const vertices=[];
  for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length],pa=[positions.getX(a),positions.getY(a),positions.getZ(a)],pb=[positions.getX(b),positions.getY(b),positions.getZ(b)],ba=[pa[0],-1,pa[2]],bb=[pb[0],-1,pb[2]];vertices.push(...pa,...ba,...pb,...pb,...ba,...bb);}
  const side=new THREE.BufferGeometry();side.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));side.computeVertexNormals();const skirt=new THREE.Mesh(side,new THREE.MeshStandardMaterial({color:0x9fae85,roughness:1,side:THREE.DoubleSide}));skirt.userData.disposeMaterial=true;world.add(skirt);
}

// Match water subdivision to the medium-resolution overview mesh.
export function drapeWater(geometry,grid){
  const source=geometry.index?geometry.toNonIndexed():geometry,ps=source.attributes.position,vertices=[];
  const split=(a,b,c,depth)=>{
    const pairs=[[a,b,c],[b,c,a],[c,a,b]].sort((u,v)=>v[0].distanceToSquared(v[1])-u[0].distanceToSquared(u[1]));
    const [p,q,r]=pairs[0];if(depth<16&&p.distanceToSquared(q)>(820/(grid.columns-1))**2){const mid=p.clone().add(q).multiplyScalar(.5);split(p,mid,r,depth+1);split(mid,q,r,depth+1);}else for(const v of [a,b,c])vertices.push(v.x,terrainHeight(grid,v.x,v.z)-22,v.z);
  };
  for(let i=0;i<ps.count;i+=3)split(...[0,1,2].map(n=>new THREE.Vector3().fromBufferAttribute(ps,i+n)),0);
  if(source!==geometry)source.dispose();geometry.dispose();const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));result.computeVertexNormals();return result;
}
