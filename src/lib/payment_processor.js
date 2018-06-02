global.srcRoot = require('path').resolve('./');
const {Transaction, User, Job} = require('../db');

//const config = require('../data/config.json')[global.env];


const PIVXClient = require('./pivx_client.js');
const Decimal = require("decimal.js");

class PaymentProcessor {

    constructor(options) {
        this.agenda         = options.agenda;
        this.pivxClient     = options.pivxClient || new PIVXClient();
    }

    async performWithdraw(options) {
        try {
            await this.withdraw(options);
            return { success: true };
        } catch(e) {
            this.reportException(e);
            return { error: e };
        }
    }

    async performDeposit(options) {
        try {
            await this.deposit(options);
            return { success: true };
        } catch(e) {
            //this.reportException(e);
            console.error(e);
            return { error: e };
        }
    }

    async getAddress(options) {
        try {
            await this.generateAddress(options.user);
            return { success: true };
        } catch (e) {
            this.reportException(e);
            return { error: e };
        }
    }

    async checkDeposit() {
        setInterval(async () => {
            const txs = await this.pivxClient.listTransactions();
            let newTXs = [];

            for (let tx of txs) {
                //console.log(tx);
                const acc = tx.account;
                if (acc == "test" && tx.txid) {
                    const re = await Transaction.find({ txid: tx.txid }).limit(1);
                    if (re.length == 0) newTXs.push(tx);
                }
            }

            for (let n of newTXs) {

                await this.createDepositOrder(n.txid, n.address, n.amount);
            }
        }, 2000);
    }

    async createDepositOrder(txID, recipientAddress, rawAmount) {
        let job = await Job.findOne({ "data.txid": txID  });

        if (!job) {
            console.log('New transaction! TXID: ' + txID);
            job = this.agenda.create('deposit_order', { recipientAddress: recipientAddress, txid: txID, rawAmount: rawAmount });
            return new Promise((res, rej) => {
                job.save((err) => {
                    if (err) return rej(err);
                    return res(job);
                });
            });
        }

        return job;
    }


    /*
        amount: {String}
    */
    async withdraw(job) {
        // parameters
        const userId            = job.attrs.data.userId;
        const recipientAddress  = job.attrs.data.recipientAddress;
        const amount            = job.attrs.data.amount;

        // Validate if user is present
        let user = await User.findById(userId);
        if (!user) throw new Error(`User ${userId} not found`);
        await User.validateWithdrawAmount(user, amount);

        // Step 1: Process transaction
        let sendID;

        if (job.attrs.sendStepCompleted) {
            sendID = job.attrs.txid;
        } else {
            const sent = await this.pivxClient.send(recipientAddress, amount);
            console.log(sent);
            if (sent.error) throw new Error(sent.error);
            await Job.findOneAndUpdate({ _id: job.attrs._id} , { "data.sendStepCompleted": true, "data.txid": sent.txid });
        }

        // Step 2: Update user balance
        if (!job.attrs.userStepCompleted) {
            await User.withdraw(user, amount);
            await Job.findByIdAndUpdate(job.attrs._id, { "data.userStepCompleted": true });
        }

        // Step 3: Record Transaction
        if (!job.attrs.transactionStepCompleted) {
            await Transaction.create({ userId: userId, withdraw: amount, txid: sendID });
            await Job.findByIdAndUpdate(job.attrs._id, { "data.transactionStepCompleted": true });
        }

        return sendID;
    }

    async deposit(job) {
        // parameters
        const txid             = job.attrs.data.txid;
        const recipientAddress = job.attrs.data.recipientAddress;
        const rawAmount        = job.attrs.data.rawAmount;

        // Validate if user is present
        let user = await User.findOne({ addr: recipientAddress });

        if (!user) throw new Error(`User with address ${recipientAddress} not found`);

        // Step 2: Update user balance + record transaction
        let amountInSats = Decimal(rawAmount).div(this.pivxClient.SATOSHI_VALUE || 100000000);

        if (!job.attrs.userStepCompleted) {
            await User.deposit(user, amountInSats, txid);
            await Job.findByIdAndUpdate(job.attrs._id, { "data.userStepCompleted": true });
        }

        if (!job.attrs.transactionStepCompleted) {
            await Transaction.create({ userId: user.id, deposit: amountInSats.toFixed(), txid: txid });
            await Job.findByIdAndUpdate(job.attrs._id, { "data.transactionStepCompleted": true });
        }

        return txid;
    }

}

module.exports = PaymentProcessor;
