set -x

#remove the datastore
docker run --rm -w /src -v $(pwd)/datastore:/src node:22 \
	npm install @aws-sdk/client-rds @aws-sdk/client-ec2
docker run --rm -w /src -v $(pwd)/datastore:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/DSDelete.js
exit
#remove the lambda from AWS
docker run --rm -w /src -v $(pwd)/lambda:/src node:22 \
	npm install @aws-sdk/client-lambda @aws-sdk/client-iam
docker run --rm -w /src -v $(pwd)/lambda:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/delete-lambda.js

#remove the front end app from S3 AWS
docker run --rm -w /src -v $(pwd)/ux/infra:/src node:22 \
	npm install @aws-sdk/client-s3 
docker run --rm -w /src -v $(pwd)/ux:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/delete-s3.js
