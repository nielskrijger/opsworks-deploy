/**
 * @module
 * @file This module deploys an application on EC2 using Amazon OpsWorks.
 * @author Niels Krijger
 */

'use strict';

var AWS = require('aws-sdk');
var util = require('util');
var async = require('async');
var moment = require('moment');
var semver = require('semver');

/**
 * Creates a new Amazon OpsWorks deployment runner.
 *
 * The OpsWorksDeploy does the following:
 * - It allows you to deploy an application by specifying just the AppId. This will work immediately if your
 *   application is built from a source repository (not recommended!).
 * - It allows you to deploy the application from a tarbal or zip file stored on S3. When doing so it can look for
 *   the specified version and update the App's url automatically if need be.
 *
 * @param {Object} options Contains all AWS connection options.
 * @param {Object} options.opsworks Contains all AWS OpsWorks connection options such as `apiVersion` and `region`.
 * @param {Object} options.s3 Contains all AWS S3 connections options such as `apiVersion` and `region`.
 */
var OpsWorksDeploy = function(options, pollingTime) {
    this.opsworks = new AWS.OpsWorks(options.opsworks);
    this.s3 = (options.s3) ? new AWS.S3(options.s3) : null;
    this.deployStatus = null;
    this.pollingTime = (options && options.pollingTime) ? options.pollingTime : 10000;
};

module.exports = OpsWorksDeploy;

/**
 * Creates a deployment on Amazon OpsWorks and waits for it to finish.
 *
 * To deploy an application the application must exist.
 *
 * @param {String} appId The OpsWorks aplication id to deploy.
 * @param {String} [s3SourceUrl] The url on S3 to the tarbal or zip file containing the source files.
 * @param {OpsWorksDeploy~waitForDeployFinish} callback Called after deployment was created and is running.
 */
OpsWorksDeploy.prototype.deploy = function(appId, s3SourceUrl, callback) {
    var startTime = new Date().getTime();
    if (!callback) {
        callback = s3SourceUrl; // The s3SourceUrl is optional
        s3SourceUrl = null;
    }

    async.waterfall([

        function doFindApp(callback) {
            this.findApp(appId, callback);
        }.bind(this),
        function doFindRunningInstances(app, callback) {
            this.findRunningInstances(app.StackId, app.Type + '-app', function(err, instances) {
                callback(err, app, instances);
            });
        }.bind(this),
        function doUpdateApp(app, instances, callback) {
            if (s3SourceUrl) {
                this.updateApp(app.AppId, s3SourceUrl, function(err) {
                    callback(err, app, instances);
                });
            } else {
                callback(null, app, instances);
            }
        }.bind(this),
        function doCreateDeployment(app, instances, callback) {
            this.createDeployment(app.StackId, app.AppId, callback);
        }.bind(this),
        function doWaitForDeployFinish(deploymentId, callback) {
            this.waitForDeployFinish([deploymentId], callback);
        }.bind(this)
    ], function(err, status) {
        var duration = moment.duration(new Date().getTime() - startTime);
        console.log('Finished deployment in ' + duration.asMinutes().toFixed(2) + ' minutes');
        callback(err, status);
    });
};

// TODO finish this function
OpsWorksDeploy.prototype.deployLatest = function(appId, bucket, preSemver, postSemver, callback) {
    this.findLatestVersion(bucket, preSemver, postSemver, function(err, version) {
        if (err) {
            return callback(err);
        }

    });
};

/**
 * Searches the app description.
 *
 * @param {String} appId The application id.
 * @param {OpsWorksDeploy~findApp} callback
 */
OpsWorksDeploy.prototype.findApp = function(appId, callback) {
    var params = {
        AppIds: [appId]
    };
    this.opsworks.describeApps(params, function(err, data) {
        if (err) {
            return callback(err);
        } else if (!data.Apps || data.Apps.length === 0) {
            return callback(new Error('Unable to find AppId "' + appId + '", check if it exists and you have sufficient privileges'));
        }
        callback(null, data.Apps[0]);
    });
};

