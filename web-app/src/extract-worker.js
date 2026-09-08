import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {headingFor, normalizeText} from './cleanup.js';
pdfjsLib.GlobalWorkerOptions.workerSrc=workerUrl;

function median(values){const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)]||10;}
function escapeMd(s){return s.replace(/([\\`*{}\[\]<>])/g,'\\$1');}
function pageMarkdown(content, options){
  const items=content.items.filter(i=>i.str?.trim()).map(i=>({text:i.str.trim(),x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.transform[3])||i.height||10}));
  if(!items.length)return {text:'',bodySize:10}; const bodySize=median(items.map(i=>i.h).filter(n=>n>4&&n<40));
  const rows=[]; for(const item of items.sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x)){
    let row=rows.find(r=>Math.abs(r.y-item.y)<=Math.max(2,item.h*.28)); if(!row){row={y:item.y,items:[]};rows.push(row);} row.items.push(item);
  }
  rows.sort((a,b)=>b.y-a.y); rows.forEach(row=>{row.items.sort((a,b)=>a.x-b.x);row.cells=[];let cell='',last=null;
    for(const item of row.items){const gap=last?item.x-(last.x+last.w):0;if(last&&gap>bodySize*2.3){row.cells.push(cell);cell='';}else if(last&&gap>Math.max(1.5,bodySize*.18))cell+=' ';cell+=item.text;last=item;}row.cells.push(cell);});
  const lines=[];for(let i=0;i<rows.length;){const row=rows[i];if(options.detectTables&&row.cells.length>=2&&row.cells.length<=6){const run=[row];let j=i+1;while(j<rows.length&&rows[j].cells.length===row.cells.length&&j-i<40){run.push(rows[j++]);}if(run.length>=3){lines.push(`| ${run[0].cells.map(v=>escapeMd(normalizeText(v))).join(' | ')} |`);lines.push(`| ${run[0].cells.map(()=> '---').join(' | ')} |`);run.slice(1).forEach(r=>lines.push(`| ${r.cells.map(v=>escapeMd(normalizeText(v))).join(' | ')} |`));i=j;continue;}}
    const text=row.cells.join(' '),size=Math.max(...row.items.map(item=>item.h)),clean=normalizeText(text),level=options.detectHeadings?headingFor(clean,size,bodySize):null;lines.push(level?`${'#'.repeat(level)} ${escapeMd(clean)}`:escapeMd(clean));i++;}
  return {text:lines.join('\n'),bodySize};
}

self.onmessage=async({data})=>{if(data.type!=='extract')return; try{
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(data.buffer),useWorkerFetch:false,isEvalSupported:false}).promise;
  for(let i=0;i<data.pages.length;i++){const pageNumber=data.pages[i];const page=await pdf.getPage(pageNumber);const [content,operators]=await Promise.all([page.getTextContent({includeMarkedContent:true}),page.getOperatorList()]);
    const result=pageMarkdown(content,data.options);const imageOps=new Set([pdfjsLib.OPS.paintImageXObject,pdfjsLib.OPS.paintInlineImageXObject,pdfjsLib.OPS.paintImageMaskXObject]);const visuals=operators.fnArray.filter(fn=>imageOps.has(fn)).length;if(visuals)result.text+=`\n\n[VISUAL_PLACEHOLDER page=${pageNumber} count=${visuals}]`;self.postMessage({type:'page',page:pageNumber,index:i,total:data.pages.length,...result});}
  self.postMessage({type:'done',total:data.pages.length});
 }catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};
