<?php

require 'vendor/autoload.php';

use Message\Comm;
use Ratchet\App;

//set an array of origins allowed to connect to this server
$allowed_origins = ['*'];

// Run the server application through the WebSocket protocol on port 8080
$app = new App('0.0.0.0', 8080, '0.0.0.0');//App(hostname, port, 'whoCanConnectIP', '')

//create socket routes
//route(uri, classInstance, arrOfAllowedOrigins)
$app->route('/comm', new Comm, $allowed_origins);

//run websocket
$app->run();