/**
 * @callback OpsWorksDeploy~findApp
 * @param {Error} error Contains an error if something went wrong.
 * @param {Object} app The application description from OpsWorks.
 */

/**
 * Returns a list of running instances for a specific stack and LayerType.
 *
 * When no running instances were found returns an error in the first callback argument.
 *
 * @param {String} stackId The stack id.
 * @param {String} layerType The layer type.
 * @param {OpsWorksDeploy~findRunningInstancesCallback} callback Called after running instances were found.
 */
OpsWorksDeploy.prototype.findRunningInstances = function(stackId, layerType, callback) {
    this.findLayerByType(stackId, layerType, function(err, layer) {
        if (err) {
            return callback(err);
        } else if (!layer) {
            return callback(new Error('Unable to find layer with type "' + layerType + '" in StackId "' + stackId + '"'));
        }
        this.findRunningInstancesByLayerId(layer.LayerId, function(err, instances) {
            if (err) {
                return callback(err);
            } else if (instances.length === 0) {
                return callback(new Error('No running instances found for LayerId "' + layer.LayerId + '" in StackId "' + stackId + '"'));
            }
            console.log('Found ' + instances.length + ' running instance(s) in LayerId "' + layer.LayerId + '" with StackId "' + stackId + '"');
            callback(null, instances);
        });
    }.bind(this));
};

/**
 * @callback OpsWorksDeploy~findRunningInstancesCallback
 * @param {Error} error Contains an error if something went wrong.
 * @param {Object[]} instances An array of running instance.
 */

/**
 * Searches the layer description based on the layer's type.
 *
 * A Layer type is unique.
 *
 * @param {String} stackId The stack id.
 * @param {String} layerType The layer type.
 * @param {OpsWorksDeploy~findLayerByTypeCallback} callback Called after deployment was finished.
 */
OpsWorksDeploy.prototype.findLayerByType = function(stackId, layerType, callback) {
    var params = {
        StackId: stackId
    };
    this.opsworks.describeLayers(params, function(err, data) {
        if (err) {
            return callback(err);
        } else if (!data.Layers || data.Layers.length === 0) {
            return callback(new Error('No OpsWorks layers found in StackId "' + stackId + '"", check if a layer exists and whether you have sufficient privileges'));
        }
        var result = null;
        var i = 0;
        var max = data.Layers.length;
        while (i < max && result === null) {
            if (data.Layers[i].Type == layerType) {
                result = data.Layers[i];
            }
            i++;
        }
        callback(null, result);
    }.bind(this));
};

/**
 * @callback OpsWorksDeploy~findLayerByTypeCallback
 * @param {Error} error Contains an error if something went wrong.
 * @param {Object} layer A description of the layer or `null` when not found.
 */

/**
 * Returns a list of running instances within a specific layer.
 *
 * @param {String} layerId The OpsWorks layer id.
 * @param {OpsWorksDeploy~findRunningInstancesCallback} callback Called after retrieving the running instances.
 */
OpsWorksDeploy.prototype.findRunningInstancesByLayerId = function(layerId, callback) {
    var params = {
        LayerId: layerId
    };
    this.opsworks.describeInstances(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        var instances = data.Instances.filter(function(element) {
            return element.Status == 'online';
        });
        callback(null, instances);
    });
};

/**
 * @callback OpsWorksDeploy~findRunningInstancesCallback
 * @param {Error} error Contains an error if something went wrong.
 * @param {Object[]} instances An array of instances that are currently running or an empty array when none were found.
 */

/**
 * Creates a deployment on Amazon OpsWorks.
 *
 * To deploy an application it must first be created in OpsWorks.
 *
 * @param {String} stackId The OpsWorks stack id.
 * @param {String} appId The OpsWorks application id.
 * @param {OpsWorksDeploy~createDeploymentCallback} callback Called after deployment was created.
 */
