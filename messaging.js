const http = require('http');
const https = require('https');

exports.getAndSend = function () {
  const options = {
    hostname: process.env.API_URL,
    port: process.env.API_PORT,
    path: process.env.SENDMESSAGE_PATH,
    method: 'GET',
    rejectUnauthorized: false,
  };

  setInterval(function () {
    console.log("get message");

    const req = https.request(options, res => {
      console.log(`statusCode: ${res.statusCode}`);

      res.on('data', d => {
        process.stdout.write(d);

        const body = JSON.parse(d);
        console.log(body);
        var msg = body.message;

        try {
          for (var i in msg) {
            var number = msg[i].no_hp + "@c.us";
            var pesan = msg[i].message;
            console.log("Send to = " + msg[i].no_hp);
            console.log("Message = " + msg[i].message);

            client.sendMessage(number, pesan);

          }

        } catch (err) { console.log(err) }

      });
    });

    req.on('error', error => {
      console.error(error);
    });

    req.end();
  }, 1 * 30 * 1000);
}