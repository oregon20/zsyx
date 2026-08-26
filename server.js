const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 源初管理员密钥
const ROOT_KEY = "02297";

// 连接数据库
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error(err.message);
  else console.log('数据库连接成功');
});

// 初始化数据表
db.serialize(() => {
  // 玩家基础数据表
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    talentList TEXT DEFAULT '[]',
    cursePending TEXT DEFAULT '[]',
    props TEXT DEFAULT '[]',
    carrySlot TEXT DEFAULT '[]'
  )`);
  // 道具赠送审核表
  db.run(`CREATE TABLE IF NOT EXISTS gift_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    prop TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
  )`);
});

// 玩家登录/注册
app.post('/api/player/login', (req, res) => {
  const { name } = req.body;
  db.get(`SELECT * FROM players WHERE name = ?`, [name], (err, row) => {
    if (row) return res.json(row);
    db.run(`INSERT INTO players (name) VALUES (?)`, [name], () => {
      db.get(`SELECT * FROM players WHERE name = ?`, [name], (err, newRow) => {
        res.json(newRow);
      });
    });
  });
});

// 获取个人随身空间数据
app.get('/api/player/data/:name', (req, res) => {
  const { name } = req.params;
  db.get(`SELECT * FROM players WHERE name = ?`, [name], (err, row) => {
    res.json(row || {});
  });
});

// 后台发放道具，前端自动同步
app.post('/api/player/addProp', (req, res) => {
  const { name, prop } = req.body;
  db.get(`SELECT props FROM players WHERE name=?`, [name], (err, row) => {
    let props = JSON.parse(row.props || '[]');
    props.push(prop);
    db.run(`UPDATE players SET props=? WHERE name=?`, [JSON.stringify(props), name], () => {
      res.json({ success: true });
    });
  });
});

// 提交道具赠送申请
app.post('/api/gift/apply', (req, res) => {
  const { sender, receiver, prop } = req.body;
  db.run(`INSERT INTO gift_audit (sender,receiver,prop) VALUES (?,?,?)`, [sender,receiver,prop], () => {
    res.json({ success: true });
  });
});

// 源初获取所有待审核赠送
app.get('/api/audit/gift', (req, res) => {
  db.all(`SELECT * FROM gift_audit WHERE status='pending'`, (err, rows) => {
    res.json(rows);
  });
});

// 处理赠送审核（同意/驳回）
app.post('/api/audit/gift/handle', (req, res) => {
  const { id, status, rootKey } = req.body;
  if (rootKey !== ROOT_KEY) return res.status(403).json({msg:'权限不足'});
  db.get(`SELECT * FROM gift_audit WHERE id=?`, [id], (err, row) => {
    if(status === 'agree'){
      // 扣除发送者道具
      db.get(`SELECT props FROM players WHERE name=?`, [row.sender], (e1, r1)=>{
        let props = JSON.parse(r1.props);
        props = props.filter(p=>p!==row.prop);
        db.run(`UPDATE players SET props=? WHERE name=?`, [JSON.stringify(props), row.sender], ()=>{
          // 接收者增加道具
          db.get(`SELECT props FROM players WHERE name=?`, [row.receiver], (e2, r2)=>{
            let rProps = JSON.parse(r2.props);
            rProps.push(row.prop);
            db.run(`UPDATE players SET props=? WHERE name=?`, [JSON.stringify(rProps), row.receiver], ()=>{
              db.run(`UPDATE gift_audit SET status=? WHERE id=?`, [status, id], ()=>{
                res.json({success:true});
              });
            });
          });
        });
      });
    }else{
      db.run(`UPDATE gift_audit SET status=? WHERE id=?`, [status, id], ()=>{
        res.json({success:true});
      });
    }
  });
});

// 玩家提交诅咒（仅待审核，不进天赋栏）
app.post('/api/curse/submit', (req, res)=>{
  const { name, curse } = req.body;
  db.get(`SELECT cursePending FROM players WHERE name=?`, [name], (err, row)=>{
    let pending = JSON.parse(row.cursePending);
    pending.push(curse);
    db.run(`UPDATE players SET cursePending=? WHERE name=?`, [JSON.stringify(pending), name], ()=>{
      res.json({success:true});
    });
  });
});

// 源初审核诅咒通过，移入正式天赋栏
app.post('/api/audit/curse/pass', (req, res)=>{
  const { name, curse, rootKey } = req.body;
  if(rootKey!==ROOT_KEY) return res.status(403).json({msg:'权限不足'});
  db.get(`SELECT cursePending,talentList FROM players WHERE name=?`, [name], (err, row)=>{
    let pending = JSON.parse(row.cursePending);
    let talent = JSON.parse(row.talentList);
    pending = pending.filter(c=>c!==curse);
    talent.push(curse);
    db.run(`UPDATE players SET cursePending=?,talentList=? WHERE name=?`,
      [JSON.stringify(pending), JSON.stringify(talent), name], ()=>{
        res.json({success:true});
      }
    );
  });
});

// 源初获取全部玩家数据
app.get('/api/root/players', (req, res)=>{
  const { key } = req.query;
  if(key!==ROOT_KEY) return res.status(403).json([]);
  db.all(`SELECT * FROM players`, (err, rows)=>res.json(rows));
});

// 源初修改玩家携带槽
app.post('/api/root/updateCarry', (req, res)=>{
  const { name, carrySlot, rootKey } = req.body;
  if(rootKey!==ROOT_KEY) return res.status(403).json({msg:'权限不足'});
  db.run(`UPDATE players SET carrySlot=? WHERE name=?`, [JSON.stringify(carrySlot), name], ()=>{
    res.json({success:true});
  });
});

// 适配Render自动端口
const port = process.env.PORT || 3000;
app.listen(port, ()=>{
  console.log(`服务启动，端口：${port}`);
});
