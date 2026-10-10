import {build} from 'esbuild';
import {rm,cp} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['src/App.tsx'],bundle:true,outfile:'dist/app.js',format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'},target:['es2020'],jsx:'automatic'});
