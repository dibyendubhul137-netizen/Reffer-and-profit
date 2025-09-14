// backend/server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
function loadData(){ try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e){ return { users:{}, recharges:[], withdraws:[], plans:[] }; } }
function saveData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme123'; // set this in production environment

let db = loadData();
if(!db.plans || db.plans.length===0){
  db.plans = [
    { id:1, name:'Starter', price:399, validity_days:7, ads_per_day:3, earning_per_ad:8 },
    { id:2, name:'Pro', price:599, validity_days:10, ads_per_day:5, earning_per_ad:10 },
    { id:3, name:'Premium', price:999, validity_days:15, ads_per_day:7, earning_per_ad:15 }
  ];
  saveData(db);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------- Helpers ----------
function requireAdmin(req, res, next){
  const token = req.headers['x-admin-token'] || '';
  if(token !== ADMIN_TOKEN) return res.status(401).json({ error: 'admin auth required' });
  next();
}

// ---------- Public endpoints ----------
// Register a user (creates simple userId/password entries)
app.post('/api/register', (req,res)=>{
  const { userId, password, payPassword } = req.body;
  if(!userId || !password || !payPassword) return res.status(400).json({error:'missing fields'});
  if(db.users[userId]) return res.status(409).json({error:'user exists'});
  db.users[userId] = { loginHash: password, payHash: payPassword, balance:0, purchases:[], created: Date.now() };
  saveData(db);
  res.json({ ok:true, userId });
});

// Login
app.post('/api/login', (req,res)=>{
  const { userId, password } = req.body;
  const u = db.users[userId];
  if(!u || u.loginHash !== password) return res.status(401).json({error:'invalid'});
  res.json({ ok:true, user: { userId, balance:u.balance, purchases: u.purchases || [] } });
});

// Get available plans
app.get('/api/plans', (req,res)=> res.json(db.plans));

// Create a recharge record (user says they paid to UPI)
app.post('/api/recharge', (req,res)=>{
  const { userId, amount, note, plan_id } = req.body;
  if(!userId || !amount) return res.status(400).json({error:'missing'});
  const rec = { id: Date.now(), userId, amount:Number(amount), note: note||'', plan_id: plan_id||null, status:'pending', ts:Date.now() };
  db.recharges.push(rec);
  saveData(db);
  // notify admin: in this demo we just return ok
  res.json({ok:true, recharge:rec});
});

// Create a withdraw request
app.post('/api/withdraw', (req,res)=>{
  const { userId, name, upi, mobile, payPassword } = req.body;
  if(!userId || !name || !upi || !payPassword) return res.status(400).json({error:'missing'});
  const user = db.users[userId];
  if(!user) return res.status(404).json({error:'user not found'});
  if(user.payHash !== payPassword) return res.status(401).json({error:'invalid payment password'});
  const w = { id: Date.now(), userId, name, upi, mobile, status:'pending', ts:Date.now() };
  db.withdraws.push(w);
  saveData(db);
  res.json({ok:true, withdraw: w});
});

// ---------- Admin endpoints ----------
app.get('/api/admin/pending', requireAdmin, (req,res)=>{
  res.json({
    recharges: db.recharges.filter(r=>r.status==='pending'),
    withdraws: db.withdraws.filter(w=>w.status==='pending'),
    users: Object.keys(db.users).map(k=>({ userId:k, balance: db.users[k].balance, purchases: db.users[k].purchases || [] }))
  });
});

app.post('/api/admin/approve-recharge', requireAdmin, (req,res)=>{
  const { id } = req.body;
  const rec = db.recharges.find(r=>r.id==id);
  if(!rec) return res.status(404).json({error:'notfound'});
  rec.status = 'approved';
  if(db.users[rec.userId]) db.users[rec.userId].balance = (db.users[rec.userId].balance||0) + Number(rec.amount);
  // If plan purchase attach plan validity
  if(rec.plan_id){
    const plan = db.plans.find(p=>p.id==rec.plan_id);
    if(plan){
      const start = Date.now();
      const end = start + plan.validity_days*24*3600*1000;
      db.users[rec.userId].purchases.push({ plan_id: plan.id, start, end });
    }
  }
  saveData(db);
  res.json({ok:true});
});

app.post('/api/admin/approve-withdraw', requireAdmin, (req,res)=>{
  const { id } = req.body;
  const w = db.withdraws.find(x=>x.id==id);
  if(!w) return res.status(404).json({error:'notfound'});
  w.status = 'approved';
  // NOTE: here you should actually perform payment externally; demo just updates status
  saveData(db);
  res.json({ok:true});
});

// Admin create plan or update
app.post('/api/admin/plan', requireAdmin, (req,res)=>{
  const { id, name, price, validity_days, ads_per_day, earning_per_ad } = req.body;
  if(!name || !price) return res.status(400).json({error:'missing'});
  if(id){
    const p = db.plans.find(x=>x.id==id);
    if(!p) return res.status(404).json({error:'plan not found'});
    Object.assign(p, { name, price, validity_days, ads_per_day, earning_per_ad });
  } else {
    const newId = (db.plans.reduce((s,p)=>Math.max(s,p.id),0) || 0) + 1;
    db.plans.push({ id:newId, name, price, validity_days, ads_per_day, earning_per_ad });
  }
  saveData(db);
  res.json({ok:true, plans: db.plans});
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log('API listening on',PORT));
