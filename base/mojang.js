const axios = require('axios');

class MojangAuth {
    constructor(sqlManager, config) {
        this.sqlManager = sqlManager;
        this.config = config;
    }

    // 新增函数：封装 SQL 查询并处理连接重置
    async safeQuery(query, params) {
        try {
            // 检查连接状态
            await this.sqlManager.checkConnection();
            return await this.sqlManager.query(query, params);
        } catch (error) {
            if (error.code === 'PROTOCOL_CONNECTION_LOST') {
                console.error('Connection lost. Attempting to reinitialize...');
                await this.sqlManager.init(); // 重新初始化连接
                return await this.sqlManager.query(query, params); // 重新执行查询
            } else {
                throw error; // 抛出其他错误
            }
        }
    }

    async handleFinishMojang(req, res) {
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
            ).catch(error => {
                console.error('Error exchanging authorization code for access token:', error.response?.data || error.message);
                console.error('Request data:', {
                client_id: 'b5f2d80e-6259-478a-83b0-42321c9d1c7a',
                // 不记录 secret 和 code 的完整值，但记录长度用于调试
                client_secret_length: 'UIp8Q~bO2huycYt6TJv1MAUn12oaTW8mYfkw8dq~'.length,
                code_length: req.body.code?.length || 0,
                grant_type: 'authorization_code',
                redirect_uri: 'https://register.agatha.org.cn/finish_mojang.html'
                });
                console.log("CODE:" + JSON.stringify(req));
                throw error;
            });
            
            if (tokenResponse.status !== 200) {
                throw new Error(`Token exchange failed with status ${tokenResponse.status}`);
            }
            
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
            }).catch(error => {
                console.error('Error authenticating with Xbox Live:', error.response?.data || error.message);
                throw error;
            });
            
            if (xboxAuthResponse.status !== 200) {
                throw new Error(`Xbox Live authentication failed with status ${xboxAuthResponse.status}`);
            }
            
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
            }).catch(error => {
                console.error('Error authorizing with XSTS:', error.response?.data || error.message);
                throw error;
            });
            
            if (xstsResponse.status !== 200) {
                throw new Error(`XSTS authorization failed with status ${xstsResponse.status}`);
            }
            
            const xstsToken = xstsResponse.data.Token;
            
            // Step 4: Authenticate with Minecraft
            const minecraftAuthResponse = await axios.post('https://api.minecraftservices.com/authentication/login_with_xbox', {
                identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
                ensureLegacyEnabled: true
            }, {
                headers: {
                'Content-Type': 'application/json'
                }
            }).catch(error => {
                console.error('Error authenticating with Minecraft:', error.response?.data || error.message);
                throw error;
            });
            
            if (minecraftAuthResponse.status !== 200) {
                throw new Error(`Minecraft authentication failed with status ${minecraftAuthResponse.status}`);
            }
            
            const minecraftAccessToken = minecraftAuthResponse.data.access_token;
            
            // Step 5: Get Minecraft profile
            const profileResponse = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
                headers: {
                Authorization: `Bearer ${minecraftAccessToken}`
                }
            }).catch(error => {
                console.error('Error getting Minecraft profile:', error.response?.data || error.message);
                throw error;
            });
            
            if (profileResponse.status !== 200) {
                throw new Error(`Getting Minecraft profile failed with status ${profileResponse.status}`);
            }
            
            const minecraftName = profileResponse.data.name;
            const minecraftUUID = profileResponse.data.id;
            
            // Check if user already exists in database with openid
            const existingUser = await this.safeQuery('SELECT * FROM authme.authme WHERE realname = ?', [minecraftName]);
            
            // Check registration flow status
            const regFlow = await this.safeQuery('SELECT status FROM openid.regflow WHERE name = ?', [minecraftName]);
            
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
                // Also insert into registration flow
                await this.safeQuery(
                'INSERT INTO openid.regflow (name, 1_msverify, 2_idverify_name, 2_idverify_id, 3_smsverify, status) VALUES (?, ?, ?, ?, ?, ?)',
                [minecraftName, '1', null, null, null, 0]
                );
                // 重定向到 idverify.html
                return res.redirect('/idverify.html?id=' + minecraftName);
            } else {
                return res.redirect('/mojang_already.html');
            }
        } catch (error) {
            console.error('Error in Mojang authentication flow:', error);
            return res.redirect('/mojang_error.html');
        }
    }
}

module.exports = MojangAuth;