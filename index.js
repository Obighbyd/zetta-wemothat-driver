var util = require('util');
var Scout = require('zetta-scout');
var Wemo = require('wemo-client');

var WemoLight = require('./devices/light');
var WemoColorLight = require('./devices/colorlight');
var WemoInsight = require('./devices/insight');
var WemoMotion = require('./devices/motion');
var WemoSwitch = require('./devices/switch');

var WemoScout = module.exports = function() {
  Scout.call(this);
};
util.inherits(WemoScout, Scout);

WemoScout.prototype.init = function(next) {
  this._wemo = new Wemo();
  this._clients = {};
  this.search();
  setInterval(this.search.bind(this), 5000);
  next();
};

WemoScout.prototype.initDevice = function(type, Class, device, client) {
  var self = this;
  var query = this.server.where({type: type, UDN: device.UDN});
  this.server.find(query, function(err, results) {
    if (results && results.length > 0) {
      self.provision(results[0], Class, device, client);
    } else {
      self.discover(Class, device, client);
    }
  });
};

WemoScout.prototype.search = function() {
  this._wemo.discover(this.foundDevice.bind(this));
};

WemoScout.prototype.foundDevice = function(device) {
  if (this._clients[device.UDN]) {
    // device has already been initialized
    return;
  }

  var client = this._clients[device.UDN] = this._wemo.client(device);

  switch (device.deviceType) {
    case 'urn:Belkin:device:bridge:1':
      client.getEndDevices(function(err, endDevices) {
        if (!err) {
          endDevices.forEach(function(endDevice) {
            endDevice.UDN = client.device.UDN + '#' + endDevice.deviceId; // make it unique
            switch (endDevice.deviceType) {
              case 'dimmableLight':
                this.initDevice('wemo-light', WemoLight, endDevice, client);
                break;
              case 'colorLight':
                this.initDevice('wemo-color-light', WemoColorLight, endDevice, client);
                break;
            }
          }, this);
        }
      }.bind(this));
      break;
    case 'urn:Belkin:device:insight:1':
      this.initDevice('wemo-insight', WemoInsight, device, client);
      break;
    case 'urn:Belkin:device:sensor:1':
      this.initDevice('wemo-motion', WemoMotion, device, client);
      break;
    case 'urn:Belkin:device:controllee:1':
      this.initDevice('wemo-switch', WemoSwitch, device, client);
      break;
    default:
      this.server.info('Found unsupported Wemo device: ' + device.deviceType, device);
  }
};
