class VerifyCheck {
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

    async handleVerifyCheck(req, res) {
        try {
            const { name } = req.query;
            
            // Check if user has completed ID verification in regflow table
            const regFlowResult = await this.safeQuery(
                'SELECT 2_idverify_name, 2_idverify_id FROM openid.regflow WHERE name = ?', 
                [name]
            );
            
            // If user not found or verification not complete
            if (regFlowResult.length === 0 || regFlowResult[0]['2_idverify_name'] === null) {
                return res.json({ status: 'pending' });
            }
            
            // If verification is complete
            return res.json({ 
                status: 'completed',
                realname: regFlowResult[0]['2_idverify_name'],
                id: regFlowResult[0]['2_idverify_id']
            });
            
        } catch (error) {
            console.error('Error in verification check:', error);
            return res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }
}

module.exports = VerifyCheck;