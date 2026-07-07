const mysql = require('mysql2/promise');
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-west-2' });
var request = require('request');
var database = require('./database.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

let port = 8787;
let hport = 8447;

let app = express();
app.use(express.static("./"));
app.use(cors());
app.use(bodyParser.json({ limit: "200mb", parameterLimit: "1000000" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "200mb", parameterLimit: "1000000" }));

app.get("/", homePage);
app.get('/getUsers/',getUsers);
app.get('/getContacts/',getContacts);
app.get('/upsertContact/',upsertContact);
app.get('/deleteContact/',deleteContact);
app.get('/addUser/',addUser);
app.get('/deleteUser/',deleteUser);

const password = process.env.DB_PWD

//Run the server
app.listen(port, async function() {
    console.log("REST endpoint now listening on port " + port + ".");
});


/*/   PUBLIC
//Secure Server
//import https from 'https';
const https = require("https");
https.createServer(
    {
        key: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/cert.pem'),
        ca: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/fullchain.pem')
    },app
  )
  .listen(hport, () => {
    console.log(`Listening on ${hport} ...`)
  })
//*/

var query = 'SELECT VERSION() AS v';
queryDB(query);

async function queryDB(query){
    let connection;  

    try {
	connection = await mysql.createConnection({
	    host: 'chtter-mcp-database.cp1vvnnejoms.us-west-2.rds.amazonaws.com',
	    port: 3306,
	    database: 'chtter',
	    user: 'admin',
	    password,
	    ssl: { rejectUnauthorized: false, ca: require('fs').readFileSync('./global-bundle.pem') }
	});

	const [rows] = await connection.execute(query);
	return(rows)
    } catch (error) {
	console.error('Database error:', error);
	throw error;
    } finally {
	if (connection) await connection.end();
    }
}

//----------------------------------------------------------------------------
function homePage(){
    console.log('... load home page ... ' );
    
    var html = fs.readFileSync('index.html');
    res.writeHead(200, {'Content-type': 'text/html'} );
    res.end(html);
	
    return;
}

//----------------------------------------------------------------------------
async function getUsers(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
	    }
	}

	//console.log(result);

	var query = `SELECT * FROM users `;
	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}

//----------------------------------------------------------------------------
async function getContacts(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {userName:null};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
		if(split3[0] == 'userName') result.userName = split3[1];
	    }
	}

	//console.log(result);

	var query = `SELECT * FROM contacts WHERE user_id = (SELECT user_id FROM users WHERE userName = '${result.userName}')`;
	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}

//----------------------------------------------------------------------------
async function upsertContact(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {userName:null,contactType:null,contactValue:null,active:false};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
		if(split3[0] == 'userName') result.userName = split3[1];
		if(split3[0] == 'contactType') result.contactType = split3[1];
		if(split3[0] == 'contactValue') result.contactValue = split3[1];
		if(split3[0] == 'active') result.active = split3[1];
	    }
	}

	//console.log(result);

	var query = "";
	query = `INSERT INTO contacts (user_id, contact_type, contact_value, active) `;
	query += `VALUES ((SELECT user_id FROM users WHERE userName = '${result.userName}'), '${result.contactType}', '${decodeURIComponent(result.contactValue)}', ${result.active === 'true' ? 1 : 0}) `;
	query += `ON DUPLICATE KEY UPDATE contact_value = VALUES(contact_value), active = VALUES(active);`;	

	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}

//----------------------------------------------------------------------------
async function deleteContact(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {userName:null,contactType:null};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
		if(split3[0] == 'userName') result.userName = split3[1];
		if(split3[0] == 'contactType') result.contactType = split3[1];
	    }
	}

	//console.log(result);

	var query = `DELETE from contacts `;
	query += `WHERE user_id = (SELECT user_id FROM users WHERE userName = '${result.userName}') `;
	query += `  AND contact_type = '${result.contactType}';`;

	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}

//----------------------------------------------------------------------------
async function addUser(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {userName:null};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
		if(split3[0] == 'userName') result.userName = split3[1];
	    }
	}

	//console.log(result);

	var query = `INSERT INTO users (userName) VALUES ('${result.userName}') `;
	//console.log(query);

	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}

//----------------------------------------------------------------------------
async function deleteUser(request,response,next)
{

    if (request.method.toLowerCase() == 'get')
    {
	var url = request.url;
	var split1 = url.split('?');
	var result = {userName:null};
	if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
		var split3 = split2[i].split('=');
		if(split3[0] == 'userName') result.userName = split3[1];
	    }
	}

	//console.log(result);

	var query = `DELETE FROM users WHERE userName = '${result.userName}' `;

	var rows = await queryDB(query);
	response.json(rows);

    }

    return;
}
