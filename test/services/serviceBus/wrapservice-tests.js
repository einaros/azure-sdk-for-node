﻿/**
* Copyright 2011 Microsoft Corporation
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

var testCase = require('nodeunit').testCase;

var azure = require('../../../lib/azure');
var azureutil = require('../../../lib/util/util');

var ISO8061Date = require('../../../lib/util/iso8061date');

var testutil = require('../../util/util');
var wrapservicetestutil = require('../../util/wrapservice-test-utils');

var ServiceClient = require("../../../lib/services/serviceclient");
var Constants = require('../../../lib/util/constants');
var HttpConstants = Constants.HttpConstants;
var StorageErrorCodeStrings = Constants.StorageErrorCodeStrings;

var wrapService;

var testPrefix = 'wrapservice-tests';

module.exports = testCase(
{
  setUp: function (callback) {
    wrapservicetestutil.setUpTest(module.exports, testPrefix, function (err, newWrapService) {
      wrapService = newWrapService;
      callback();
    });
  },

  tearDown: function (callback) {
    wrapservicetestutil.tearDownTest(module.exports, wrapService, testPrefix, callback);
  },

  testWrapAccessToken: function (test) {
    var namespace = process.env[ServiceClient.EnvironmentVariables.AZURE_SERVICEBUS_NAMESPACE];

    wrapService.wrapAccessToken('http://' + namespace + '.servicebus.windows.net/myqueue', function (error, wrapAccessToken) {
      test.equal(error, null);
      test.notEqual(wrapAccessToken['wrap_access_token'], null);
      test.notEqual(wrapAccessToken['wrap_access_token_expires_in'], null);

      test.done();
    });
  }
});
