let activeOrigin='',activeToken='';
export function setMediaSession(apiUrl,token) {try{activeOrigin=new URL(apiUrl).origin;}catch{activeOrigin='';}activeToken=token||'';}
export function authorizedImageSource(source) {
 if(!source||typeof source==='number'||!source.uri||!activeToken)return source;
 try{if(new URL(source.uri).origin===activeOrigin)return {...source,headers:{...source.headers,Authorization:`Bearer ${activeToken}`}};}catch{}
 return source;
}
