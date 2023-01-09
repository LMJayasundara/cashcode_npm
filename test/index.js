const BillValidator = require('../package/index');
var prvCash = 0;

// Auto detect port
// const device = new BillValidator({
// 	autoPort: true,
// 	baudRate: 19200,
// 	boardKeywordIdentifier: 'FTDI',
// });

// Define a port
const device = new BillValidator({
	baudRate: 9600,
	path: 'COM3',
	autoPort: false,
});

function getTotal(cash) {
	prvCash = prvCash + cash;
	return prvCash;
}

(async function () {
	await device.connect();

	/* Get device status functions*/
	device.on('error', (error) => {
		console.log('Device error:', error);
	});

	// device.on('request', (req)=>{
	//     console.log("Request:", req);
	// });

	// device.on('response', (res)=>{
	//     console.log("Response:", res);
	// });

	device.on('status', (sts) => {
		console.log('Status:', sts);
	});
	/* End functions */

	/* Get device real-time information */
	device.on('powerup', function () {
		console.log('Device power up');
	});

	device.on('powerdown', async () => {
		console.log('Device power down');
	});

	device.on('reset', function () {
		console.log('Device reset');
	});

	device.on('initialize', () => {
		console.log('Device initialize');
	});

	device.on('idling', () => {
		console.log('Device on idling state');
	});

	device.on('cassetteRemoved', () => {
		console.log('Cassette removed');
	});

	device.on('cassetteFull', () => {
		console.log('Cassette full');
	});

	device.on('hold', () => {
		console.log('Device on hold');
	});
	/* End functions */

	/* Handel device cash accept process */
	device.on('escrow', async (cash) => {
		console.log('Amount:', cash.amount);

		// /* End accepting cash */
		// await device.hold();

		try {
			if (cash.amount == 20) {
				await device.retrieve();
			} else {
				await device.stack();
			}
		} catch (error) {
			console.log(error.message);
		}
	});

	device.on('returned', (cash) => {
		try {
			console.log('Cash returned:', cash.amount);
		} catch (error) {
			console.log(error.message);
		}
	});

	device.on('stacked', (cash) => {
		try {
			console.log('Cash stacked:', cash.amount);
			console.log('Toatal Amount:', getTotal(cash.amount));
		} catch (error) {
			console.log(error.message);
		}
	});

	device.on('reject', () => {
		console.log('chash Rejected ');
	});
	/* End functions */

	/* Device handle disable event */
	device.on('disabled', async () => {
		await device.end();

		setTimeout(async function () {
			await device.start();
		}, 1000 * 5);
	});
	/* End functions */
})();

process.on('SIGTERM', () => {
	debug('SIGTERM signal received: closing HTTP server');
	server.close(() => {
		debug('HTTP server closed');
	});
});
