var util = require('util');
var http = require('http');
var xml2js = require('xml2js');
var express = require('express');
var bodyparser = require('body-parser');
var os = require('os');
var EventEmitter = require('events').EventEmitter;

var getLocalInterfaceAddress = function() {
  var interfaces = os.networkInterfaces();
  var addresses = [];
  for (var k in interfaces) {
    for (var k2 in interfaces[k]) {
      var address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  return addresses.shift();
}

var WemoClient = module.exports = function(config) {
  EventEmitter.call(this);
  this.host = config.host;
  this.port = config.port;
  this.path = config.path;
  this.deviceType = config.deviceType;
  this.UDN = config.UDN;
  this.sid = null;
  this.callbackURL = null;

  // Create map of services
  config.serviceList.service.forEach(function(service){
    this[service.serviceType[0]] = {
      serviceId: service.serviceId[0],
      controlURL: service.controlURL[0],
      eventSubURL: service.eventSubURL[0],
    }
  }, this.services = {});

  this.listen();

};
util.inherits(WemoClient, EventEmitter);

WemoClient.prototype.init = function() {
  if (this.deviceType == 'urn:Belkin:device:bridge:1') {
    this.subscribe('urn:Belkin:service:bridge:1');
  }

  this.subscribe('urn:Belkin:service:basicevent:1');
};

WemoClient.prototype.soapAction = function(serviceType, action, body, cb) {
  var soapHeader = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>';
  var soapFooter = '</s:Body></s:Envelope>';

  var options = {
    host: this.host,
    port: this.port,
    path: this.services[serviceType].controlURL,
    method: 'POST',
    headers: {
      'SOAPACTION': '"' + serviceType + '#' + action + '"',
      'Content-Type': 'text/xml; charset="utf-8"'
    }
  };

  var req = http.request(options, function(res) {
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      if (cb) {
        cb(null, data);
      }
    });
    res.on('error', function(err) {
      console.log(err);
    });
  });
  req.write(soapHeader);
  req.write(body);
  req.write(soapFooter);
  req.end();
};



WemoClient.prototype.getEndDevices = function(cb) {
  var self = this;

  var parseResponse = function(err, data) {
    if (err) cb(err);
    xml2js.parseString(data, function(err, result) {
      if (!err) {
        var list = result['s:Envelope']['s:Body'][0]['u:GetEndDevicesResponse'][0].DeviceLists[0];
        xml2js.parseString(list, function(err, result2) {
          if (!err) {
            var devinfo = result2.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo;
            if (devinfo) {
              for (var i = 0; i < devinfo.length; i++) {
                var device = {
                  friendlyName: devinfo[i].FriendlyName[0],
                  deviceId: devinfo[i].DeviceID[0],
                  currentState: devinfo[i].CurrentState[0].split(','),
                  capabilities: devinfo[i].CapabilityIDs[0].split(',')
                };
                device.internalState = {};
                for (var i = 0; i < device.capabilities.length; i++) {
                  device.internalState[device.capabilities[i]] = device.currentState[i];
                }
                cb(null, device);
              }
            }
            var groupinfos = result2.DeviceLists.DeviceList[0].GroupInfos;
            if (groupinfos) {
              for (var i = 0; i < groupinfos.length; i++) {
                var device = {
                  friendlyName: groupinfos[i].GroupInfo[0].GroupName[0],
                  deviceId: groupinfos[i].GroupInfo[0].GroupID[0],
                  currentState: groupinfos[i].GroupInfo[0].GroupCapabilityValues[0].split(','),
                  capabilities: groupinfos[i].GroupInfo[0].GroupCapabilityIDs[0].split(',')
                };
                device.internalState = {};
                for (var i = 0; i < device.capabilities.length; i++) {
                  device.internalState[device.capabilities[i]] = device.currentState[i];
                }
                cb(null, device);
              }
            }
          } else {
            console.log(err, data);
          }
        });
      }
    });
  };

  var body = '<u:GetEndDevices xmlns:u="urn:Belkin:service:bridge:1"><DevUDN>%s</DevUDN><ReqListType>PAIRED_LIST</ReqListType></u:GetEndDevices>';
  this.soapAction('urn:Belkin:service:bridge:1', 'GetEndDevices', util.format(body, this.UDN), parseResponse);
}

