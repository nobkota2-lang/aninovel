const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname,PORT=8765;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.gif':'image/gif','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  try{
    let up=decodeURIComponent(req.url.split('?')[0]);
    if(up==='/')up='/index.html';
    const fp=path.join(ROOT,up);
    if(!fp.startsWith(ROOT)){res.writeHead(403);res.end('Forbidden');return;}
    fs.stat(fp,(err,st)=>{
      if(err||!st.isFile()){res.writeHead(404);res.end('Not found: '+up);return;}
      res.writeHead(200,{'Content-Type':MIME[path.extname(fp).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
      fs.createReadStream(fp).pipe(res);
    });
  }catch(e){res.writeHead(500);res.end(String(e));}
}).listen(PORT,()=>console.log('http://localhost:'+PORT+'/ serving '+ROOT));
