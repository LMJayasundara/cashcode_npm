const Cval = require('./const')

class commands{
    /* Generate CRC */
    getCRC16 (buffer) {
        var CRC, i, j;
        var sizeData = buffer.length;
        
        CRC = 0;
        
        for (i = 0; i < sizeData; i++) {
            CRC ^= buffer[i];

            for (j = 0; j < 8; j++) {

                if (CRC & 0x0001) {
                    CRC >>= 1;
                    CRC ^= 0x08408;
                } else CRC >>= 1;
            }
        }

        var buf = new Buffer.alloc(2);
        buf.writeUInt16BE(CRC, 0);
        
        CRC = buf;

        return Array.prototype.reverse.call(CRC);
    }

    request (cmd, params = []) {
        this.cmd = cmd;
        return this.assemble(new Buffer.from(params));
    }

    response (data) {
        return data;
    }

    assemble (params = new Buffer.alloc(0)) {
        var cmd = Buffer.concat([
            /* Header. */
            new Buffer.from(
            [
                Cval.SYNC,
                Cval.ADR_BILL_VALIDATOR
            ]
            ),
            /* Length. */
            new Buffer.from(
            [
                (params.length + 6)
            ]
            ),
            /* Command. */
            new Buffer.from(
            [
                this.cmd
            ]
            )
        ]);

        /*Assemble params packet data.  */
        if (params.length) {
            cmd = Buffer.concat([
                /* Main packet data. */
                cmd,
                /* Command params. */
                params
            ]);
        }

        return Buffer.concat([
            cmd,
            this.getCRC16(cmd)
        ]);
    }
}

module.exports = commands;