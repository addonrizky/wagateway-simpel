const http = require('http');
const https = require('https');
const axios = require('axios');
const moment = require('moment')

function doRequest(options) {
  return new Promise ((resolve, reject) => {
    let req = http.request(options);

    req.on('response', res => {
      res.on('data', d => {
        process.stdout.write(d);
        
        let body = null

        try {
          body = JSON.parse(d);
        } catch(e) {
          console.log("parse error: ", e)
          reject(e)
        }
        
        console.log(body)
        resolve(body);
      })
    });

    req.on('error', err => {
      reject(err);
    });

    req.end();
  }); 
}

exports.getAndSend = async function (client) {
  const options = {
    hostname: process.env.API_URL,
    //port: process.env.API_PORT,
    path: process.env.SENDMESSAGE_PATH,
    method: 'GET',
    rejectUnauthorized: false,
  };

  setInterval(async function () {
    console.log("get message");
    let data = null
    try {
      data = await doRequest(options)
    } catch(e) {
      console.log("error on get message: ", data)
      return
    }
    

    console.log("data:", data)
    await data.message.forEach(async e => {
      var number = e.no_hp + "@c.us";
      var pesan = e.message;
      // console.log("Send to = " + e.no_hp);
      // console.log("Message = " + e.message);

      console.log(moment().format() + "Send to = " + e.no_hp)
      console.log(moment().format() + "Message = " + e.message)

      try {
        await client.sendMessage(number, pesan);
      } catch (e) {
        console.log(moment().format() + "error on client send message", e)
      } 
      
      await sleep(3000)
    });
  }, 1 * 60 * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => {
      setTimeout(resolve, ms);
  });
}