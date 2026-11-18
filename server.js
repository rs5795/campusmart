// CampusMart backend: Express + SQLite. Layers: routes -> validation -> db.
const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),multer=require('multer'),path=require('path'),fs=require('fs'),crypto=require('crypto');
const SECRET=process.env.JWT_SECRET||'dev-secret-change-me',PORT=process.env.PORT||3000;
const DATA=process.env.DATA_DIR||__dirname; // point DATA_DIR at a persistent disk in production
if(process.env.NODE_ENV==='production'&&!process.env.JWT_SECRET){console.error('Set JWT_SECRET in production');process.exit(1)}
fs.mkdirSync(DATA,{recursive:true});
const db=new Database(process.env.DB_FILE||path.join(DATA,'campusmart.db'));
db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS universities(id INTEGER PRIMARY KEY,name TEXT UNIQUE,city TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,phone TEXT,university_id INTEGER REFERENCES universities(id),created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY,seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,university_id INTEGER REFERENCES universities(id),title TEXT,description TEXT,price REAL,category TEXT,condition TEXT,image TEXT,status TEXT DEFAULT 'active',created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,sender_id INTEGER REFERENCES users(id),seller_id INTEGER REFERENCES users(id),body TEXT,created DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_l ON listings(university_id,category,status);`);
if(!db.prepare('SELECT 1 FROM universities').get()){const i=db.prepare('INSERT INTO universities(name,city) VALUES(?,?)');
[['IIIT Allahabad','Prayagraj'],['IIT Bombay','Mumbai'],['IIT Delhi','New Delhi'],['IIT Kanpur','Kanpur'],['BITS Pilani','Pilani'],['NIT Trichy','Tiruchirappalli'],['University of Delhi','New Delhi'],['Banaras Hindu University','Varanasi'],['Anna University','Chennai'],['VIT Vellore','Vellore']].forEach(u=>i.run(...u));}
const CATS=['Books','Electronics','Furniture','Cycles & Vehicles','Clothing','Hostel Essentials','Stationery','Other'];
const CONDS=['New','Like new','Good','Fair'];
const UP=path.join(DATA,'uploads');fs.mkdirSync(UP,{recursive:true});
const upload=multer({storage:multer.diskStorage({destination:UP,filename:(q,f,cb)=>cb(null,crypto.randomUUID()+path.extname(f.originalname).toLowerCase())}),
 limits:{fileSize:3*1024*1024},fileFilter:(q,f,cb)=>cb(/^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)?null:new Error('Only JPG, PNG, WEBP or GIF images allowed'),/^image\/(jpeg|png|webp|gif)$/.test(f.mimetype))});
const app=express();app.use(express.json());
app.use('/uploads',express.static(UP));app.use(express.static(path.join(__dirname,'public')));
const bad=(res,m,c=400)=>res.status(c).json({error:m});
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET);next()}catch{bad(res,'Please log in',401)}};
const token=u=>jwt.sign({id:u.id,uid:u.university_id},SECRET,{expiresIn:'7d'});
const pub=u=>({id:u.id,name:u.name,email:u.email,phone:u.phone,university_id:u.university_id});
const clean=s=>String(s||'').trim();

app.get('/api/meta',(q,r)=>r.json({universities:db.prepare('SELECT * FROM universities ORDER BY name').all(),categories:CATS,conditions:CONDS}));
app.post('/api/register',(req,res)=>{const{name,email,password,phone,university_id}=req.body;
 if(clean(name).length<2)return bad(res,'Name is required');
 if(!/^\S+@\S+\.\S+$/.test(clean(email)))return bad(res,'Valid email is required');
 if(String(password||'').length<8)return bad(res,'Password must be at least 8 characters');
 if(!db.prepare('SELECT 1 FROM universities WHERE id=?').get(university_id))return bad(res,'Choose your university');
 if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase()))return bad(res,'Email already registered',409);
 const id=db.prepare('INSERT INTO users(name,email,pass,phone,university_id) VALUES(?,?,?,?,?)').run(clean(name),email.toLowerCase(),bcrypt.hashSync(password,10),clean(phone),university_id).lastInsertRowid;
 const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);res.json({token:token(u),user:pub(u)})});
app.post('/api/login',(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email).toLowerCase());
 if(!u||!bcrypt.compareSync(String(req.body.password||''),u.pass))return bad(res,'Invalid email or password',401);res.json({token:token(u),user:pub(u)})});
app.get('/api/me',auth,(req,res)=>res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));

const LSEL=`SELECT l.*,u.name seller_name,un.name university FROM listings l JOIN users u ON u.id=l.seller_id JOIN universities un ON un.id=l.university_id`;
app.get('/api/listings',(req,res)=>{const{uni,q,category,min,max,sort}=req.query;const w=["l.status='active'"],p=[];
 if(uni){w.push('l.university_id=?');p.push(+uni)}
 if(q){w.push('(l.title LIKE ? OR l.description LIKE ?)');p.push(`%${q}%`,`%${q}%`)}
 if(category){w.push('l.category=?');p.push(category)}
 if(min){w.push('l.price>=?');p.push(+min)} if(max){w.push('l.price<=?');p.push(+max)}
 const o={low:'l.price ASC',high:'l.price DESC'}[sort]||'l.created DESC, l.id DESC';
 res.json(db.prepare(`${LSEL} WHERE ${w.join(' AND ')} ORDER BY ${o} LIMIT 100`).all(...p))});
app.get('/api/listings/:id',(req,res)=>{const l=db.prepare(`${LSEL} WHERE l.id=?`).get(req.params.id);l?res.json(l):bad(res,'Listing not found',404)});
app.get('/api/my/listings',auth,(req,res)=>res.json(db.prepare(`${LSEL} WHERE l.seller_id=? ORDER BY l.id DESC`).all(req.user.id)));

function readListing(b){const price=+b.price;
 if(clean(b.title).length<3)return'Title must be at least 3 characters';
 if(!(price>=0)||price>10000000)return'Enter a valid price';
 if(!CATS.includes(b.category))return'Choose a category';
 if(!CONDS.includes(b.condition))return'Choose a condition';return null}
app.post('/api/listings',auth,(req,res,next)=>upload.single('image')(req,res,e=>e?bad(res,e.message):next()),(req,res)=>{
 const e=readListing(req.body);if(e)return bad(res,e);const b=req.body;
 const u=db.prepare('SELECT university_id FROM users WHERE id=?').get(req.user.id);
 const id=db.prepare('INSERT INTO listings(seller_id,university_id,title,description,price,category,condition,image) VALUES(?,?,?,?,?,?,?,?)').run(req.user.id,u.university_id,clean(b.title),clean(b.description),+b.price,b.category,b.condition,req.file?'/uploads/'+req.file.filename:null).lastInsertRowid;
 res.status(201).json({id})});
app.put('/api/listings/:id',auth,(req,res,next)=>upload.single('image')(req,res,e=>e?bad(res,e.message):next()),(req,res)=>{
 const l=db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
 if(!l)return bad(res,'Listing not found',404);if(l.seller_id!==req.user.id)return bad(res,'Not your listing',403);
 const b=req.body,e=readListing(b);if(e)return bad(res,e);
 db.prepare('UPDATE listings SET title=?,description=?,price=?,category=?,condition=?,image=?,status=? WHERE id=?').run(clean(b.title),clean(b.description),+b.price,b.category,b.condition,req.file?'/uploads/'+req.file.filename:l.image,b.status==='sold'?'sold':'active',l.id);res.json({ok:1})});
app.delete('/api/listings/:id',auth,(req,res)=>{const l=db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
 if(!l)return bad(res,'Listing not found',404);if(l.seller_id!==req.user.id)return bad(res,'Not your listing',403);
 db.prepare('DELETE FROM listings WHERE id=?').run(l.id);if(l.image)fs.unlink(path.join(DATA,l.image),()=>{});res.json({ok:1})});

app.post('/api/listings/:id/contact',auth,(req,res)=>{const l=db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
 if(!l)return bad(res,'Listing not found',404);if(l.seller_id===req.user.id)return bad(res,'This is your own listing');
 const body=clean(req.body.message);if(body.length<3)return bad(res,'Write a short message');
 db.prepare('INSERT INTO messages(listing_id,sender_id,seller_id,body) VALUES(?,?,?,?)').run(l.id,req.user.id,l.seller_id,body);
 const s=db.prepare('SELECT name,email,phone FROM users WHERE id=?').get(l.seller_id);res.json({ok:1,seller:s})});
app.get('/api/my/messages',auth,(req,res)=>res.json(db.prepare(`SELECT m.body,m.created,l.title,l.id listing_id,u.name sender,u.email,u.phone FROM messages m JOIN listings l ON l.id=m.listing_id JOIN users u ON u.id=m.sender_id WHERE m.seller_id=? ORDER BY m.id DESC`).all(req.user.id)));
app.use('/api',(q,r)=>bad(r,'Not found',404));
if(require.main===module)app.listen(PORT,()=>console.log('CampusMart running on http://localhost:'+PORT));
module.exports=app;
