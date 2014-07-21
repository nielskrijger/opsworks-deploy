/**
 * @module
 * @file Deploys
 * @author Niels Krijger
 */

 /**
  * Don't hard-code your credentials!
  * Export the following environment variables instead:
  *
  * export AWS_ACCESS_KEY_ID='YOUR_ID'
  * export AWS_SECRET_ACCESS_KEY='YOUR_SECRET'
  */

'use strict';

var nomnom = require('nomnom');
var fs = require('fs');
var OpsWorksDeploy = require('./lib/OpsWorksDeploy');

// Parse CLI options
var opts = nomnom.option('appId', {
        abbr: 'a',
        required: true,
        help: 'The application id (required)'
    })
    .option('s3url', {
        abbr: 's',
        help: 'Url to the S3 tarbal or zip file (optional)'
    })
    .option('appVersion', {
        abbr: 'v',
        help: 'The package version '
    })
    .parse();

// Amazon settings
var opsWorksOptions = {
    opsworks: {
        region: 'us-east-1', // Opsworks is currently only supported on us-east-1
        apiVersion: '2013-02-18'
    },
    s3: {
        region: 'eu-west-1',
        apiVersion: '2006-03-01'
    }
};

// Replace {VERSION} in s3url with contents of the VERSION file
if (opts.s3url && opts.appVersion) {
    opts.s3url = opts.s3url.replace('{VERSION}', opts.appVersion);
}

// Deploy application on OpsWorks
var deployer = new OpsWorksDeploy(opsWorksOptions);
deployer.deploy(opts.appId, opts.s3url, function(err, status) {
    if (err) {
        console.log(err);
    }
    process.exit((err) ? 1 : 0); // 1 Indicates an error occurred, 0 is success
});
