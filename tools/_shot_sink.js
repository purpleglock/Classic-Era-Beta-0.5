// Приёмник кадров со стенда: страница шлёт dataURL, мы кладём PNG на диск.
const http=require('http'),fs=require('fs');
http.createServer((q,s)=>{
  s.setHeader('Access-Control-Allow-Origin','*');
  s.setHeader('Access-Control-Allow-Headers','*');
  if(q.method==='OPTIONS'){s.end();return;}
  let b='';q.on('data',d=>b+=d);q.on('end',()=>{
    const i=b.indexOf(',');
    const name=(q.url.replace(/[^a-z0-9_.-]/gi,'')||'shot')+'.png';
    fs.writeFileSync(name,Buffer.from(b.slice(i+1),'base64'));
    console.log('saved',name,fs.statSync(name).size);
    s.end('ok');
  });
}).listen(8248,()=>console.log('sink 8248'));
