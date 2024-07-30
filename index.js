const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express')
const cors = require('cors');
const axios = require('axios');
const fs = require("fs");
const sess = require("./session")
const db = require('./config/database');
const users = require('./database/users')
const messaging = require('./messaging')
const moment = require('moment')
const qrcode = require('qrcode-terminal');

const app = express()
const port = 3093

var corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}

var clientMap = {}

app.use(cors(corsOptions));
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.get('/status', (req, res) => {
    const id = req.query.id

    if(!clientMap[id]){
        res.send("CLIENT NOT EXIST")
        return
    }

    const statusConn = clientMap[id].statusConn
    if (statusConn == true){
        res.send("CONNECTED")
    } else {
        res.send("NOTOK")
    }
})

app.post('/message/send', async (req, res) => {
    try{
        const id = req.body.user_id
        const phone = req.body.phone;
        const message = req.body.message;
        const attachmentUrl = req.body.attachment_url
        const isGroup = req.body.is_group
        let chatId = ""

        if(isGroup != undefined && isGroup == 1){
            chatId = phone + "@g.us";
            console.log("send to group !!!", chatId)
        } else {
            chatId = phone + "@c.us";
        }

        if (!clientMap[id]) {
            res.send("NO CLIENT EXIST")
            return
        }

        if (clientMap[id] && clientMap[id].statusConn == true) {
            if(attachmentUrl != null || attachmentUrl !== undefined){
                const media = await MessageMedia.fromUrl(attachmentUrl);
                isSent = await clientMap[id].client.sendMessage(chatId, media, { caption: message });
            } else {
                isSent = await clientMap[id].client.sendMessage(chatId, message, { linkPreview: true });
            }
            console.log(moment().format() + ": result sent message from id " + id)

            res.send("OK")
        } else {
            res.send("CLIENT EXIST BUT DISCONNECTED")
        }
    } catch(e){
        console.log("ada error waktu send message : ", e)
        res.send("NOTOK")
    }
})

app.get('/qr', async (req, res) => {
    console.log(moment().format() + ": qr triggered")
    const id = req.query.id;
    let connstate = null
    let counterResp = 0
    let diffGeneratedTime = 0

    const userInfo = await users.getUser(id)

    if (clientMap[id] && clientMap[id].statusConn == false) {
        connstate = await clientMap[id].client.getState()
        console.log(moment().format() + ": status connection : ", connstate)

        if(connstate == null){
            diffGeneratedTime = (Math.abs(new Date()) - clientMap[id].createdOn) / 1000
            console.log("diff generated time : ", diffGeneratedTime)
            if(diffGeneratedTime < 90) {
                res.send("kecepetan request ulang nya")
                return
            }
        }

        clientMap[id].client.destroy()
        delete clientMap[id]
        fs.rmSync('./.wwebjs_auth/session-' + id, {recursive: true, force: true,})
    }

    if (clientMap[id] && clientMap[id].statusConn == true) {
        connstate = await clientMap[id].client.getState()
        console.log(moment().format() + ": status connection : ", connstate)
        res.send(connstate)
        return
    }

    let client = null
    if(clientMap[id]){
        client = clientMap[id].client
    }

    if(!clientMap[id]){
        client = new Client({
            authStrategy: new LocalAuth({ clientId: id }),
            restartOnAuthFail: true,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    "--disable-setuid-sandbox",
                ],
            }
        });
        client.initialize().catch(e => {
            console.log(moment().format() + ": EH KE CATCH DEH", e)
        })
    }   

    clientMap[id] = {client: client, statusConn : false, createdOn: 0}

    client.once('qr', (qr) => {
        console.log(moment().format() + ": qr generated -> " + qr)
        clientMap[id].createdOn = Math.abs(new Date())
        qrcode.generate(qr, {small: true})
        res.send(qr)
        counterResp++
        return
    });

    client.on('ready', async() => {
        console.log(moment().format() + ': Client is ready!');
        clientMap[id] = {client: client, statusConn : true, userInfo : userInfo[0]}

        if(counterResp == 0) {
            const connstate = await client.getState()
            res.send(connstate)
        }

        messaging.getAndSend()
    });

    handlingEventClient(client, userInfo[0])
})


