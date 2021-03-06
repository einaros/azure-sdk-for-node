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

// Module dependencies.
var util = require('util');
var crypto = require('crypto');

var azureutil = require('../../util/util');
var ServiceClient = require('../serviceclient');
var StorageServiceClient = require('../storageserviceclient');
var WebResource = require('../../http/webresource');
var Constants = require('../../util/constants');
var HttpConstants = Constants.HttpConstants;
var HeaderConstants = Constants.HeaderConstants;

// Expose 'BatchServiceClient'.
exports = module.exports = BatchServiceClient;

// Module constants.
BatchServiceClient.BATCH_CODE = -1;

/**
* Creates a new BatchServiceClient.
*
* Implements a batch service client able to produce OData batch requests from an array of operations.
* For more information about OData batch processing refer to http://www.odata.org/developers/protocols/batch.
*
* @constructor
*/
function BatchServiceClient(host, storageAccount, storageAccessKey, authenticationProvider) {
  BatchServiceClient.super_.call(this, host, storageAccount, storageAccessKey, authenticationProvider);

  this.operations = null;
}

util.inherits(BatchServiceClient, StorageServiceClient);

/**
* Begins a new batch scope.
*/
BatchServiceClient.prototype.beginBatch = function () {
  this.operations = [];
};

/**
* Determines if there is a current batch.
* 
* @return {boolean} Boolean value indicating if service is in a batch context or not.
*/
BatchServiceClient.prototype.isInBatch = function () {
  return this.operations !== null;
};

/**
* Adds an operation to the batch.
*
* @param {object}  webResource The request parameters.
* @param {object}  outputData  The body for the operation.
*/
BatchServiceClient.prototype.addOperation = function (webResource, outputData) {
  if (azureutil.isNull(outputData)) {
    outputData = '';
  }

  if (webResource.httpVerb !== ServiceClient.HTTP_VERB_GET) {
    webResource.headers[HeaderConstants.CONTENT_ID] = this.operations.length + 1;

    if (webResource.httpVerb !== ServiceClient.HTTP_VERB_DELETE) {
      webResource.headers[HeaderConstants.CONTENT_TYPE] = 'application/atom+xml;type=entry';
    }

    webResource.headers[HeaderConstants.CONTENT_LENGTH] = outputData.length;
  }

  this._setRequestUrl(webResource);
  var operation = {
    webResource: webResource
  };

  operation.content = webResource.httpVerb + ' ' + webResource.requestUrl + ' HTTP/1.1\n';

  for (var header in webResource.headers) {
    operation.content += header + ': ' + webResource.headers[header] + '\n';
  }

  operation.content += '\n';
  operation.content += outputData;

  this.operations.push(operation);
};

