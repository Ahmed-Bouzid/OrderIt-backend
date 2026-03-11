const usb = require("usb");

const devices = usb.getDeviceList();

devices.forEach((d) => {
	console.log(
		"Vendor:",
		d.deviceDescriptor.idVendor,
		"Product:",
		d.deviceDescriptor.idProduct,
	);
});
