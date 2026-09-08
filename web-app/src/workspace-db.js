import {openDB} from 'idb';
const DB='pdf-sanitizer-browser',META='metadata',PAGES='pages',PDF='pdf',LOGS='logs',CURRENT='current';let database;
async function db(){return database ||= openDB(DB,3,{upgrade(value){for(const name of [META,PAGES,PDF,LOGS])if(!value.objectStoreNames.contains(name))value.createObjectStore(name,{autoIncrement:name===LOGS});if(value.objectStoreNames.contains('workspaces'))value.deleteObjectStore('workspaces');}});}
export async function startWorkspace(meta,pdfBytes){const value=await db(),tx=value.transaction([META,PAGES,PDF,LOGS],'readwrite');await Promise.all([tx.objectStore(META).put({...meta,schema:3,updatedAt:new Date().toISOString()},CURRENT),tx.objectStore(PDF).put(pdfBytes,CURRENT),tx.objectStore(PAGES).clear(),tx.objectStore(LOGS).clear()]);await tx.done;}
export async function savePage(page){const value=await db();await value.put(PAGES,page,page.page);}
export async function saveResult(meta){const value=await db(),previous=await value.get(META,CURRENT);await value.put(META,{...previous,...meta,schema:3,updatedAt:new Date().toISOString()},CURRENT);}
export async function appendStoredLog(event){await (await db()).add(LOGS,event);}
export async function loadWorkspace(){const value=await db(),meta=await value.get(META,CURRENT);if(!meta)return null;const [pdfBytes,pageValues,logs]=await Promise.all([value.get(PDF,CURRENT),value.getAll(PAGES),value.getAll(LOGS)]);return {...meta,pdfBytes,pages:Object.fromEntries(pageValues.map(page=>[page.page,page])),logs};}
export async function clearWorkspace(){const value=await db(),tx=value.transaction([META,PAGES,PDF,LOGS],'readwrite');await Promise.all([META,PAGES,PDF,LOGS].map(name=>tx.objectStore(name).clear()));await tx.done;}
export function serializeWorkspace(value){return JSON.stringify({...value,pdfBytes:value.pdfBytes?arrayToBase64(value.pdfBytes):null,schema:3,exportedAt:new Date().toISOString()});}
export function deserializeWorkspace(text){const value=JSON.parse(text);if(![2,3].includes(value.schema))throw new Error('Unsupported workspace format.');if(value.pdfBytes)value.pdfBytes=base64ToArray(value.pdfBytes);return {...value,schema:3};}
function arrayToBase64(buffer){const bytes=new Uint8Array(buffer);let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}
function base64ToArray(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes.buffer;}
