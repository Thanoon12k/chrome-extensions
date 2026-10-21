'use strict';
const $=id=>document.getElementById(id);
let root, loaded=false, collections=[], records=[], view='cards', page=0, filename='data.json';
const size=40;
const obj=x=>x!==null&&typeof x==='object';
const str=x=>typeof x==='string'?x:JSON.stringify(x,null,2);
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function directed(n){n.dir=$('direction').value;return n;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function parseText(text){text=text.replace(/^\uFEFF/,'');try{return JSON.parse(text);}catch(original){const lines=text.split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)throw original;try{return lines.map(x=>JSON.parse(x));}catch{throw original;}}}
function load(text,name){try{const parsed=parseText(text);root=parsed;filename=name;loaded=true;page=0;error('');collections=[{name:'$ (whole document)',value:root}];const queue=[{value:root,path:'$',depth:0}];let visited=0;while(queue.length&&visited++<5000){const {value,path,depth}=queue.shift();if(!obj(value)||depth>5)continue;for(const [key,val] of Object.entries(value)){if(Array.isArray(val)){collections.push({name:path+'['+JSON.stringify(key)+']',value:val});}else if(obj(val)){queue.push({value:val,path:path+'['+JSON.stringify(key)+']',depth:depth+1});}}}
$('collection').replaceChildren(...collections.map((x,i)=>{const o=el('option',x.name);o.value=i;return o;}));
const preferred=Array.isArray(root)?0:collections.findIndex(x=>/\["(posts|data|items|records|results)"\]$/i.test(x.name));$('collection').value=preferred>0?preferred:collections.length>1?1:0;
$('filename').textContent=name;$('stats').textContent=new TextEncoder().encode(text).length.toLocaleString()+' bytes • '+collections.length+' collection(s)';$('workspace').hidden=false;$('welcome').hidden=true;$('search').value='';selectCollection();}catch(e){error('Could not read JSON / تعذر قراءة الملف: '+e.message);}}
async function readFile(file){if(!file)return;if(file.size>30*1024*1024){error('Please choose a file under 30 MB.');return;}try{load(await file.text(),file.name);}catch(e){error('Unable to open file: '+e.message);}}
function selectCollection(){const val=collections[Number($('collection').value)].value;records=(Array.isArray(val)?val:[val]).map((value,index)=>({value,index,search:JSON.stringify(value).toLocaleLowerCase()}));page=0;render();}
function field(key,value){const d=el('div',undefined,'field');d.append(el('span',key,'key'));const t=directed(el('div',str(value),'value'));d.append(t);return d;}
function firstField(value,keys){if(!obj(value)||Array.isArray(value))return null;return keys.find(k=>Object.hasOwn(value,k)&&typeof value[k]==='string'&&value[k].trim())||null;}
function card({value,index}){const n=el('article',undefined,'card');n.append(el('span','RECORD '+(index+1),'badge'));const title=firstField(value,['title','author','author_name','page_name','name']);const body=firstField(value,['text','full_text','fullText','post_text','postText','content','message','body','description']);if(title)n.append(directed(el('h3',value[title])));if(body)n.append(directed(el('div',value[body],'bodytext')));
if(obj(value)){const extra=Object.entries(value).filter(([k])=>k!==title&&k!==body);if(extra.length){const detail=el('details');detail.append(el('summary','All fields / كل الحقول ('+extra.length+')'));detail.addEventListener('toggle',()=>{if(detail.open&&!detail.dataset.ready){detail.dataset.ready='1';extra.forEach(([k,v])=>detail.append(field(k,v)));}});if(!body&&!title)detail.open=true;n.append(detail);}}
else n.append(directed(el('div',str(value),'bodytext')));
const urlKey=firstField(value,['url','permalink','post_url','postUrl','link']);if(urlKey){try{const url=new URL(value[urlKey]);if(['https:','http:'].includes(url.protocol)){const a=el('a','Open link ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';n.append(a);}}catch{}}
return n;}
function treeNode(key,value){if(!obj(value)){const line=el('div',undefined,'leaf');line.append(el('b',key+': '));line.append(directed(el('bdi',str(value),typeof value==='string'?'string':'')));return line;}
const d=el('details');const entries=Object.entries(value);d.append(el('summary',key+' '+(Array.isArray(value)?'['+entries.length+']':'{'+entries.length+'}')));let offset=0;const more=el('button','Load more fields');function add(){more.remove();entries.slice(offset,offset+100).forEach(([k,v])=>d.append(treeNode(k,v)));offset+=100;if(offset<entries.length)d.append(more);}more.onclick=add;d.addEventListener('toggle',()=>{if(d.open&&!d.dataset.ready){d.dataset.ready='1';add();}});return d;}

function graphValue(value){
  if(value===null)return 'null';
  if(typeof value==='string')return value.length>80?value.slice(0,77)+'…':value;
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  return '';
}
function graphNode(key,value,depth=0){
  const li=el('li');
  const node=el('div',undefined,'graph-node');
  const head=el('div',undefined,'graph-head');
  head.append(el('span',String(key),'graph-key'));
  if(obj(value)){
    head.append(el('span',Array.isArray(value)?`[${value.length}]`:`{${Object.keys(value).length}}`,'graph-type'));
  }else{
    const v=directed(el('span',graphValue(value),'graph-value'));
    head.append(v);
  }
  node.append(head); li.append(node);
  if(obj(value)){
    const entries=Object.entries(value);
    if(entries.length){
      const ul=el('ul');
      let shown=0;
      const batch=()=>{
        const end=Math.min(shown+50,entries.length);
        for(let i=shown;i<end;i++){
          const [k,v]=entries[i];
          ul.append(graphNode(k,v,depth+1));
        }
        shown=end;
        if(shown<entries.length){
          const moreLi=el('li',undefined,'graph-more-li');
          const more=el('button',`Show ${Math.min(50,entries.length-shown)} more`,'graph-more');
          more.onclick=()=>{moreLi.remove();batch();};
          moreLi.append(more);ul.append(moreLi);
        }
      };
      if(depth<2) batch();
      else {
        const expand=el('button','Expand branches','graph-expand');
        expand.onclick=()=>{expand.remove();batch();};
        node.append(expand);
      }
      li.append(ul);
    }
  }
  return li;
}
function renderGraph(current){
  const wrap=el('div',undefined,'graph-wrap');
  const forest=el('ul',undefined,'graph-tree');
  current.forEach(r=>forest.append(graphNode('['+r.index+']',r.value,0)));
  wrap.append(forest);
  return wrap;
}

function render(){if(!loaded)return;const q=$('search').value.toLocaleLowerCase().trim();const filtered=records.filter(r=>!q||r.search.includes(q));const total=Math.max(1,Math.ceil(filtered.length/size));page=Math.max(0,Math.min(page,total-1));const current=filtered.slice(page*size,(page+1)*size);const content=$('content');content.replaceChildren();content.className='';$('count').textContent=filtered.length.toLocaleString()+' of '+records.length.toLocaleString()+' records • Full text • '+(view==='raw'?'JSON shows the current page of records':'40 records per page');$('page').textContent=(page+1)+' / '+total;$('prev').disabled=page===0;$('next').disabled=page===total-1;
if(!filtered.length){content.append(el('p','No matching records / لا توجد نتائج'));return;}
if(view==='cards'||view==='reader'){content.className=view;current.forEach(r=>content.append(card(r)));}
else if(view==='table'){content.className='tablewrap';const table=el('table');const keys=[...new Set(current.flatMap(r=>obj(r.value)&&!Array.isArray(r.value)?Object.keys(r.value):['(value)']))];const head=el('thead'),tr=el('tr');keys.forEach(k=>tr.append(el('th',k)));head.append(tr);table.append(head);const tbody=el('tbody');current.forEach(r=>{const row=el('tr');keys.forEach(k=>{const isObject=obj(r.value)&&!Array.isArray(r.value);const v=isObject?r.value[k]:k==='(value)'?r.value:undefined;row.append(directed(el('td',v===undefined?'':str(v))));});tbody.append(row);});table.append(tbody);content.append(table);}
else if(view==='tree'){content.className='tree';current.forEach(r=>content.append(treeNode('['+r.index+']',r.value)));}
else if(view==='graph'){content.className='graph';content.append(renderGraph(current));}
else{content.append(el('pre',JSON.stringify(current.map(r=>r.value),null,2),'raw'));}}
$('open').onclick=$('choose').onclick=()=>$('file').click();$('file').onchange=()=>{readFile($('file').files[0]);$('file').value='';};$('parse').onclick=()=>load($('paste').value,'pasted.json');$('collection').onchange=selectCollection;$('direction').onchange=render;
let timer;$('search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;render();},180);};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));render();});$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};$('theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('theme',document.body.classList.contains('dark')?'dark':'light');};if(localStorage.getItem('theme')==='dark')document.body.classList.add('dark');
$('download').onclick=()=>{if(!loaded)return;const url=URL.createObjectURL(new Blob([JSON.stringify(root,null,2)],{type:'application/json;charset=utf-8'}));const a=el('a');a.href=url;a.download=filename.replace(/\.(json|jsonl|ndjson)$/i,'')+'.pretty.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
let dragDepth=0;window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragging');});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('dragging');});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');readFile(e.dataTransfer.files[0]);});
async function loadPendingAutoFile(){
  const params=new URLSearchParams(location.search);
  if(params.get('auto')!=='1')return;
  const tabId=params.get('tab');
  if(!tabId)return;
  try{
    const response=await chrome.runtime.sendMessage({type:'GET_PENDING_JSON',tabId});
    if(response?.ok&&response.payload){
      load(response.payload.text,response.payload.filename||'data.json');
      const clean=chrome.runtime.getURL('viewer.html');
      history.replaceState(null,'',clean);
    }
  }catch(e){error('Could not auto-open JSON: '+e.message);}
}
loadPendingAutoFile();

$('demo').onclick=()=>load(JSON.stringify({page:'Sample / مثال',posts:[{author:'الكود الذهبي',text:'عندك ملف JSON ومحتار شلون تقراه؟ 👋\nهنا تكدر تشوف النص كامل وباتجاه صحيح.\n\nجرّب عرض البطاقات، القارئ، الجدول أو الشجرة.',date:'2026-09-12',reactions:24},{author:'JSON Pretty',text:'Mixed Arabic and English?\nيدعم العربية والإنجليزية في نفس الملف.\nYour data stays on your device.',tags:['JSON','RTL','Offline']}]},null,2),'sample-posts.json');
