process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const Bitcoin = require('bitcoin-core');

const config = require('../data/config.json');

class PivxClient {

    constructor() {
        //if (!apiKey) throw new Error("Missing APIKey");
        this.rpc = new Bitcoin({
            port: config.RPC_PORT,
            username: config.RPC_USER,
            password: config.RPC_PASS
        });

        this.SATOSHI_VALUE = 1e-8;

    }

    async accountCreate() {
        return this.rpc.getNewAddress(config.RPC_ACC);
    }

    async send(addr, amount) {
        return this.rpc.sendToAddress(addr, amount);
    }

    async listTransactions() {
        return this.rpc.listUnspent();
    }

}


module.exports = PivxClient;
