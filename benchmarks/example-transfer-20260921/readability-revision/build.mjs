import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
if (!out) throw new Error('Usage: node build.mjs <output-directory>');
const src=(line,end_line,label)=>({path:'index.js',line,end_line,label});
const node=(id,type,label,sublabel,pos,sources)=>({id,type,label,sublabel,pos,size:[220,76],sources});
const candidate={schema_version:1,diagram_type:'architecture',meta:{
 title:'QuickLRU：两代缓存如何协作',locale:'zh-CN',quality_profile:'showcase',
 repository:{url:'https://github.com/sindresorhus/quick-lru.git',revision:'a2190ebdf8e455b95a7138803d274ff5ed57ebcd',link_mode:'local-only'},
 views:[
  {id:'write',label:'写入与整代轮换',focus:['quick-lru','current-map','old-map','eviction-callback'],note:'当前代没有的键写入当前代并计数；达到容量后整代轮换。下方说明保留判断条件与回调顺序。'},
  {id:'read',label:'读取与晋升',focus:['quick-lru','current-map','old-map','expiry-check'],note:'先查当前代；只有 get 命中仍有效的旧代条目才会晋升。has 与 peek 不晋升。'},
  {id:'remove',label:'过期与主动删除',focus:['quick-lru','expiry-check','eviction-callback'],note:'过期和轮换可触发 onEviction；主动 delete 与 clear 不触发。两类删除的具体规则见下方。'}
 ]},components:[
 node('caller','external','调用方','调用 API；可提供回调',[440,30],[src(9,22,'配置与回调注入'),src(105,179,'调用接口')]),
 node('quick-lru','backend','QuickLRU 控制器','持有两代 Map、计数与策略',[440,220],[src(1,23,'实例状态和策略'),src(68,83,'轮换与晋升'),src(105,179,'读写及删除接口')]),
 node('current-map','database','当前代 Map','内存条目；写入与晋升目标',[70,220],[src(2,4,'两代状态'),src(68,83,'新增与轮换'),src(120,134,'更新或新增')]),
 node('old-map','database','旧代 Map','保留上一代；命中可晋升',[810,220],[src(4,4,'旧代状态'),src(68,83,'轮换与晋升'),src(105,118,'读取旧代')]),
 node('expiry-check','backend','有效期检查','到期则通知回调并删除条目',[440,410],[src(40,65,'过期检查与取值'),src(137,157,'has 与 peek')]),
 node('eviction-callback','external','onEviction 回调','调用方提供的可选函数',[440,600],[src(30,46,'轮换和到期回调')])
 ],boundaries:[{kind:'region',label:'QuickLRU 实例 · 全部状态仅在内存中',wraps:['quick-lru','current-map','old-map','expiry-check']}],
 connections:[
  {id:'api',from:'caller',to:'quick-lru',label:'缓存 API',variant:'emphasis'},
  {id:'current-access',from:'quick-lru',to:'current-map',label:'读写与管理'},
  {id:'old-access',from:'quick-lru',to:'old-map',label:'读取与管理'},
  {id:'expiry-policy',from:'quick-lru',to:'expiry-check',label:'检查有效期'},
  {id:'expired-callback',from:'expiry-check',to:'eviction-callback',label:'条目到期'},
  {id:'rotation-callback',from:'quick-lru',to:'eviction-callback',label:'整代轮换',variant:'dashed'}
 ],cards:[
 {dot:'cyan',title:'写入：先区分当前代是否已有键',items:[
  'set 更新当前代已有键的 value 和 expiry，不增加 #size。当前代没有此键时，写入当前代并增加 #size；它仍可能存在于旧代。',
  '#size 达到 maxSize 时：先重置计数，再通知上一旧代条目的 onEviction，随后当前代变成旧代，并创建空的当前代。',
  '这是整代轮换，不是每次仅淘汰一个最久未使用的条目。两代 Map 由控制器共同管理。']},
 {dot:'emerald',title:'读取：只有有效的旧代 get 会晋升',items:[
  'get 先查当前代并处理有效期；当前代未命中才查旧代。有效的旧代命中会从旧代删除，再写入当前代；这也可能触发容量轮换。',
  'has 和 peek 都先查当前代、再查旧代并处理过期，但不会像 get 那样晋升条目。',
  '键不存在或条目已过期时，get / peek 返回 undefined，has 返回 false。']},
 {dot:'amber',title:'删除：通知条件和计数各不相同',items:[
  '到期检查比较 expiry 与 Date.now()；到期时先调用可选 onEviction(key, value)，再通过 delete 移除两代中的该键。',
  '主动 delete 同样处理两代；只有从当前代实际删除成功才递减 #size。clear 清空两代并将 #size 归零。',
  '主动 delete / clear 不调用 onEviction；轮换和过期可以调用。回调由调用方实现，外部副作用未知。']}
 ]};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'diagram.architecture.json'),JSON.stringify(candidate,null,2)+'\n');
