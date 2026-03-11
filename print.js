const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const device = new escpos.USB(10473, 649);
const printer = new escpos.Printer(device);

device.open(function (error) {
	if (error) {
		console.error("USB ERROR:", error);
		return;
	}

	printer
		.align("CT")
		.style("B")
		.size(1, 1)
		.text("TEST PRINTER")
		.text("----------------")
		.text("HELLO WORLD")
		.text("Node + ESC/POS")
		.cut()
		.close();
});
