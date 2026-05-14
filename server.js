'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Article download API
app.use('/api/article', require('./routes/article'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/article-tool', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'article-tool.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`WeSave 已启动: http://localhost:${PORT}/article-tool`);
});