WemoClient.prototype.setDeviceStatus = function(deviceId, capability, value) {
  var isGroupAction = (deviceId.length === 10) ? 'YES' : 'NO';
  var body = [
    '<u:SetDeviceStatus xmlns:u="urn:Belkin:service:bridge:1">',
    '<DeviceStatusList>',
    '&lt;?xml version=&quot;1.0&quot; encoding=&quot;UTF-8&quot;?&gt;&lt;DeviceStatus&gt;&lt;IsGroupAction&gt;%s&lt;/IsGroupAction&gt;&lt;DeviceID available=&quot;YES&quot;&gt;%s&lt;/DeviceID&gt;&lt;CapabilityID&gt;%s&lt;/CapabilityID&gt;&lt;CapabilityValue&gt;%s&lt;/CapabilityValue&gt;&lt;/DeviceStatus&gt;',
    '</DeviceStatusList>',
    '</u:SetDeviceStatus>'
  ].join('\n');
  this.soapAction('urn:Belkin:service:bridge:1', 'SetDeviceStatus', util.format(body, isGroupAction, deviceId, capability, value));
};

WemoClient.prototype.setBinaryState = function(value) {
  var body = [
    '<u:SetBinaryState xmlns:u="urn:Belkin:service:basicevent:1">',
    '<BinaryState>%s</BinaryState>',
    '</u:SetBinaryState>'
  ].join('\n');
  this.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', util.format(body, value));
};

WemoClient.prototype.subscribe = function(serviceType) {
  if (!this.services[serviceType]) {
    console.warn('Service %s not supported by %s', serviceType, this.UDN);
    return;
  }

  var options = {
    host: this.host,
    port: this.port,
    path: this.services[serviceType].eventSubURL,
    method: 'SUBSCRIBE',
    headers: {
      TIMEOUT: 'Second-130'
    }
  };

  if (!this.sid) {
    // Initial subscription
    options.headers.CALLBACK = '<' + this.callbackURL + '>';
    options.headers.NT = 'upnp:event';
  } else {
    // Subscription renewal
    options.headers.SID = this.sid;
  }

  var req = http.request(options, function(res) {
    if (res.headers.sid) this.sid = res.headers.sid;
    setTimeout(this.subscribe.bind(this), 120 * 1000, serviceType);
  }.bind(this));
  req.end();

};

WemoClient.prototype.listen = function() {
  var self = this;
  var app = express();
  app.use(bodyparser.raw({type: 'text/xml'}));
  app.all('/', function(req, res) {
    xml2js.parseString(req.body, function(err, json){
      if (err) {
        console.log(err);
      }
      // TODO: Check / validate req.headers.sid
      if (json['e:propertyset']['e:property'][0]['StatusChange']) {
        xml2js.parseString(json['e:propertyset']['e:property'][0]['StatusChange'][0], function (err, xml) {
          if (!err && xml) {
            self.emit('StatusChange', {
              DeviceId: xml.StateEvent.DeviceID[0]._,
              CapabilityId: xml.StateEvent.CapabilityId[0],
              Value: xml.StateEvent.Value[0]
            });
          }
        });
      } else if (json['e:propertyset']['e:property'][0]['BinaryState']) {
        self.emit('BinaryState', json['e:propertyset']['e:property'][0]['BinaryState'][0]);
      } else {
        console.log('Unhandled Event: %j', json);
        console.log(json['e:propertyset']['e:property'][0]);
      }
    });
    res.sendStatus(200);
  });

  var server = app.listen(0);
  var port = server.address().port;
  var host = getLocalInterfaceAddress();
  this.callbackURL = 'http://' + host + ':' + port;
  console.info('Started notification server on port %s for device %s', port, this.deviceType);
};
