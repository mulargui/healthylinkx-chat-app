const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const fs = require("fs");
const path = require('path');

//healthylinkx extension
const { systemPrompt, tool_definition, SearchDoctors } = require('./healthylinkx.js');

// Read the config file
const configPath = path.join(__dirname, 'config.json');
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);

const REGION = process.env.AWS_REGION || "us-east-1";
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

// helper function to support retries
async function invokeBedrockWithRetry(params, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const command = new InvokeModelCommand(params);
      return await bedrockClient.send(command);
    } catch (error) {
      if (error.name === 'ThrottlingException' && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 100; // exponential backoff
        console.log("Invoking Bedrock ThrottlingException, waiting:", delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

//
// Abstraction layer to keep the code independent of the model.
// Tested with Anthropic Claude 3 Haiku and Amazon Titan Text Lite
// For Claude we are adding function call parameters to the body
//
function prepareModelRequest(modelId, messages, max_tokens, temperature) {
  if (modelId.startsWith('anthropic.claude')) {
    return {
      modelId: modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: config.bedrock.anthropic_version,
        max_tokens: max_tokens,
        temperature: temperature,
        messages: messages,
        system: systemPrompt,
        tools: [tool_definition]
      })
    };
  } else if (modelId.startsWith('amazon.titan')) {
    // For Titan, we'll use the last message as the input
    //const prompt = messages[messages.length - 1].content;
    // For Titan, we'll include the entire conversation history in the prompt
    const conversationHistory = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    const prompt = `${conversationHistory}\nHuman: ${messages[messages.length - 1].content}\nassistant:`;
    
    return {
      modelId: modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: max_tokens,
          temperature: temperature,
          topP: 1,
          stopSequences: []
        }
      })
    };
  } else {
    throw new Error(`Unsupported model: ${modelId}`);
  }
}

//
// for Claude we are including code to support function calls
//
function parseModelResponse(modelId, responseBody) {
  if (modelId.startsWith('anthropic.claude')) {
    if (responseBody.stop_reason === "tool_use")
      return {case: "tool", content: responseBody.content[1]};
    return {case: "end", content: responseBody.content[0].text};
  } else if (modelId.startsWith('amazon.titan')) {
    return {case: "end", content: responseBody.results[0].outputText};
  } else {
    throw new Error(`Unsupported model: ${modelId}`);
  }
}

//
// helper function to invoke the tool
//
function invokeTool(tool){
  console.log("Tool usage:", JSON.stringify(tool));

  // at this time only support SearchDoctors
  const toolName = tool.name;
  if (toolName !== "SearchDoctors")
    throw new Error(`Unsupported tool: ${toolName}`);

  //parameters
  console.log(`Tool parameters: gender: ${tool.input.gender}, 
    lastname: ${tool.input.lastname}, 
    speciality: ${tool.input.specialty}, 
    zipcode: ${tool.input.zipcode}`);

  const result = SearchDoctors(tool.input.gender, 
    tool.input.lastname, 
    tool.input.specialty, 
    tool.input.zipcode);

  if (result.statusCode !== 200)
    throw new Error(`Error calling the tool: ${result.statusCode}`);   
  
  return result.body;
}

//
// Handler of the Lambda invokation
//
exports.handler = async (event) => {
  console.log("Lambda function invoked with event:", JSON.stringify(event));
  console.log("Parsed config:", JSON.stringify(config));

  try {
    // Extract the message from the event
    //const messages = [{ "role": 'user', "content": "which is the capital of Paris?"}];
    const body = JSON.parse(event.body);
    console.log("Raw response body:", JSON.stringify(body));
    const messages = body.messages || [];
    console.log("Raw response messages:", JSON.stringify(messages));
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("Invalid input: Messages should be a non-empty array");
    }

    const max_tokens = body.max_tokens || config.bedrock.maxTokens || 300;
    const temperature = body.temperature || config.bedrock.temperature || 1.0;
    const modelId = config.bedrock.model;

    // we need to call Bedrock several times if we use tools
    let answer; //defined here as we need it for the loop condition and used later
    do{
      // Verify all messages are properly formatted (used for debugging)
      messages.forEach((msg, index) => {
        if (typeof msg.content !== 'string')
          console.error(`Message at index ${index} has non-string content:`, msg);
      });

      // Prepare the request for Bedrock
      console.log("Initializing Bedrock client");
      const params = prepareModelRequest(modelId, messages, max_tokens, temperature);
      console.log("Preparing to invoke Bedrock model with params:", JSON.stringify(params));

      // Invoke Bedrock model
      const response = await invokeBedrockWithRetry(params);
      console.log("Received response from Bedrock:", JSON.stringify(response));

      // Parse the response
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      console.log("Parsed response body:", JSON.stringify(responseBody));
      answer = parseModelResponse(modelId, responseBody);
      console.log("Parsed answer:", JSON.stringify(answer));

      // Add the assistant's response to the conversation history
      messages.push({ role: "assistant", content: JSON.stringify(answer.content)});

      //we need to call an external tool
      if (answer.case === "tool"){
        const result = invokeTool(answer.content);
        console.log("Tool result:", JSON.stringify(result));

        //add the result to the conversation history
        messages.push({ role: "user", content: JSON.stringify([{
          type: "tool_result",
          tool_use_id: answer.content.id,
          //content: `Search Results:\n${JSON.stringify(result.Doctors)}`
          content: result.Doctors
         }])});

        console.log("Added to conversation history:", JSON.stringify(messages.at(-1)));
      }
    } while (answer.case !== "end");

    return {
      statusCode: 200,
      body: JSON.stringify({ 
          answer: answer.content,
          conversation: messages  // Return the updated conversation history
      }),
      headers: {
          'Content-Type': 'application/json'
      }
    };
  } catch (error) {
    console.error("Error occurred:", error);
    console.error("Error stack:", error.stack);
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    
    if (error.$metadata) {
      console.error("Error metadata:", JSON.stringify(error.$metadata));
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred processing your request' }),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }
};
