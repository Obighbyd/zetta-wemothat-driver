var util = require('util');
var Device = require('zetta-device');

var WemoBulb = module.exports = function(device, client) {
  this.name = device.friendlyName;
  this._internalState = device.internalState;
  this.state = (device.internalState['10006'].substr(0,1) === '1') ? 'on' : 'off';
  this.brightness = device.internalState['10008'].split(':').shift();
  this.deviceId = device.deviceId;
  this.UDN = device.UDN + '#' + device.deviceId;
  this._client = client;
  Device.call(this);
};
util.inherits(WemoBulb, Device);

WemoBulb.prototype.init = function(config) {
  config
    .type('wemo-bulb')
    .state(this.state)
    .monitor('brightness')
    .name(this.name)
    .when('off', { allow: ['turn-on', 'dim'] })
    .when('on', { allow: ['turn-off', 'dim'] })
    .map('turn-on', this.turnOn)
    .map('turn-off', this.turnOff)
    .map('dim', this.dim, [
      { name: 'value', type: 'number'}
    ]);

  var self = this;
  this._client.on('statusChange', function(deviceId, capabilityId, value){
    if (deviceId === self.deviceId) {
      self._internalState[capabilityId] = value;
      self.brightness = self._internalState['10008'].split(':').shift();
      self.state = (self._internalState['10006'].substr(0,1) === '1') ? 'on' : 'off';
    }
  });
};

WemoBulb.prototype.turnOn = function(cb) {
  this.setDeviceStatus(10006, '1');
  this.state = 'on';
  cb();
};

WemoBulb.prototype.turnOff = function(cb) {
  this.setDeviceStatus(10006, '0');
  this.state = 'off';
  cb();
};

WemoBulb.prototype.dim = function(value, cb) {
  // value = brightness:transition time
  if (value > 0) {
    this.setDeviceStatus(10008, (parseInt(value) || 0) + ':25');
    cb();
  } else {
    this.turnOff(cb);
  }
};

WemoBulb.prototype.setDeviceStatus = function(capability, value) {
  this._client.setDeviceStatus(this.deviceId, capability, value);
};