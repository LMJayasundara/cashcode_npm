const EventEmitter = require("events");
const { SerialPort } = require("serialport");
const commands = require('./command');
const CCNetParser = require('./CCNetParser');

/* getPort class */
class getPort {
    constructor(boardKeywordIdentifier, checkingTimeInterval) {
        this.boardPort = '';
        this.boardKeywordIdentifier = boardKeywordIdentifier;
        this.checkingTimeInterval = checkingTimeInterval || 1000;
        this.waitForUsb = setInterval(this.getBoardPortName.bind(this), this.checkingTimeInterval);
    }

    async getBoardPortName() {
        return new Promise((resolve, reject) => {
            SerialPort.list().then((ports) => {
                ports.forEach((port) => {
                    if (port.manufacturer != undefined) {
                        if (port.manufacturer.includes(this.boardKeywordIdentifier)) {
                            this.boardPort = port.path;
                            clearInterval(this.waitForUsb);
                            resolve(this.boardPort);
                        }
                    }
                });
            }).catch(reject);
        });
    }
}

/* BillValidator class */
class BillValidator extends EventEmitter {
    constructor(option) {
        super();

        this.autoPort = option.autoPort || false;
        this.boardKeywordIdentifier = option.boardKeywordIdentifier || null;
        this.path = option.path || null;
        this.baudRate = option.baudRate;

        this.statusTimerEnable = false;
        this.statusTimer = null;
        this.statusTimerInterval = 1000;

        this.commands = new commands();

        this.status = null;
        this.isSend = false;
        this.opentimer = null;
        this.isConnecting = false;  // Flag to prevent multiple connections

        this.billTable = [
            { amount: 10, code: 'LKA', enabled: false, security: false },
            { amount: 20, code: 'LKA', enabled: false, security: false },
            { amount: 50, code: 'LKA', enabled: false, security: false },
            { amount: 100, code: 'LKA', enabled: false, security: false },
            { amount: 500, code: 'LKA', enabled: false, security: false },
            { amount: 1000, code: 'LKA', enabled: false, security: false }
        ];

        this.info = { model: '', serial: '', asset: '' };
    }

    async connect() {
        if (this.isConnecting) return; // Prevent multiple simultaneous connections
        this.isConnecting = true;

        try {
            if (this.autoPort) {
                if (this.boardKeywordIdentifier == null) {
                    console.log(new Error("boardKeywordIdentifier not defined").message);
                }
                this.getPort = new getPort(this.boardKeywordIdentifier);
                const path = await this.getPort.getBoardPortName();
                await this.begin(path);
            } else if (this.path != null) {
                await this.begin(this.path);
            } else {
                console.log(new Error("path not defined").message);
            }
        } catch (error) {
            console.error("Connect Error:", error.message);
            this.emit('error', error.message);
            setTimeout(() => this.connect(), 5000); // Retry after delay
        } finally {
            this.isConnecting = false;
        }
    }

    async disconnect() {
        this.statusTimerStop(); // Stop the status timer if it's running

        if (this.port && this.port.isOpen) {
            return new Promise((resolve, reject) => {
                this.port.close((error) => {
                    if (error) {
                        console.error("Port closed Error:", error);
                        reject(error);
                    } else {
                        console.log("Port closed...");
                        this.port = null;
                        resolve(true);
                    }
                });
            });
        }

        return Promise.resolve();
    }

    async begin(path) {
        if (this.port && this.port.isOpen) {
            await this.disconnect();
        }

        this.port = new SerialPort({
            path,
            baudRate: this.baudRate,
            dataBits: 8,
            parity: "none",
            stopBits: 1,
            flowControl: false,
            autoOpen: false
        });

        this.parser = this.port.pipe(new CCNetParser());

        this.port.on('open', () => {
            clearTimeout(this.opentimer);
            console.log('serial port open');
            this.onSerialPortOpen();
        });

        this.port.on('error', async (error) => {
            console.error('Serial port error:', error.message);
            await this.disconnect();
            setTimeout(() => this.connect(), 5000); // Retry after delay
        });

        this.port.on('close', async () => {
            console.log('Serial port closed');
            await this.disconnect();
            setTimeout(() => this.connect(), 5000); // Retry after delay
        });

        const openPort = () => {
            this.port.open((error) => {
                if (error) {
                    this.emit('error', error.message);
                    this.opentimer = setTimeout(openPort, 5000);
                }
            });
        };

        openPort();
    }

    statusTimerStop() {
        this.statusTimerEnable = false;
        clearTimeout(this.statusTimer);
    }

    async onSerialPortOpen() {
        this.statusTimerStart();
    }

    statusTimerStart() {
        this.statusTimerEnable = true;
        this.statusTimer = setTimeout(() => this.onStatusTimer(), this.statusTimerInterval);
    }

    onStatusTimer() {
        clearInterval(this.statusTimer);
        if (!this.isOpen) return;

        this.execute(0x33, [0x41])
            .then(data => {
                if (this.statusTimerEnable) {
                    this.statusTimer = setTimeout(() => this.onStatusTimer(), this.statusTimerInterval);
                }
                this.onStatus(data);
            })
            .catch(error => {
                if (this.statusTimerEnable) {
                    this.statusTimer = setTimeout(() => this.onStatusTimer(), this.statusTimerInterval);
                }
                console.log("onStatusTimer error:", error.message);
            });
    }

