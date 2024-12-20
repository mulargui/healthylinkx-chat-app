set -x

#propagate the config.json file to the different components
cp $(pwd)/config.json $(pwd)/lambda
cp $(pwd)/config.json $(pwd)/lambda/src 
cp $(pwd)/config.json $(pwd)/ux
cp $(pwd)/config.json $(pwd)/datastore

#build and deploy the datastore
docker run --rm -w /src -v $(pwd)/datastore:/src node:22 \
	npm install @aws-sdk/client-rds @aws-sdk/client-ec2 adm-zip mysql2
docker run --rm -w /src -v $(pwd)/datastore:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/DSCreate.js

#build and deploy the lambda
docker run --rm -w /src -v $(pwd)/lambda:/src node:22 \
	npm install @aws-sdk/client-lambda @aws-sdk/client-iam adm-zip
docker run --rm -w /src -v $(pwd)/lambda/src:/src node:22 \
	npm install @aws-sdk/client-bedrock-runtime
docker run --rm -w /src -v $(pwd)/lambda:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/deploy-lambda.js

#unit test the lambda
docker run --rm -w /src -v $(pwd)/lambda:/src node:22 \
	npm install --save-dev jest axios @aws-sdk/client-lambda
docker run --rm -w /src -v $(pwd)/lambda:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 npm test

#build and deploy the front end app in S3 AWS
cp $(pwd)/lambda/lambdaurl.json $(pwd)/ux/public #copy lambda's url file
docker run --rm -w /src -v $(pwd)/ux/infra:/src node:22 \
	npm install @aws-sdk/client-s3 @aws-sdk/lib-storage \
	fs path child_process util
docker run --rm -w /src -v $(pwd)/ux:/src node:22 \
	npm install --save-dev @babel/plugin-proposal-private-property-in-object \
	axios  @heroicons/react
docker run --rm -w /src -v $(pwd)/ux:/src \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node infra/deploy-s3.js

#unit test the front end app
docker run --rm -w /src -v $(pwd)/ux:/src node:22 \
	npm install --save-dev @testing-library/react \
	@testing-library/jest-dom jest \
	@babel/preset-env @babel/preset-react
docker run --rm -w /src -v $(pwd)/ux:/src \
    node:22 npm test

#build documentation
docker run --rm -w /src -v $(pwd):/src node:22 \
	npm install jsdoc
docker run --rm -w /src -v $(pwd):/src \
    node:22 npm run jsdoc

exit
#build and deploy the front end app in EC2 AWS
docker run --rm -w /src -v $(pwd)/ux:/src node:22 npm install axios
docker run --rm -w /src -v $(pwd)/ux:/src -p 3000:3000 -d node:22 npm start