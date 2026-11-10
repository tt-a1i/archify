import pathlib,subprocess,json
out=pathlib.Path(__file__).resolve().parent
base='''#![allow(dead_code, unused_imports)]
mod a { pub struct A; pub fn run()->A { A } }
mod b { pub mod a { pub struct B; pub fn run()->B { B } } use a::run; pub fn check(){ let _: EXPECTED = run(); } }
'''
cases=[
 ('use-root-2015','2015',base.replace('EXPECTED','crate::a::A'),0),
 ('use-local-2018','2018',base.replace('EXPECTED','self::a::B'),0),
 ('use-local-2021','2021',base.replace('EXPECTED','self::a::B'),0),
 ('wrong-local-2015','2015',base.replace('EXPECTED','self::a::B'),1),
 ('wrong-root-2018','2018',base.replace('EXPECTED','crate::a::A'),1),
 ('block-use-hoisted','2021','mod a {pub fn run(){}} fn caller(){run();use crate::a::run;}',0),
 ('value-does-not-shadow-module','2021','mod a {pub fn run(){}} fn caller(){let a=0;a::run();let _=a;}',0),
 ('parameter-shadows-function','2021','fn run()->u8{0} fn caller(run:fn()->u16){let _:u16=run();}',0),
 ('local-let-follows-initializer','2021','fn run()->u8{0} fn caller(){let run=run();let _:u8=run;}',0),
 ('generic-trait-dispatch','2021','trait T{fn run();} fn caller<F:T>(){F::run();}',0),
 ('macro-generated-definition','2021','macro_rules! make{()=>{fn generated(){}}} make!();fn caller(){generated();}',0),
 ('cfg-exclusive-definition','2021','#[cfg(feature="chosen")]fn run(){} #[cfg(not(feature="chosen"))]fn run(){} fn caller(){run();}',0),
]
rows=[]
for name,edition,source,exit in cases:
 f=out/(name+'.rs');f.write_text(source+'\n');cmd=['rustc','--edition',edition,'--crate-type','lib','--emit','metadata','-o',str(out/(name+'.rmeta')),str(f)]
 p=subprocess.run(cmd,text=True,capture_output=True);rows.append({'name':name,'edition':edition,'expectedCompile':exit==0,'compiled':p.returncode==0,'exit':p.returncode,'command':cmd,'stderr':p.stderr})
 assert (p.returncode==0)==(exit==0),(name,p.stderr)
(out/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print('compiler controls:',len(rows),'match expected')