// Creating MySQL connection
db.connect("mode_production", async function (err, rslt) {
    if (err) {
        console.log('Unable to connect to MySQL.');
        process.exit(1);
    } else {
        sess.listDirectories('./.wwebjs_auth')
        .then(async function(listDir){
            listDir.filter(dir => dir != "session")
            .map(async dir => {
                const userCode = dir.split("-")[1]
                const userInfo = await users.getUser(userCode)
                await startClient(false, userInfo[0])
            })
        })
        .then(function(){
            app.listen(port, async function () {
                console.log(moment().format() + ': Express server lisening on port ' + port);
            });
        })
    }
})

async function callWebhook(data, clientId) {
    const config = {
        headers:{
            'Content-Type': 'application/json',
        }
    };

    try {
        console.log(moment().format() + ": STAARTT CALL callwebhook", data.from)
        const response = await axios.post(clientMap[clientId].userInfo.webhook_url, data, config)
    } catch(e){
        console.log(moment().format() + ": error callwebhook", e)
        return "notok"
    }

    return "OK"
}

async function callInsertMessageHistory(userId, target, type, message) {
    const config = {
        headers:{
            'Content-Type': 'application/json',
        }
    };

    const data = {
        user_id : userId,
        target : target,
        type : type,
        message : message,
    }

    try {
        console.log(moment().format() + ": STAARTT CALL callInsertMessageHistory ", data.target)
        const response = await axios.post(process.env.API_URL + "/api/message_history/create", data, config)
    } catch(e){
        console.log(moment().format() + ": error call insert message history", e)
        return "notok"
    }

    return "OK"
}

async function startClient(withQR, userInfo){
    console.log(moment().format() + ": try to resurrect clientId : ", userInfo.user_code)

    const clientPre = new Client({
        authStrategy: new LocalAuth({ clientId: userInfo.user_code }),
        restartOnAuthFail: true,
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                "--disable-setuid-sandbox",
            ],
        }
    });
    
    clientPre.initialize().catch(e => {
        console.log(moment().format() + ": ADUHHH KENA CATCH NIHH YG PREEE", e)
    })
    
    clientPre.on('ready', async () => {
        console.log(moment().format() + ': Client with id ' +userInfo.user_code+ ' is ready!');
        clientMap[userInfo.user_code] = {client: clientPre, statusConn : true, createdOn : Math.abs(new Date()), userInfo : userInfo}
    });

    handlingEventClient(clientPre, userInfo)

    return clientPre
}

function handlingEventClient(client, userInfo){
    const id = userInfo.user_code
    client.on('message', async msg => {
        const from = msg.from.split("@")[0]
    
        if (msg.body == '!ping') {
            msg.reply('pong');
        }

        if(from == "status"){
            console.log(moment().format() + ": message detected as status, ignore to continue")
            return
        }

        if(msg.type == "document"){
            console.log(moment().format() + ": message detected as document, ignore to continue")
            return
        }

        if(msg.type == "image"){
            console.log(moment().format() + ": message detected as image, ignore to continue")
            return
        }
    
        if(msg.body == ''){
            console.log(moment().format() + ": bodynya kosongg")
            return
        }

        if(msg.body.substring(0, 3) == '/9j'){
            console.log(moment().format() + ": incoming message not text, ignored")
            return
        }
    
        if(msg.body != '' && from.length > 15){
            console.log(moment().format() + ": incoming message from group, ignored")
            return
        }
    
        try {
            if(!userInfo.is_saved){
                console.log(moment().format() + ": flag is_saved is off, ignore to call webhook")
                return
            } 

            callWebhook(msg, id)
        } catch(e){
            console.log("error call webhook")
        }
        
    });
    
    client.on('message_create', async msg => {
        const to = msg.to.split("@")[0]
        const isOutbound = msg.id.fromMe
        if(msg.body == "" || !isOutbound){
            return
        }

        if(!userInfo.is_saved){
            console.log(moment().format() + ": flag is_saved is off, ignore to save message")
            return
        }

        callInsertMessageHistory(id, to, "outbound", msg.body)
    })

    client.on('disconnected', rsn => {
        console.log("disconnected nih")
        client.destroy()
        delete clientMap[id]
        fs.rmSync('./.wwebjs_auth/session-' + id, {recursive: true, force: true,})
        return
    });

    client.on('authenticated', mmm => {
        console.log(moment().format() + ": sini?")
    })

    client.on('change_state', state => {
        console.log(moment().format() + ": perubahan state nya : ", state)
    })
}