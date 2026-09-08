export function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function stem(name='document.pdf'){return name.replace(/\.pdf$/i,'').replace(/[^\p{L}\p{N}._-]+/gu,'-')||'document';}
