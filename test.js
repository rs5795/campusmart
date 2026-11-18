// System/integration test: node test.js  (uses a temp DB)
process.env.DB_FILE=':memory:';const app=require('./server'),assert=require('assert');
const s=app.listen(0,async()=>{const B='http://localhost:'+s.address().port+'/api';
 const j=async(p,o={},t)=>{const r=await fetch(B+p,{...o,headers:{'Content-Type':'application/json',...(t&&{Authorization:'Bearer '+t})}});return{s:r.status,d:await r.json()}};
 const post=(p,b,t)=>j(p,{method:'POST',body:JSON.stringify(b)},t);let n=0;const ok=(c,m)=>{assert(c,m);console.log('PASS',m);n++};
 try{
 let r=await post('/register',{name:'A',email:'a@x.com',password:'password1',university_id:1});ok(r.s===400,'TC01 short name rejected');
 r=await post('/register',{name:'Asha',email:'a@x.com',password:'short',university_id:1});ok(r.s===400,'TC02 weak password rejected');
 r=await post('/register',{name:'Asha',email:'a@x.com',password:'password1',university_id:1});ok(r.s===200&&r.d.token,'TC03 register ok');const T=r.d.token;
 r=await post('/register',{name:'Asha',email:'a@x.com',password:'password1',university_id:1});ok(r.s===409,'TC04 duplicate email rejected');
 r=await post('/login',{email:'a@x.com',password:'wrong'});ok(r.s===401,'TC05 bad login rejected');
 r=await post('/login',{email:'a@x.com',password:'password1'});ok(r.s===200,'TC06 login ok');
 const fd=new FormData();Object.entries({title:'DSA Book',price:250,category:'Books',condition:'Good',description:'CLRS'}).forEach(([k,v])=>fd.append(k,v));
 let x=await fetch(B+'/listings',{method:'POST',body:fd});ok(x.status===401,'TC07 create needs login');
 x=await fetch(B+'/listings',{method:'POST',body:fd,headers:{Authorization:'Bearer '+T}});ok(x.status===201,'TC08 create listing');
 r=await j('/listings?uni=1&q=DSA&category=Books');ok(r.d.length===1,'TC09 search + filter');
 r=await j('/listings?uni=2');ok(r.d.length===0,'TC10 university isolation');
 r=await post('/register',{name:'Ravi',email:'r@x.com',password:'password1',university_id:1});const T2=r.d.token;
 r=await j('/listings/1',{method:'DELETE'},T2);ok(r.s===403,'TC11 only owner can delete');
 r=await post('/listings/1/contact',{message:'Is it available?'},T2);ok(r.s===200&&r.d.seller.email,'TC12 contact seller');
 r=await j('/my/messages',{},T);ok(r.d.length===1,'TC13 seller inbox');
 r=await j('/listings/1',{method:'DELETE'},T);ok(r.s===200,'TC14 owner deletes');
 console.log(`\nAll ${n} tests passed`)}catch(e){console.error('FAIL',e.message);process.exitCode=1}s.close()});
