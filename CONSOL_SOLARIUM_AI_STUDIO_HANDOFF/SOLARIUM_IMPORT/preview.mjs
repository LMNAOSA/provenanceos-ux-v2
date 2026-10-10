import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml'};
createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}const info=await stat(path);if(!info.isFile())throw new Error('Not a file');res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Length':info.size});createReadStream(path).pipe(res);}catch{res.writeHead(404);res.end('Not found');}}).listen(3000,'127.0.0.1',()=>console.log('Opal Light Box: http://localhost:3000'));
