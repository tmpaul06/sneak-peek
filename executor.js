// Start a simple express server that talks to MySQL!
var express = require("express");
var bodyParser = require('body-parser');

// Env variables
var HOST = process.env.MYSQL_HOST || "localhost";
var USER = process.env.MYSQL_USER || "root";
var PASSWORD = process.env.MYSQL_PASSWORD || "password";
var DATABASE = process.env.MYSQL_DATABASE || "test";

var mysql      = require('mysql');
var connection = mysql.createConnection({
  host     : HOST,
  user     : USER,
  password : PASSWORD,
  database : DATABASE
});

var app = express();
app.use(express.static('public'));
// parse application/json
app.use(bodyParser.json());
connection.connect();

app.post("/execute", function(req, res) {
  var body = req.body;
  var query = body.query;
  connection.query(query, function (error, results, fields) {
    if (error) console.error(error);
    return res.json({
      rows: results
    });
  });
});

app.listen(3000, function() {
  console.log("Server is listening on port", 3000);
});
