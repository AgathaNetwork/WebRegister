const express = require('express');
const app = express();
const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs').promises;
const bodyParser = require('body-parser');
const SqlManager = require('./base/SqlManager'); // 引入 SqlManager
const MojangAuth = require('./base/mojang'); // 引入 MojangAuth
const IDVerification = require('./base/verify'); // 引入 IDVerification
const VerifyCheck = require('./base/verify_check');

// 读取配置文件
let config;
let sqlManager; // 定义 sqlManager 变量

async function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.yml');
    const fileContents = await fs.readFile(configPath, 'utf8');
    config = yaml.load(fileContents);
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration format');
    }

  } catch (error) {
    console.error('Failed to load configuration:', error.message);
    process.exit(1); // 如果配置加载失败，终止程序
  }
}

// 初始化数据库连接
async function initSqlConnection() {
  try {
    sqlManager = new SqlManager(config);
    await sqlManager.init();
    console.log('SQL connection initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize SQL connection:', error.message);
    process.exit(1); // 如果数据库连接初始化失败，终止程序
  }
}

// 在这里引入 axios
const axios = require('axios');

(async () => {
  await loadConfig();
  await initSqlConnection(); // 在启动时初始化 SQL 连接

  const port = config.port;

  // 添加中间件以解析 JSON 请求体
  app.use(express.json());

  // 解析application/x-www-form-urlencoded数据
  app.use(bodyParser.urlencoded({ extended: false }));
  
  // 静态文件服务
  app.use(express.static(path.join(__dirname, 'public')));

  // Create MojangAuth instance
  const mojangAuth = new MojangAuth(sqlManager, config);

  // Allow public/finish_mojang.html to accept POST requests
  app.post('/finish_mojang.html', (req, res) => {
    mojangAuth.handleFinishMojang(req, res);
  });

  // Create IDVerification instance
  const idVerification = new IDVerification(sqlManager, config);

  // Allow public/verify_id.html to accept POST requests
  app.post('/verify_id.html', (req, res) => {
    idVerification.handleVerifyID(req, res);
  });

    // Create VerifyCheck instance
    const verifyCheck = new VerifyCheck(sqlManager, config);

    // Add endpoint for verification checking
    app.get('/verify_check.html', (req, res) => {
      verifyCheck.handleVerifyCheck(req, res);
    });

  // 启动服务器
  app.listen(port, () => {
    console.log(`http://localhost:${port}`);
  });
})();

// 动态导入 node-fetch
let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();