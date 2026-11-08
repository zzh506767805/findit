// Adapt the existing route functions to Web Request/Response without Node HTTP sockets.
export async function handleRequest(request,ctx,route) {
 const url=new URL(request.url);const headers=Object.fromEntries(request.headers);headers.host=url.host;
 const req={url:url.pathname+url.search,method:request.method,headers,socket:{remoteAddress:request.headers.get('cf-connecting-ip')},async *[Symbol.asyncIterator](){if(!request.body)return;const reader=request.body.getReader();let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Object.assign(new Error('JSON request is too large'),{status:413});yield Buffer.from(value);}}finally{reader.releaseLock();}}};
 let resolve;const response=new Promise(r=>{resolve=r;});let controller,closed=false;
 const body=new ReadableStream({start(c){controller=c;},cancel(){closed=true;}});
 const res={headersSent:false,writeHead(status,values={}){if(this.headersSent)return;this.headersSent=true;resolve(new Response(body,{status,headers:values}));},write(value){if(closed)return false;if(!this.headersSent)this.writeHead(200);controller.enqueue(typeof value==='string'?new TextEncoder().encode(value):value);return true;},end(value){if(closed)return;if(!this.headersSent)this.writeHead(200);if(value!==undefined)this.write(value);closed=true;controller.close();}};
 const operation=route(req,res).catch(error=>{if(!res.headersSent){res.writeHead(error.status||500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({error:error.message,code:error.code||'REQUEST_FAILED'}));}else{res.write('event: error\ndata: '+JSON.stringify({error:error.message})+'\n\n');res.end();}});
 ctx.waitUntil(operation);
 return response;
}
