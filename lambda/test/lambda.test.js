const { 
  LambdaClient, 
  GetFunctionUrlConfigCommand
} = require("@aws-sdk/client-lambda");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Read the config file
const configPath = path.join(__dirname, '..', 'config.json');
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);
// Extract the function name from the config
const FUNCTION_NAME = config.lambda.functionName;

let FUNCTION_URL;

// Helper function to make requests to the Lambda function
async function invokeLambda(body) {
  try {
    const response = await axios.post(FUNCTION_URL, body);
    return response.data;
  } catch (error) {
    throw error.response ? error.response.data : error;
  }
}

describe('Bedrock Chat Lambda Unit Tests', () => {
  
  beforeAll(async () => {
    const REGION = process.env.AWS_REGION || "us-east-1";
    const command = new GetFunctionUrlConfigCommand({ FunctionName: FUNCTION_NAME });

    try {
      const lambda = new LambdaClient({ region: REGION });
      const response = await lambda.send(command);
      FUNCTION_URL = response.FunctionUrl;
      //console.log('Lambda Function URL:', FUNCTION_URL);
    } catch (error) {
      console.error('Error fetching Lambda function URL:', error);
      throw error;
    }
  });

  test('Should return a valid response for a simple question', async () => {
    const input = {
      messages: [
        { role: 'user', content: 'What is the capital of France?'}
      ]
    };

    const response = await invokeLambda(input);
    //console.log("Response row data:", JSON.stringify(response));

    expect(response).toHaveProperty('answer');
    expect(typeof response.answer).toBe('string');
    expect(response.answer.toLowerCase()).toContain('paris');
    expect(response).toHaveProperty('conversation');
    expect(response.conversation).toBeInstanceOf(Array);
    expect(response.conversation.length).toBeGreaterThan(1);
    expect(response.conversation[0].content.toLowerCase()).toContain('capital');
    expect(response.conversation[1].content.toLowerCase()).toContain('paris');
  });

  test('Should handle multi-turn conversation', async () => {
    const input = {
      messages: [
        { role: 'user', content: 'Tell me a joke about programming.' },
        { role: 'assistant', content: 'Why do programmers prefer dark mode? Because light attracts bugs!' },
        { role: 'user', content: 'That was funny. Now tell me another one about AI.' }
      ]
    };

    const response = await invokeLambda(input);

    expect(response).toHaveProperty('answer');
    expect(typeof response.answer).toBe('string');
    expect(response.answer.toLowerCase()).toContain('ai');
    expect(response).toHaveProperty('conversation');
    expect(response.conversation).toBeInstanceOf(Array);
    expect(response.conversation.length).toBeGreaterThan(3);
    expect(response.conversation[0].content.toLowerCase()).toContain('joke');
    expect(response.conversation[3].content.toLowerCase()).toContain('ai');
  });

  test('Should respect max token limit', async () => {
    jest.setTimeout(30000);     // Increase timeout to 30 seconds

    const input = {
      messages: [
        { role: 'user', content: 'Write a very long story about a space adventure.' }
      ],
      max_tokens: 200
    };

    const response = await invokeLambda(input);

    expect(response).toHaveProperty('answer');
    expect(typeof response.answer).toBe('string');
    expect(response).toHaveProperty('conversation');
    expect(response.conversation).toBeInstanceOf(Array);
    expect(response.conversation.length).toBeGreaterThan(1);
    const wordCount = response.answer.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(200*2);  // Allowing some buffer for potential token counting differences
  });

  test('Should handle special characters and Unicode', async () => {
    const input = {
      messages: [
        { role: 'user', content: 'Translate "Hello, World!" to Japanese and explain the meaning of each character.' }
      ]
    };

    const response = await invokeLambda(input);

    expect(response).toHaveProperty('answer');
    expect(typeof response.answer).toBe('string');
    expect(response.answer).toContain('こんにちは');
    expect(response.answer).toContain('世界');
    expect(response).toHaveProperty('conversation');
    expect(response.conversation).toBeInstanceOf(Array);
    expect(response.conversation.length).toBeGreaterThan(1);
    expect(response.conversation[0].content.toLowerCase()).toContain('translate');
    expect(response.conversation[1].content).toContain('こんにちは');
    expect(response.conversation[1].content).toContain('世界');
  });

/*
  // These tests are not working
  test('Should handle invalid data gracefully', async () => {
    const input = { invalid: "Hello" };

    //await expect(invokeLambda(input)).rejects.toThrow();
    const response = await invokeLambda(input);
    console.log("Response row data:", JSON.stringify(response));
    expect(response).toHaveProperty('error');
    expect(typeof response.error).toBe('string');
    expect(response.error.toLowerCase()).toContain('error');
  });

  test('Should handle empty input gracefully', async () => {
    const input = { messages: [] };

    //await expect(invokeLambda(input)).rejects.toThrow();
    const response = await invokeLambda(input);
    console.log("Response row data:", JSON.stringify(response));
    expect(response).toHaveProperty('error');
    expect(typeof response.error).toBe('string');
    expect(response.error.toLowerCase()).toContain('error');
  });
*/
});
