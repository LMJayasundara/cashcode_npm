const Transform = require('stream').Transform;

class CCNetParser extends Transform {

    constructor(options = null) {
        super(options);

        /* Packet container */
        this.packet = new Buffer.alloc(0);

        /* Packet full length */
        this.packetLength = 0;
    }

    /* Receive and pars ccnet packet */
    _transform(buffer, encoding, callback) {

        this.packet = Buffer.concat([this.packet, buffer]);

        if (this.packet.length >= 3 && this.packetLength === 0) {
            this.packetLength = parseInt(this.packet[2].toString());
        }

        if (this.packet.length == this.packetLength) {

            this.push(this.packet);

            this.packet = new Buffer.alloc(0);

            this.packetLength = 0;
        }

        callback();
    }

}

module.exports = CCNetParser;