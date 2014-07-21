# OpsWorks Deploy

THIS LIBRARY IS NO LONGER BEING MAINTAINED AND SHOULD BE USED FOR INSPIRATIONAL PURPOSES ONLY!

This *OpsWorks Deploy* allows you to (re)-deploy an application on Amazon OpsWorks.

This module was created for a PoC and you should be aware of its limitations before using/adapting it. These are:

 * The deployment file must a tarbal or zipfile.
 * The deployment file must be available on S3.
 * The deployment will be deployed on all instances belonging to a specific layer; the layer is retrieved by mapping
   the application type with layer type (that is, there is a 1-on-1 relationship between layer and application).
 * If there are no running instances within the application's layer the deployment will fail (default OpsWorks
   behaviour is it will postpone actual deployment untill instances come back online).

You trigger a deployment as follows:

```
    export AWS_ACCESS_KEY_ID='MY_KEY'
    export AWS_SECRET_ACCESS_KEY='MY_SECRET'
    node deploy.js --appId "9cf74296-aba7-4fb5-a4b1-1b982e90d5dc" --s3url "https://s3-eu-west-1.amazonaws.com/my-artifacts/deployment-{VERSION}.tar.gz" --version '1.0.0'
```

The `{VERSION}` within `--s3url` is replaced when `--version` is specified.