OpsWorksDeploy.prototype.createDeployment = function(stackId, appId, callback) {
    var params = {
        Command: {
            Name: 'deploy'
        },
        StackId: stackId,
        AppId: appId
    };
    console.log('Created deployment in Amazon OpsWorks with AppId "' + params.AppId + '" on StackId "' + params.StackId + '"');
    this.opsworks.createDeployment(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        console.log('Deployment started with DeploymentId "' + data.DeploymentId + '", this process can take several minutes.');
        callback(null, data.DeploymentId);
    }.bind(this));
};

/**
 * @callback OpsWorksDeploy~createDeploymentCallback
 * @param {Error} error Contains an error if something went wrong.
 * @param {String} status The deployment status, either 'failed' or 'successful'.
 */

/**
 * Keeps waiting for a deployment to be finished.
 *
 * There are three deployment states: running, failed and successful. While the deployment is running it will keep
 * polling until it finishes.
 *
 * @param {String[]} deployments A list of deployment identifiers.
 * @param {OpsWorksDeploy~waitForDeployFinish} callback Called after deployment status was retrieved.
 */
OpsWorksDeploy.prototype.waitForDeployFinish = function(deploymentIds, callback) {
    setTimeout(function() {
        if (this.state == 'successfull' || this.state == 'failed') {
            return callback(null, this.state);
        }
        this.getDeploymentStatus(deploymentIds, function(err, status) {
            if (err) {
                return callback(err);
            }
            this.deployStatus = status;
            if (status == 'running') { // If status is running, retry
                console.log('Deployment status is "running", checking again in ' + (this.pollingTime / 1000).toFixed(1) + ' seconds...');
                this.waitForDeployFinish(deploymentIds, callback);
            } else if (status == 'failed') {
                callback(new Error('Deployment failed, look in Amazon OpsWorks deployment logs to see why'));
            } else if (status == 'successful') {
                console.log('Deployment was successful!');
                callback(null, status);
            } else {
                callback(new Error('Unknown deployment status "' + status + '"'));
            }
        }.bind(this));
    }.bind(this), this.pollingTime);
};

/**
 * @callback OpsWorksDeploy~waitForDeployFinish
 * @param {Error} error Contains an error if something went wrong.
 * @param {String} status The deployment status, either 'failed' or 'successful'.
 */

/**
 * Retrieves the deployment status of one or more deployments from Amazon OpsWorks.
 *
 * @param {String[]} deployments A list of deployment identifiers.
 * @param {OpsWorksDeploy~getDeploymentStatus} callback Called after deployment status was retrieved.
 */
OpsWorksDeploy.prototype.getDeploymentStatus = function(deploymentIds, callback) {
    var params = {
        DeploymentIds: deploymentIds
    };
    this.opsworks.describeDeployments(params, function(err, data) {
        if (err) {
            callback(err);
        } else if (!data.Deployments || data.Deployments.length !== deploymentIds.length) {
            callback(new Error('Could not retrieve all deployment statuses for deployment ids ' + deploymentIds));
        } else {
            callback(null, this._determineDeploymentStatus(data.Deployments));
        }
    }.bind(this));
};

/**
 * @callback OpsWorksDeploy~getDeploymentStatus
 * @param {Error} error Contains an error if something went wrong.
 * @param {string} status The deployment status, either 'failed', 'running' or 'successful'.
 */

/**
 * Determines the overall deployment status of a set of deployments.
 *
 * The rules followed are as follows:
 * - If any deployment has not finished yet the status is 'running'.
 * - If all deployments have finished but at least one of them has failed the overall status is 'failed'.
 * - If all deployments have finished and all were successful the overall status is 'successful'.
 *
 * @param {Object[]} deployments A list of deployment objects generated by AWS.describeDeployments.
 * @returns {String} The overall deployment status.
 */
OpsWorksDeploy.prototype._determineDeploymentStatus = function(deployments) {
    var status = null;
    for (var i = 0, max = deployments.length; i < max; i++) {
        if (status == 'running' || deployments[i].Status == 'running') {
            status = 'running'; // Pending overrules all states, even failed ones
        } else if (status == 'failed' || deployments[i].Status == 'failed') {
            status = 'failed'; // Failed state overrules successfull state. It is not clear what 'skipped' means, to be safe interpret this as 'failed'
        } else if (status != 'failed') {
            status = 'successful';
        }
    }
    return status;
};

