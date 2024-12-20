const mysql = require('mysql2/promise');
const {
	RDSClient,
	DescribeDBInstancesCommand
} = require("@aws-sdk/client-rds");

const fs = require('fs');
const path = require('path');

// Read the config file
const configPath = path.join(__dirname, 'config.json');
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);

// Extract configurations
const DBUSER = config.datastore.user;
const DBPWD = config.datastore.passwd;

const systemPrompt = `You are an AI assistant with extended skills in healthcare.
    When the user asks for a doctor you have access to a tool to search for doctors, but only use it when neccesary. 
    If the tool is not required respond as normal.
    Before calling SearchDoctors, check if the user looks for a specific gender, lastname, speciality or zipcode.
    Do it in a conversational mode.
    Before calling a tool, do some analysis within <thinking> </thinking> tags. 
    Go through each of the parameters and determine if the user has directly provided or given enough information to infer a value. 
    If all the parameters are present, close the thinking tag and proceed with the tool call.
    BUT if one of the parameters is missing, DO NOT invoke the function and ask the user to provide the missing parameter.
`.trim();

const tool_definition = {
    name: "SearchDoctors",
    description: "Search for doctors in the HealthyLinkx directory",
    input_schema: {
        type: "object",
        properties: {
            zipcode: {
                type: "string",
                description: "The zipcode of the address of the doctor."
            },
            lastname: {
                type: "string",
                description: "The lastname of the doctor."
            },
            specialty: {
                type: "string",
                description: "The specialty of the doctor."
            },
            gender: {
                type: "string",
                description: "The gender of the doctor."
            }
        }
    }
}

function ServerReply (code, message){
    if (code != 200) message = [];
    return {
        statusCode: code,
        body: { Doctors: message}
    };
}

async function SearchDoctors(	gender, lastname, specialty, zipcode){
 	//check params
 	if(!zipcode && !lastname && !specialty)
		return ServerReply (204, {error: 'not enought params!'});

    //normalize gender
	if (gender){
		if (gender === 'male') gender = 'M';
		if (gender === 'm') gender = 'M';
		if (gender !== 'M') gender = 'F';
	}

    // for now just a canned answer
    /*
    return ServerReply (200, [{
            Doctor_Full_Name: "ANDERSON, VIRGINIA  MHC",
            Doctor_Full_Street: "16700 NE 79TH ST SUITE 103",
            Doctor_Full_City: "REDMOND, WA 980524465",
            Doctor_Specialization: "Nurse"
        },
        {
            Doctor_Full_Name: "ANDERSON, JOHN",
            Doctor_Full_Street: "16700 NE 79TH ST SUITE 104",
            Doctor_Full_City: "REDMOND, WA 980524465",
            Doctor_Specialization: "Acupunture"
        },
        {
            Doctor_Full_Name: "ANDERSON, ANDREW",
            Doctor_Full_Street: "16700 NE 79TH ST SUITE 105",
            Doctor_Full_City: "REDMOND, WA 980524465",
            Doctor_Specialization: "Phisio Therapy"
        }
    ]);*/

    // build the query to the datastore
	var query = "SELECT Provider_Full_Name,Provider_Full_Street,Provider_Full_City,Classification FROM npidata2 WHERE (";
    if(lastname)
        query += "(Provider_Last_Name_Legal_Name = '" + lastname + "')";
    if(gender){
        if(lastname) query += " AND ";
        query += "(Provider_Gender_Code = '" + gender + "')";
    }
    if(specialty){
        if(lastname || gender) query += " AND ";
        query += "(Classification = '" + specialty + "')";
    }
    if(zipcode){
        if(lastname || gender || specialty) query += " AND ";
        query += "(Provider_Short_Postal_Code = '" + zipcode + "')";
    }
    query += ") limit 10";
    
    //URL of the datastore
    const rdsclient = new RDSClient({});
    data = await rdsclient.send(new DescribeDBInstancesCommand({
        DBInstanceIdentifier: 'healthylinkx-db'}));
    const endpoint = data.DBInstances[0].Endpoint.Address;

    // query the datastore and return results
    try {
        const connection = await mysql.createConnection({
            host: endpoint,
            user: DBUSER,
            password: DBPWD,
            database: "healthylinkx"
        });
        await connection.connect();
        const [rows,fields] = await connection.query({ sql: query, timeout: 10000});
        await connection.end();
        return ServerReply (200, rows);
    } catch(err) {
        return ServerReply (500, {"error": query + '#' + err});
    } 
}

module.exports = { systemPrompt, tool_definition, SearchDoctors };