    async execute(command, params = [], timeout = 5000) {
        let self = this;
        return new Promise(async function (resolve, reject) {
            try {
                let request = self.commands.request(command, params);
                self.emit('request', request);

                await self.send(request, timeout)
                .then((response)=>{
                    self.emit('response', response);
                    resolve(self.commands.response(response));
                })
                .catch((error)=>{
                    self.emit('error', error.message);
                    self.disconnect().then(()=>{
                        self.connect();
                    });
                });
                
            } catch (error) {
                self.emit('error', error.message);
                reject(error);
            }
        });
    }

    async send(request, timeout = 1000) {
        let self = this;

        return new Promise(function (resolve, reject) {
            let timer = null;

            let timerHandler = function () {
                reject(new Error('Device not powerup'));
            };

            let handler = async function (response) {
                clearTimeout(timer);
                self.parser.removeListener('data', handler);

                let ln = response.length;
                let check = response.slice(ln - 2, ln);
                let slice = response.slice(0, ln - 2);

                if (check.toString('hex') !== (self.commands.getCRC16(slice)).toString('hex')) {
                    self.isSend = false;
                    reject(new Error('Wrong response data hash').message);
                }

                let data = response.slice(3, ln - 2);

                if (data.length == 1 && data[0] == 0x00) {
                    // ACK
                } else if (data.length == 1 && data[0] == 0xFF) {
                    // NAK
                    reject(new Error('Wrong request data hash').message);
                } else {
                    // Send ACK
                }

                self.isSend = true;
                resolve(data);
            }

            self.parser.once('data', handler);
            self.port.write(request);
            timer = setTimeout(timerHandler, timeout);
        });
    }

    /* Get device info */
    Getinfo(data) {
        return {
            model: data.slice(0, 15).toString().trim(),
            serial: data.slice(15, 27).toString().trim(),
            asset: data.slice(27, 34).toString('hex')
        };
    }

    /* Get device bill table */
    Getbilltype(data) {
        var response = [],
            word;

        for (var i = 0; i < 24; i++) {
            word = data.slice(i * 5, (i * 5 + 5));

            response.push({
                amount: word[0] * Math.pow(10, word[4]),
                code: word.slice(1, 4).toString(),
                enabled: false,
                security: false
            });
        }

        return response;
    }

    async init() {
        try {
            await this.waitStatus('13', 1000);

            this.statusTimerStop();

            await this.execute(0x32, [0x00, 0x00, 0x00]);

            await this.execute(0x34, [0xFF, 0XFF, 0XFF, 0xFF, 0XFF, 0XFF])
                .then(() => {
                    setTimeout(() => {
                        this.statusTimerStart();
                    }, 3000);
                });

            return true;
        } catch (error) {
            console.log("init error:", error.message);
        }
    }

    async onStatus(status) {
        if (status.length >= 2) {

            this.status = status[0].toString(16);
            this.secondStatus == status[1].toString(16)
            this.emit('status', this.status, this.secondStatus);

            switch (status[0]) {
                case 0x80:
                    this.emit('escrow', this.billTable[parseInt(status[1].toString(10))]);
                break;

                case 0x81:
                    this.emit('stacked', this.billTable[parseInt(status[1].toString(10))]);
                    this.execute(0x00);
                break;

                case 0x82:
                    this.emit('returned', this.billTable[parseInt(status[1].toString(10))]);
                    this.execute(0x00);
                break;

                case 0x1C:
                    this.emit('reject');
                break;

                default:
                    this.reset();
                break;
            }
            
        }
        else{

            this.status = status[0].toString(16);
            this.emit('status', this.status, '');

            switch (status[0]) {    
                case 0x10:
                    this.emit("powerup");
                    await this.reset();
                break;
    
                case 0x13:
                    this.emit("initialize");
                    await this.init();
                break;
    
                case 0x14:
                    this.emit("idling");
                break;

                case 0x15:
                    this.emit('accepting');
                break;
    
                case 0x19:
                    this.emit('disabled');
                break;

                case 0x41:
                    this.emit('cassetteFull');
                break;

                case 0x42:
                    this.emit('cassetteRemoved');
                break;

                case 0x1A:
                    this.emit('hold');
                break;

                default:
                    this.reset();
                break;

            }
        }
        
    }

    waitStatus(status, timeout = 1000) {
        let self = this;

        return new Promise(function (resolve, reject) {

            if (self.status == status) {
                resolve(true);
            }

            let timer = null;
            let timerHandler = function () {
                clearTimeout(timer);
                self.removeListener('status', handler);
                reject(new Error('Request timeout').message);
            };

            let handler = function (primary) {
                if (primary == status) {
                    clearTimeout(timer);
                    self.removeListener('status', handler);
                    resolve(true);
                }
            }

            self.on('status', handler);
            if (timeout) {
                timer = setTimeout(timerHandler, timeout);
            }
        });
    }

    async reset() {
        try {
            await this.execute(0x30, [0x41]);
        } catch (error) {
            this.emit('error', error.message);
        }
        this.emit("reset");
    }

    statusTimerStop() {
        this.statusTimerEnable = false;
        clearTimeout(this.statusTimer);
    }

    close() {
        let self = this;

        return new Promise(function (resolve, reject) {
            if (self.port && self.port.isOpen) {
                self.port.close(function (error) {
                    if (error) {
                        reject(error);
                    }

                    resolve(true);
                });
            } else {
                resolve(true);
            }
        });
    }
}

module.exports = BillValidator;
