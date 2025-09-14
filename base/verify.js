const axios = require('axios');
const crypto = require('crypto');

class IDVerification {
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

    generateUUID() {
        return crypto.randomBytes(10).toString('hex');
    }

    async handleVerifyID(req, res) {
        try {
            const { name, realname, id } = req.body;
            
            // Check if user exists in regflow table
            const regFlowResult = await this.safeQuery(
                'SELECT 2_idverify_name FROM openid.regflow WHERE name = ?', 
                [name]
            );
            
            // If user already has verification data
            if (regFlowResult.length > 0 && regFlowResult[0]['2_idverify_name'] !== null) {
                return res.json({ status: 'already' });
            }
            
            // If no registration flow exists for user
            if (regFlowResult.length === 0) {
                return res.json({ status: 'noprogress' });
            }
            
            // Proceed with ID verification API call
            const host = 'https://zimfaceid1.market.alicloudapi.com';
            const path = '/comms/zfi/init';
            const method = 'POST';
            const appcode = 'e45b0152058546d58695d216a4b1e087';
            
            const uuidStr = this.generateUUID();
            
            const headers = {
                'Authorization': `APPCODE ${appcode}`,
                'X-Ca-Nonce': uuidStr,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            };
            
            const returnUrl = `https://register.agatha.org.cn/id_complete.html?user=${name}`;
            const notifyUrl = `https://api-dingtalk.agatha.org.cn/regflow/mdcallback.php?user=${name}`;
            
            const livingPageStyle = encodeURIComponent(JSON.stringify({
                "progressStaGradient": "#1781b5",
                "progressEndGradient": "#66a9c9",
                "progressBgColor": "#ddd",
                "maskColor": "#fff",
                "topLabelColor": "#000"
            }));
            
            const bodys = `bizId=uuid&idName=${realname}&idNumber=${id}&livingPageStyle=${livingPageStyle}&livingType=13&needVideo=true&notifyUrl=${notifyUrl}&returnUrl=${returnUrl}&type=1&useStrictMode=true&useZIMInAlipay=true`;
            
            const response = await axios({
                method: method,
                url: host + path,
                headers: headers,
                data: bodys
            });
            
            // Insert into idverifyhis table
            await this.safeQuery(
                'INSERT INTO openid.idverifyhis (username, time) VALUES (?, ?)',
                [name, Math.floor(Date.now() / 1000)]
            );
            
            // Return API response
            return res.send(response.data);
            
        } catch (error) {
            console.error('Error in ID verification:', error);
            return res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }
}

module.exports = IDVerification;