/**
* Commits the operations within the batch scope.
*
* @param {object}      [options]                        The request options.
* @param {int}         [options.timeoutIntervalInMs]    The timeout interval, in milliseconds, to use for the request.
* @param {function}    callback                         The response callback function.
*/
BatchServiceClient.prototype.commitBatch = function (optionsOrCallback, callback) {
  var options = null;
  if (typeof optionsOrCallback === 'function' && !callback) {
    callback = optionsOrCallback;
  }
  else {
    options = optionsOrCallback;
  }

  if (!this.operations ||
    this.operations.length <= 0) {
    throw new Error('Nothing to commit');
  }

  var batchBoundary = 'batch_' + crypto.createHash('md5').update("" + (new Date()).getTime()).digest("hex");
  var changesetBoundary = 'changeset_' + crypto.createHash('md5').update("" + (new Date()).getTime()).digest("hex");

  var body = '--' + batchBoundary + '\n';
  body += HeaderConstants.CONTENT_TYPE + ': multipart/mixed; boundary=' + changesetBoundary + '\n\n';

  for (var operation in this.operations) {
    body += '--' + changesetBoundary + '\n';
    body += HeaderConstants.CONTENT_TYPE + ': application/http\n';
    body += HeaderConstants.CONTENT_TRANSFER_ENCODING_HEADER + ': binary\n\n';
    body += this.operations[operation].content + '\n';
  }

  body += '--' + changesetBoundary + '--\n';
  body += '--' + batchBoundary + '--';

  var webResource = WebResource.post('$batch')
    .withOkCode(HttpConstants.HttpResponseCodes.ACCEPTED_CODE)
    .withRawResponse(true);

  webResource.addOptionalHeader(HeaderConstants.CONTENT_TYPE, 'multipart/mixed; boundary=' + batchBoundary);
  webResource.addOptionalHeader(HeaderConstants.DATA_SERVICE_VERSION, '1.0;NetFx');
  webResource.addOptionalHeader(HeaderConstants.MAX_DATA_SERVICE_VERSION, '2.0;NetFx');
  webResource.addOptionalHeader(HeaderConstants.CONTENT_LENGTH, body.length);

  var self = this;

  // Store current operations to process response
  // and clear batch operation to end isInBatch state after commiting
  var requestOperations = this.operations;
  this.operations = null;

  var processResponseCallback = function (responseObject, next) {
    var responseObjects = self.processResponse(responseObject, requestOperations);
    responseObject.operationResponses = responseObjects;

    var finalCallback = function (returnObject) {
      // perform final callback
      callback(returnObject.error, returnObject.operationResponses, returnObject.response);
    };

    next(responseObject, finalCallback);
  };

  this.performRequest(webResource, body, options, processResponseCallback);
};

/**
* Processes a batch response.
*
* @param {object} responseObject The response object for the batch request.
* @return An array with the processed / parsed responses.
*/
BatchServiceClient.prototype.processResponse = function (responseObject, requestOperations) {
  var responses = null;
  if (responseObject && responseObject.response && responseObject.response.body) {
    responses = [];
    var rawResponses = responseObject.response.body.split(Constants.CHANGESET_DELIMITER);

    var validResponse = 0;
    for (var i in rawResponses) {
      // Find HTTP/1.1 CODE line
      var httpLocation = rawResponses[i].indexOf('HTTP/');
      if (httpLocation !== -1) {
        var rawResponse = rawResponses[i].substring(httpLocation);
        // valid response
        var response = this.processOperation(requestOperations[validResponse++].webResource, rawResponse);
        responses.push(response);
      }
    }
  }

  return responses;
};

/**
* Processes a partial response.
*
* @param {WebResource} webResource The web resource for the response.
* @param {string}      rawResponse The raw, unparsed, http response from the server for the batch response.
* @return {object} A response object.
*/
BatchServiceClient.prototype.processOperation = function (webResource, rawResponse) {
  var responseObject = {
    error: null,
    response: { }
  };

  // Retrieve response code
  var firstSpace = rawResponse.indexOf(' ');
  responseObject.response.statusCode = parseInt(rawResponse.substring(firstSpace + 1, rawResponse.indexOf(' ', firstSpace + 2)), 10);
  responseObject.response.isSuccessful = webResource.validResponse(responseObject.response.statusCode);

  // Skip that line
  rawResponse = rawResponse.substring(rawResponse.indexOf('\n'));

  // Split into multiple lines and process them
  var responseLines = rawResponse.split('\r\n');

  // Populate headers
  responseObject.response.headers = { };
  responseObject.response.body = '';

  var isBody = false;
  for (var i in responseLines) {
    var line = responseLines[i];

    if (line === '' && !isBody) {
      isBody = true;
    } else if (isBody) {
      responseObject.response.body += line;
    } else {
      var headerSplit = line.indexOf(':');
      if (headerSplit !== -1) {
        responseObject.response.headers[line.substring(0, headerSplit).trim()] = line.substring(headerSplit + 1).trim();
      }
    }
  }

  this._parseResponse(responseObject.response);
  if (!responseObject.response.isSuccessful) {
    responseObject.error = this._normalizeError(responseObject.response.body);
  }

  return responseObject;
};