/**
 * Looks for all artifact files in S3 and finds the one with the highest version.
 *
 * This version check allows for semver-compatible versions only.
 *
 * You need to specify both the filename substring before the semver version and the filename substring after the
 * semver version. For example, if the application filename is `my-app-1.2.3.tar.gz` set 'preSemver = "my-app-"' and
 * `postSemver = ".tar.gz"`.
 *
 * @param {String} bucket The name of the S3 bucket.
 * @param {String} preSemver The prefix before semver of the package filename.
 * @param {String} postSemver The postfix after semver of the package filename.
 * @param {OpsWorksDeploy~findLatestVersionCallback} callback Called after finding the latest semver version.
 */
// TODO refactor this function by splitting it up and/or using async.waterfall
// TODO replace preSemver and postSemver with some sort of regular expression or mask...
/*
OpsWorksDeploy.prototype.findLatestVersion = function(bucket, preSemver, postSemver, callback) {
    var params = {
        Bucket: bucket,
        Prefix: preSemver
    };
    this.s3.listObjects(params, function(err, data) {
        if (err) {
            return callback(err);
        } else if (data.Contents.length == 0) {
            return callback(new Error('No files found in bucket "' + bucket + '" with file prefix "' + preSemver + '"'));
        }

        // Filters the files that do not have a correct postfix
        var files = data.Contents.filter(function(element) {
            return element.Key.indexOf(postSemver, element.length - postSemver.length) !== -1;
        });

        if (files.length == 0) {
            return callback(new Error('No files found in bucket "' + bucket + '" with file prefix "' + preSemver + '" and postfix "' + postSemver + '"'));
        }

        // Remove pre and postfixes to filter down to the semver version
        var versions = files.map(function(element) {
            return element.Key.replace(preSemver, "").replace(postSemver, "");
        });

        // Returns the list of valid semver versions
        var validVersions = versions.filter(function(element) {
            if (semver.valid(element) !== null) {
                return true;
            } else {
                console.log('Ignoring file "' + preSemver + element + postSemver + '", "' + element + '" is not a valid semver version');
                return false;
            }
        });

        // If no valid versions were found throw an error
        if (validVersions.length == 0) {
            return callback(new Error('No valid deployment files found, check your file name'));
        }

        // Find highest semver version in list of valid version
        var highestVersion = null;
        for (var i = 0, max = validVersions.length; i < max; i++) {
            if (highestVersion == null || semver.gt(validVersions[i], highestVersion)) {
                highestVersion = validVersions[i];
            }
        }
        callback(err, preSemver + highestVersion + postSemver);
    })
};
*/

/**
 * @callback OpsWorksDeploy~findLatestVersionCallback
 * @param {Error} error Contains an error if something went wrong.
 * @param {String} filepath The filepath of the sem
 */

/**
 * Updates the source url of an Application.
 *
 * This can be used to update the Aplication to the newest version.
 *
 * The callback returns an error if something went wrong or `null` when update was applied successfully.
 *
 * @param {String} appId The Application id.
 * @param {String} [s3SourceUrl] The url on S3 to the tarbal or zip file containing the source files.
 * @Param {OpsWorksDeploy~updateAppCallback} callback Called after updating the OpsWorks Application url.
 */
OpsWorksDeploy.prototype.updateApp = function(appId, s3SourceUrl, callback) {
    var params = {
        'AppId': appId,
        'AppSource': {
            'Url': s3SourceUrl
        }
    };
    this.opsworks.updateApp(params, function(err) {
        if (!err) {
            console.log('Updated AppId "' + appId + '" with S3 source url "' + s3SourceUrl + '"');
        }
        callback(err);
    });
};

/**
 * @callback OpsWorksDeploy~updateAppCallback
 * @param {Error} error Contains an error if something went wrong.
 */
