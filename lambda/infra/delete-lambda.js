const { 
  LambdaClient, 
  DeleteFunctionCommand,
  RemovePermissionCommand,
  DeleteFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand
} = require("@aws-sdk/client-lambda");
const { 
  IAMClient, 
  DeleteRoleCommand, 
  DetachRolePolicyCommand, 
  ListAttachedRolePoliciesCommand 
} = require("@aws-sdk/client-iam");
const fs = require('fs');
const path = require('path');

// Read the config file
const configPath = path.join(__dirname, '..', 'config.json');
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);

// Extract the function name and role name from the config
const FUNCTION_NAME = config.lambda.functionName;
const ROLE_NAME = config.lambda.roleName;

const REGION = process.env.AWS_REGION || "us-east-1";

const lambda = new LambdaClient({ region: REGION });
const iam = new IAMClient({ region: REGION });

async function deleteFunctionUrl(functionName) {
  try {
    // Check if function URL exists
    const getFunctionUrlCommand = new GetFunctionUrlConfigCommand({ FunctionName: functionName });
    await lambda.send(getFunctionUrlCommand);

    // First, remove the public access permission
    try {
      const removePermissionCommand = new RemovePermissionCommand({
        FunctionName: functionName,
        StatementId: "FunctionURLAllowPublicAccess"
      });
      await lambda.send(removePermissionCommand);
      console.log("Function URL public access permission removed successfully");
    } catch (error) {
      if (error.name !== "ResourceNotFoundException") {
        console.error("Error removing function permission:", error);
      }
    }
    
    // Next, delete the function URL configuration
    const deleteFunctionUrlCommand = new DeleteFunctionUrlConfigCommand({ FunctionName: functionName });
    await lambda.send(deleteFunctionUrlCommand);
    console.log("Function URL deleted successfully");
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      console.log("No function URL found. Skipping deletion.");
    } else {
      throw error;
    }
  }
}

async function deleteRole(roleName) {
  try {
    const listPoliciesCommand = new ListAttachedRolePoliciesCommand({ RoleName: roleName });
    const { AttachedPolicies } = await iam.send(listPoliciesCommand);

    for (const policy of AttachedPolicies) {
      const detachPolicyCommand = new DetachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: policy.PolicyArn
      });
      await iam.send(detachPolicyCommand);
      console.log(`Detached policy ${policy.PolicyArn} from role ${roleName}`);
    }

    const deleteRoleCommand = new DeleteRoleCommand({ RoleName: roleName });
    await iam.send(deleteRoleCommand);
    console.log(`Role ${roleName} deleted successfully`);
  } catch (error) {
    console.error(`Error deleting role ${roleName}:`, error);
  }
}

async function deleteLambda() {
  try {
    // Delete function URL first
    await deleteFunctionUrl(FUNCTION_NAME);

    // Then delete the Lambda function
    const deleteFunctionCommand = new DeleteFunctionCommand({ FunctionName: FUNCTION_NAME });
    await lambda.send(deleteFunctionCommand);
    console.log(`Lambda function ${FUNCTION_NAME} deleted successfully`);

    // Finally, delete the IAM role
    await deleteRole(ROLE_NAME);
  } catch (error) {
    console.error("Error deleting Lambda function:", error);
  }
}

deleteLambda().catch(console.error);
