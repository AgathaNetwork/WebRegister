const express = require('express');
const app = express();
const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs').promises;
const SqlManager = require('./base/SqlManager'); // 引入 SqlManager

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

// 新增函数：封装 SQL 查询并处理连接重置
async function safeQuery(query, params) {
    try {
        // 检查连接状态
        await sqlManager.checkConnection();
        return await sqlManager.query(query, params);
    } catch (error) {
        if (error.code === 'PROTOCOL_CONNECTION_LOST') {
            console.error('Connection lost. Attempting to reinitialize...');
            await sqlManager.init(); // 重新初始化连接
            return await sqlManager.query(query, params); // 重新执行查询
        } else {
            throw error; // 抛出其他错误
        }
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

  // 静态文件服务
  app.use(express.static(path.join(__dirname, 'public')));

  // 允许public/finish_mojang.html接受POST请求
  app.post('/finish_mojang.html', async (req, res) => {

    try {
      // Step 1: Exchange authorization code for access token
      const tokenResponse = await axios.post('https://login.live.com/oauth20_token.srf', 
        new URLSearchParams({
          client_id: 'b5f2d80e-6259-478a-83b0-42321c9d1c7a',
          client_secret: 'UIp8Q~bO2huycYt6TJv1MAUn12oaTW8mYfkw8dq~',
          code: req.body.code,
          grant_type: 'authorization_code',
          redirect_uri: 'https://register.agatha.org.cn/finish_mojang.html'
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      const accessToken = tokenResponse.data.access_token;
      
      // Step 2: Authenticate with Xbox Live
      const xboxAuthResponse = await axios.post('https://user.auth.xboxlive.com/user/authenticate', {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${accessToken}`
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const xboxToken = xboxAuthResponse.data.Token;
      const uhs = xboxAuthResponse.data.DisplayClaims.xui[0].uhs;
      
      // Step 3: Authorize with XSTS
      const xstsResponse = await axios.post('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xboxToken]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const xstsToken = xstsResponse.data.Token;
      
      // Step 4: Authenticate with Minecraft
      const minecraftAuthResponse = await axios.post('https://api.minecraftservices.com/authentication/login_with_xbox', {
        identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
        ensureLegacyEnabled: true
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const minecraftAccessToken = minecraftAuthResponse.data.access_token;
      
      // Step 5: Get Minecraft profile
      const profileResponse = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: {
          Authorization: `Bearer ${minecraftAccessToken}`
        }
      });
      
      const minecraftName = profileResponse.data.name;
      const minecraftUUID = profileResponse.data.id;
      
      // Check if user already exists in database
      const existingUser = await safeQuery('SELECT * FROM authme WHERE realname = ?', [minecraftName]);
      
      // Check registration flow status
      const regFlow = await safeQuery('SELECT status FROM regflow WHERE name = ?', [minecraftName]);
      
      let status = 0;
      if (existingUser.length > 0) {
        status += 1;
      }
      
      if (regFlow.length > 0) {
        if (regFlow[0].status == '1') {
          status += 1;
        }
        if (regFlow[0].status == '0') {
          return res.send('<h2>您此前创建过一个注册流程，请直接点击确认。</h2>');
        }
      }
      
      // If no existing user and no active registration flow
      if (status === 0 && minecraftName) {
        // Insert into registration flow
        await safeQuery(
          'INSERT INTO regflow (name, 1_msverify, 2_idverify_name, 2_idverify_id, 3_smsverify, status) VALUES (?, ?, ?, ?, ?, ?)',
          [minecraftName, '1', null, null, null, 0]
        );
        
        return res.send('<h2>您已验证正版账号，现在可以关闭此页面，并点击卡片上的“已完成”。</h2>');
      } else {
        return res.send('<h2>注册失败：请确认该Microsoft账号拥有Minecraft国际版，且从未注册过Agatha，如未解决，请通过钉钉联系管理员。您现在可以关闭此页面。</h2><br><br><h2>如果您使用新购买的账号游玩，请先登录一次官方启动器。微软在这种情况下有概率抽风。</h2>');
      }
    } catch (error) {
      console.error('Error in Mojang authentication flow:', error);
      return res.status(500).send('<h2>验证过程中发生错误，请稍后重试或联系管理员。</h2>');
    }
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
