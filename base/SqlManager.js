const mysql = require('mysql2');
const util = require('util');

class SqlManager {
    constructor(config) {
        this.config = config;
        this.connection = null;
    }

    // 初始化数据库连接
    async init() {
        try {
            this.connection = mysql.createConnection({
                host: this.config.db.host,
                port: this.config.db.port,
                user: this.config.db.user,
                password: this.config.db.password,
                database: this.config.db.database,
                // 新增：设置连接超时时间
                connectTimeout: 10000,
                acquireTimeout: 10000,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });

            // 将 query 方法转换为 Promise
            this.query = util.promisify(this.connection.query).bind(this.connection);

            // 检查连接是否成功
            await this.checkConnection();
            console.log('Database connection initialized successfully.');
        } catch (error) {
            console.error('Failed to initialize database connection:', error.message);
            // 新增：尝试重新初始化连接
            await this.retryInit();
        }
    }

    // 新增：重试初始化连接
    async retryInit() {
        const maxRetries = 5;
        let retries = 0;
        while (retries < maxRetries) {
            try {
                await this.init();
                return;
            } catch (error) {
                retries++;
                console.error(`Retry ${retries} failed. Retrying in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.error('Max retries reached. Unable to initialize database connection.');
        throw new Error('Database connection initialization failed after multiple retries.');
    }

    // 检查连接状态
    async checkConnection() {
        if (!this.connection) {
            throw new Error('Database connection is not initialized.');
        }

        try {
            await this.query('SELECT 1');
            console.log('Database connection is active.');
        } catch (error) {
            console.error('Database connection is inactive:', error.message);
            // 新增：捕获连接丢失错误并尝试重新初始化
            if (error.code === 'PROTOCOL_CONNECTION_LOST') {
                console.error('Connection lost. Attempting to reinitialize...');
                await this.init();
            } else {
                throw error;
            }
        }
    }

    // 关闭数据库连接
    async close() {
        if (this.connection) {
            await util.promisify(this.connection.end).bind(this.connection)();
            console.log('Database connection closed.');
        }
    }
}

module.exports = SqlManager;